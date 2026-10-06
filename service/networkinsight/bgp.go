package networkinsight

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// Fixed RIPE RIS endpoint; never accept a browser-supplied resource or URL.
var ripeClient = &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{
	Proxy: nil, DialContext: (&net.Dialer{Timeout: 4 * time.Second}).DialContext, TLSHandshakeTimeout: 4 * time.Second, ResponseHeaderTimeout: 8 * time.Second,
}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func ripeGet(ctx context.Context, endpoint, resource string, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://stat.ripe.net/data/"+endpoint+"/data.json?resource="+url.QueryEscape(resource), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Nezha-Network-Insights/1")
	resp, err := ripeClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return errors.New("BGP source unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil || len(raw) > 8*1024*1024 {
		return errors.New("invalid BGP source size")
	}
	var envelope struct {
		Status string
		Data   json.RawMessage
	}
	if err = json.Unmarshal(raw, &envelope); err != nil || envelope.Status != "ok" {
		return errors.New("invalid BGP source response")
	}
	return json.Unmarshal(envelope.Data, out)
}
func PublicIP(value string) bool {
	ip, err := netip.ParseAddr(value)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, block := range []string{"100.64.0.0/10", "198.18.0.0/15", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32"} {
		if netip.MustParsePrefix(block).Contains(ip) {
			return false
		}
	}
	return true
}

type Route struct {
	Prefix string   `json:"target_prefix"`
	Source string   `json:"source_id"`
	Path   []uint32 `json:"path"`
}
type bgpData struct {
	Resource  string
	Timestamp string
	BGPState  []Route `json:"bgp_state"`
}

// Collector-peer observations, not bandwidth. Collapse prepends, reject loops.
func Aggregate(routes []Route, prefix string) ([]Path, int) {
	counts := map[string]*Path{}
	seen := map[string]bool{}
	total := 0
	for _, r := range routes {
		if r.Prefix != prefix || len(r.Path) == 0 || len(r.Path) > 128 {
			continue
		}
		p := []uint32{}
		unique := map[uint32]bool{}
		valid := true
		for _, asn := range r.Path {
			if asn == 0 {
				valid = false
				break
			}
			if len(p) > 0 && p[len(p)-1] == asn {
				continue
			}
			if unique[asn] {
				valid = false
				break
			}
			unique[asn] = true
			p = append(p, asn)
		}
		if !valid || len(p) == 0 {
			continue
		}
		key := fmt.Sprint(r.Source, p)
		if seen[key] {
			continue
		}
		seen[key] = true
		n := len(p)
		origin := p[n-1]
		var direct, second uint32
		if n > 1 {
			direct = p[n-2]
		}
		if n > 2 {
			second = p[n-3]
		}
		key = fmt.Sprintf("%d:%d:%d", origin, direct, second)
		if counts[key] == nil {
			row := &Path{Origin: node(origin)}
			if direct != 0 {
				x := node(direct)
				row.Direct = &x
			}
			if second != 0 {
				x := node(second)
				row.Second = &x
			}
			counts[key] = row
		}
		counts[key].Count++
		total++
	}
	out := make([]Path, 0, len(counts))
	for _, p := range counts {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		key := func(p Path) string {
			var direct, second uint32
			if p.Direct != nil {
				direct = p.Direct.ASN
			}
			if p.Second != nil {
				second = p.Second.ASN
			}
			return fmt.Sprintf("%010d:%010d:%010d", p.Origin.ASN, direct, second)
		}
		return key(out[i]) < key(out[j])
	})
	return out, total
}
func node(asn uint32) ASNode {
	tier := map[uint32]bool{174: true, 701: true, 1239: true, 1299: true, 2914: true, 3257: true, 3320: true, 3356: true, 6453: true, 6461: true, 6762: true, 6830: true, 7018: true, 5511: true}
	return ASNode{ASN: asn, Name: fmt.Sprintf("AS%d", asn), Tier1: tier[asn]}
}

var names = struct {
	sync.Mutex
	items map[uint32]string
}{items: map[uint32]string{}}

func asName(ctx context.Context, asn uint32) string {
	names.Lock()
	n := names.items[asn]
	names.Unlock()
	if n != "" {
		return n
	}
	var data struct{ Holder string }
	if ripeGet(ctx, "as-overview", fmt.Sprintf("AS%d", asn), &data) != nil || data.Holder == "" {
		return fmt.Sprintf("AS%d", asn)
	}
	n = strings.Map(func(r rune) rune {
		if r < 32 {
			return -1
		}
		return r
	}, data.Holder)
	if len([]rune(n)) > 180 {
		n = string([]rune(n)[:180])
	}
	names.Lock()
	if len(names.items) > 1024 {
		names.items = map[uint32]string{}
	}
	names.items[asn] = n
	names.Unlock()
	return n
}
func QueryBGP(ctx context.Context, ip, family string) Topology {
	out := Topology{Family: family, Status: "unavailable", Source: "RIPE RIS / RIPEstat", Paths: []Path{}}
	if !PublicIP(ip) {
		out.Status = "no_public_ip"
		return out
	}
	var raw bgpData
	if ripeGet(ctx, "bgp-state", ip, &raw) != nil {
		return out
	}
	address, _ := netip.ParseAddr(ip)
	address = address.Unmap()
	best := -1
	for _, r := range raw.BGPState {
		p, e := netip.ParsePrefix(r.Prefix)
		if e == nil && p.Contains(address) && p.Bits() > best {
			out.Prefix = p.String()
			best = p.Bits()
		}
	}
	if best < 0 {
		out.Status = "no_routes"
		return out
	}
	out.ObservedAt = raw.Timestamp
	out.Paths, out.Total = Aggregate(raw.BGPState, out.Prefix)
	out.Status = "ok"
	if out.Total == 0 {
		out.Status = "no_routes"
		return out
	}
	if len(out.Paths) > 40 {
		out.Paths = out.Paths[:40]
	}
	selected := map[uint32]string{}
	for _, p := range out.Paths {
		for _, n := range []*ASNode{&p.Origin, p.Direct, p.Second} {
			if n != nil {
				selected[n.ASN] = ""
			}
		}
	}
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	var mu sync.Mutex
	asns := make([]uint32, 0, len(selected))
	for asn := range selected {
		asns = append(asns, asn)
	}
	for _, asn := range asns {
		wg.Add(1)
		go func(asn uint32) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			n := asName(ctx, asn)
			mu.Lock()
			selected[asn] = n
			mu.Unlock()
		}(asn)
	}
	wg.Wait()
	for i := range out.Paths {
		for _, n := range []*ASNode{&out.Paths[i].Origin, out.Paths[i].Direct, out.Paths[i].Second} {
			if n != nil && selected[n.ASN] != "" {
				n.Name = selected[n.ASN]
			}
		}
	}
	return out
}
