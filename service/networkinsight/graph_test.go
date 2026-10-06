package networkinsight

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestFullGraphObservations(t *testing.T) {
	prefix := "8.8.8.0/24"
	routes := []Route{
		{prefix, "RRC00-192.0.2.1", []uint32{50, 40, 30, 20, 10}},
		{prefix, "RRC00-192.0.2.1", []uint32{50, 40, 30, 20, 20, 10}},
		{prefix, "RRC00-192.0.2.2", []uint32{50, 40, 30, 20, 10}},
		{prefix, "RRC01-192.0.2.3", []uint32{60, 40, 30, 20, 10}},
		{prefix, "RRC02-192.0.2.4", []uint32{40, 10}},
		{prefix, "loop", []uint32{40, 30, 40, 10}},
		{prefix, "invalid", []uint32{0, 10}},
		{"8.8.0.0/16", "other", []uint32{99, 10}},
	}
	g := BuildGraph(routes, prefix)
	require.Equal(t, 4, g.Total)
	require.Equal(t, 4, g.Included)
	require.Equal(t, 3, g.Collectors)
	require.Len(t, g.Paths, 3)
	require.Equal(t, []uint32{10, 20, 30, 40, 50}, g.Paths[0].ASNs)
	require.Equal(t, 2, g.Paths[0].Count)
	require.Equal(t, 1, g.Paths[0].Collectors)
	nodes := map[uint32]GraphNode{}
	for _, n := range g.Nodes {
		nodes[n.ASN] = n
	}
	require.Equal(t, 1, nodes[40].Layer)
	require.Equal(t, "direct", nodes[40].Role)
	require.Equal(t, 4, nodes[10].Samples)
	require.Equal(t, 3, nodes[10].Collectors)
	require.Equal(t, 4, nodes[60].Layer)
	require.Equal(t, "transit", nodes[60].Role)
	for _, e := range g.Edges {
		if e.Source == 20 && e.Target == 30 {
			require.Equal(t, 3, e.Samples)
			require.Equal(t, 2, e.Collectors)
		}
	}
	raw, err := json.Marshal(g)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "192.0.2.")
	require.False(t, g.Truncated)
}
func TestGraphLimitsDeterministicAndWholePaths(t *testing.T) {
	routes := []Route{}
	for i := 0; i < 1500; i++ {
		routes = append(routes, Route{"8.8.8.0/24", fmt.Sprintf("RRC00-%d", i), []uint32{uint32(1000 + i), 20, 10}})
	}
	a := BuildGraph(routes, "8.8.8.0/24")
	require.True(t, a.Truncated)
	require.LessOrEqual(t, len(a.Nodes), maxGraphNodes)
	require.LessOrEqual(t, len(a.Edges), maxGraphEdges)
	require.LessOrEqual(t, len(a.Paths), maxGraphPaths)
	require.Equal(t, 1500, a.Total)
	require.Equal(t, len(a.Paths), a.Included)
	for _, p := range a.Paths {
		require.Len(t, p.ASNs, 3)
	}
	for i, j := 0, len(routes)-1; i < j; i, j = i+1, j-1 {
		routes[i], routes[j] = routes[j], routes[i]
	}
	require.Equal(t, a, BuildGraph(routes, "8.8.8.0/24"))
	require.Empty(t, BuildGraph(nil, "8.8.8.0/24").Nodes)
}
func resetGraphCaches() {
	names.Lock()
	names.items = map[uint32]string{}
	names.Unlock()
	neighbourCache.Lock()
	neighbourCache.values = map[uint32]neighbourEntry{}
	neighbourCache.Unlock()
	routeServerCache.Lock()
	routeServerCache.values = nil
	routeServerCache.ok = false
	routeServerCache.until = time.Time{}
	routeServerCache.Unlock()
}
func mockBGP(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	resetGraphCaches()
	srv := httptest.NewServer(handler)
	old := ripeClient
	u, _ := url.Parse(srv.URL)
	ripeClient = &http.Client{Transport: rewriteTransport{u}, Timeout: time.Second}
	t.Cleanup(func() { srv.Close(); ripeClient = old; resetGraphCaches() })
}
func TestLookingGlassFullGraphAndAnnotations(t *testing.T) {
	mockBGP(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "looking-glass"):
			require.Equal(t, "8.8.8.8", r.URL.Query().Get("resource"))
			fmt.Fprint(w, `{"status":"ok","data":{"latest_time":"2026-10-06T00:00:00","rrcs":[{"rrc":"RRC00","peers":[{"prefix":"8.8.8.0/24","peer":"192.0.2.1","as_path":"40 30 20 10"},{"prefix":"8.8.8.0/24","peer":"192.0.2.2","as_path":"40 20 10"},{"prefix":"8.8.8.0/24","peer":"192.0.2.3","as_path":"{40,30} 10"},{"prefix":"8.8.8.0/24","peer":"192.0.2.4","as_path":"(40) 10"}]}]}}`)
		case strings.Contains(r.URL.Path, "as-overview"):
			fmt.Fprint(w, `{"status":"ok","data":{"holder":"Test AS"}}`)
		case strings.Contains(r.URL.Path, "asn-neighbours"):
			fmt.Fprint(w, `{"status":"ok","data":{"neighbours":[{"asn":40,"type":"left"},{"asn":123,"type":"right"}]}}`)
		case r.URL.Path == "/api/net":
			fmt.Fprint(w, `{"data":[{"asn":30,"info_type":"Route Server"},{"asn":40,"info_type":"NSP"}]}`)
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			http.NotFound(w, r)
		}
	})
	got := QueryBGP(context.Background(), "8.8.8.8", "IPv4")
	require.Equal(t, "ok", got.Status)
	require.Contains(t, got.Source, "Looking Glass")
	require.Equal(t, 2, got.Total)
	require.Equal(t, "2026-10-06T00:00:00", got.ObservedAt)
	require.Len(t, got.Graph.Nodes, 4)
	require.Equal(t, "available", got.Graph.AnnotationStatus)
	require.Equal(t, "available", got.Graph.SupplementalStatus)
	require.Len(t, got.Graph.Supplemental, 1)
	require.EqualValues(t, 10, got.Graph.Supplemental[0].Source)
	require.EqualValues(t, 40, got.Graph.Supplemental[0].Target)
	require.Equal(t, 0, got.Graph.Supplemental[0].Samples)
	for _, n := range got.Graph.Nodes {
		require.Equal(t, n.ASN == 30, n.RouteServer)
		require.Equal(t, "Test AS", n.Name)
	}
	require.Len(t, got.Graph.Edges, 4)
}
func TestGraphCancelledAndMetadataFailure(t *testing.T) {
	mockBGP(t, func(w http.ResponseWriter, r *http.Request) { http.Error(w, "unavailable", 503) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before := time.Now()
	got := QueryBGP(ctx, "8.8.8.8", "IPv4")
	require.Equal(t, "unavailable", got.Status)
	require.Less(t, time.Since(before), time.Second)
	g := BuildGraph([]Route{{"8.8.8.0/24", "RRC00-peer", []uint32{20, 10}}}, "8.8.8.0/24")
	enrichGraph(context.Background(), g)
	require.Equal(t, "unavailable", g.AnnotationStatus)
	require.Equal(t, "unavailable", g.SupplementalStatus)
	require.Empty(t, g.Supplemental)
	require.Len(t, g.Edges, 1)
}

func TestLookingGlassIPv6(t *testing.T) {
	mockBGP(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "looking-glass") {
			require.Equal(t, "2606:4700:4700::1111", r.URL.Query().Get("resource"))
			fmt.Fprint(w, `{"status":"ok","data":{"latest_time":"2026-10-06T00:00:00","rrcs":[{"rrc":"RRC01","peers":[{"prefix":"2606:4700:4700::/48","peer":"2001:db8::1","as_path":"174 13335"}]}]}}`)
			return
		}
		http.Error(w, "optional metadata unavailable", 503)
	})
	got := QueryBGP(context.Background(), "2606:4700:4700::1111", "IPv6")
	require.Equal(t, "ok", got.Status)
	require.Equal(t, "IPv6", got.Family)
	require.Equal(t, "2606:4700:4700::/48", got.Prefix)
	require.Equal(t, []uint32{13335, 174}, got.Graph.Paths[0].ASNs)
	raw, err := json.Marshal(got)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "2001:db8")
	require.NotContains(t, string(raw), "::1111")
}
