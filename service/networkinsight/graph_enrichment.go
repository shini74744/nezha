package networkinsight

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type neighbour struct {
	ASN  uint32 `json:"asn"`
	Type string `json:"type"`
}
type neighbourEntry struct {
	rows  []neighbour
	ok    bool
	until time.Time
}

var neighbourCache = struct {
	sync.Mutex
	values map[uint32]neighbourEntry
}{values: map[uint32]neighbourEntry{}}

func neighbours(ctx context.Context, asn uint32) ([]neighbour, bool) {
	neighbourCache.Lock()
	entry, found := neighbourCache.values[asn]
	neighbourCache.Unlock()
	if found && time.Now().Before(entry.until) {
		return entry.rows, entry.ok
	}
	var data struct {
		Rows []neighbour `json:"neighbours"`
	}
	ok := ripeGet(ctx, "asn-neighbours", fmt.Sprintf("AS%d", asn), &data) == nil
	if len(data.Rows) > 20000 {
		data.Rows = nil
		ok = false
	}
	ttl := 2 * time.Hour
	if !ok {
		ttl = 5 * time.Minute
	}
	entry = neighbourEntry{rows: data.Rows, ok: ok, until: time.Now().Add(ttl)}
	neighbourCache.Lock()
	if len(neighbourCache.values) >= 1024 {
		neighbourCache.values = map[uint32]neighbourEntry{}
	}
	neighbourCache.values[asn] = entry
	neighbourCache.Unlock()
	return data.Rows, ok
}

var routeServerCache = struct {
	sync.Mutex
	values map[uint32]bool
	until  time.Time
	ok     bool
}{}

func routeServers(ctx context.Context) (map[uint32]bool, bool) {
	routeServerCache.Lock()
	if time.Now().Before(routeServerCache.until) {
		v, ok := routeServerCache.values, routeServerCache.ok
		routeServerCache.Unlock()
		return v, ok
	}
	routeServerCache.Unlock()
	rows := map[uint32]bool{}
	ok := false
	// Fixed public metadata endpoint; no browser-supplied URL or IP is sent here.
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.peeringdb.com/api/net?info_type=Route%20Server&depth=0", nil)
	if err == nil {
		req.Header.Set("User-Agent", "Nezha-Network-Insights/1")
		if resp, e := ripeClient.Do(req); e == nil {
			defer resp.Body.Close()
			raw, e := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
			var body struct {
				Data []struct {
					ASN   uint32   `json:"asn"`
					Type  string   `json:"info_type"`
					Types []string `json:"info_types"`
				}
			}
			if e == nil && len(raw) <= 4*1024*1024 && resp.StatusCode == 200 && json.Unmarshal(raw, &body) == nil && body.Data != nil {
				ok = true
				for _, n := range body.Data {
					if n.ASN > 0 && (n.Type == "Route Server" || strings.Contains(strings.Join(n.Types, ","), "Route Server")) {
						rows[n.ASN] = true
					}
				}
			}
		}
	}
	ttl := 24 * time.Hour
	if !ok {
		ttl = 5 * time.Minute
	}
	routeServerCache.Lock()
	routeServerCache.values = rows
	routeServerCache.ok = ok
	routeServerCache.until = time.Now().Add(ttl)
	routeServerCache.Unlock()
	return rows, ok
}
func enrichGraph(parent context.Context, g *BGPGraph) {
	ctx, cancel := context.WithTimeout(parent, 6*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	var mu sync.Mutex
	var rs map[uint32]bool
	var rsOK bool
	wg.Add(1)
	go func() { defer wg.Done(); rs, rsOK = routeServers(ctx) }()
	type result struct {
		asn  uint32
		rows []neighbour
		ok   bool
	}
	results := []result{}
	sem := make(chan struct{}, 4)
	selected := g.Nodes
	if len(selected) > 16 {
		selected = selected[:16]
	}
	for _, node := range selected {
		wg.Add(1)
		go func(asn uint32) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			rows, ok := neighbours(ctx, asn)
			mu.Lock()
			results = append(results, result{asn, rows, ok})
			mu.Unlock()
		}(node.ASN)
	}
	wg.Wait()
	if rsOK {
		g.AnnotationStatus = "available"
	}
	byASN := map[uint32]GraphNode{}
	for i := range g.Nodes {
		n := &g.Nodes[i]
		n.RouteServer = rs[n.ASN]
		byASN[n.ASN] = *n
	}
	existing := map[[2]uint32]bool{}
	extra := map[[2]uint32]bool{}
	for _, e := range g.Edges {
		existing[[2]uint32{e.Source, e.Target}] = true
		existing[[2]uint32{e.Target, e.Source}] = true
	}
	successful := 0
	for _, r := range results {
		if !r.ok {
			continue
		}
		successful++
		for _, n := range r.rows {
			a, b := r.asn, n.ASN
			if _, ok := byASN[b]; !ok || a == b || (n.Type != "left" && n.Type != "right") || existing[[2]uint32{a, b}] {
				continue
			}
			// ASN-wide adjacency is supplemental context, never a prefix-level observation.
			if byASN[a].Layer > byASN[b].Layer || (byASN[a].Layer == byASN[b].Layer && a > b) {
				a, b = b, a
			}
			extra[[2]uint32{a, b}] = true
		}
	}
	keys := make([][2]uint32, 0, len(extra))
	for k := range extra {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i][0] != keys[j][0] {
			return keys[i][0] < keys[j][0]
		}
		return keys[i][1] < keys[j][1]
	})
	if len(keys) > 128 {
		keys = keys[:128]
	}
	for _, k := range keys {
		g.Supplemental = append(g.Supplemental, GraphEdge{Source: k[0], Target: k[1], Kind: "supplemental", Provenance: "RIPEstat ASN neighbours"})
	}
	if successful > 0 {
		g.SupplementalStatus = "available"
		if successful < len(selected) {
			g.SupplementalStatus = "partial"
		}
	}
}
