package networkinsight

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func routeHop(ttl int, ip, asn, location string) ReturnHop {
	return ReturnHop{TTL: ttl, IP: ip, ASN: asn, Location: location, Samples: 3}
}
func giaFixture() ReturnResult {
	return ReturnResult{Status: "reached", Target: "101.226.101.195", Hops: []ReturnHop{
		routeHop(1, "8.8.8.1", "64510", "日本"),
		routeHop(2, "69.194.166.1", "23764", "中国 香港"),
		routeHop(3, "59.43.1.1", "4809", "中国 上海"),
		routeHop(4, "59.43.2.1", "4809", "中国 上海"),
		routeHop(5, "101.226.101.195", "4812", "中国 上海"),
	}}
}
func TestReturnRouteClassifiesObservedNetworksWithoutProductGuarantees(t *testing.T) {
	for asn, want := range routeNetworks {
		r := ReturnResult{Hops: []ReturnHop{routeHop(3, "1.2.3.4", asn, "")}}
		AnnotateReturnRoute(&r)
		require.Equal(t, want, r.Hops[0].Network)
		require.Contains(t, r.Route, want)
		require.NotContains(t, r.Line, "GIA")
	}
	r := giaFixture()
	AnnotateReturnRoute(&r)
	require.Equal(t, "CN2 GIA（路由特征）", r.Line)
	require.Equal(t, "inferred", r.Confidence)
	require.Contains(t, r.Evidence[1], "不能证明")
	require.Equal(t, "origin", r.Hops[0].Stage)
	require.Equal(t, "international", r.Hops[1].Stage)
	require.Equal(t, "landing", r.Hops[2].Stage)
	require.Equal(t, "domestic", r.Hops[3].Stage)
	require.Equal(t, "destination", r.Hops[4].Stage)
	require.Equal(t, "电信 CN2", routeNetwork(routeHop(3, "59.43.245.1", "4134", "中国")))
}
func TestReturnGTNeedsSpecificAdjacentMainlandHandoff(t *testing.T) {
	cases := []struct {
		name, ip, region string
		gap, ecmp        bool
		want             string
	}{
		{"qualified", "59.43.245.1", "中国 上海", false, false, "CN2 GT（路由特征）"},
		{"generic163notGT", "59.43.1.1", "中国 上海", false, false, "CN2（类型待确认）"},
		{"overseas", "59.43.245.1", "中国 香港", false, false, "CN2（类型待确认）"},
		{"missingTTL", "59.43.245.1", "中国 上海", true, false, "CN2（类型待确认）"},
		{"multipath", "59.43.245.1", "中国 上海", false, true, "CN2（类型待确认）"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			next := 4
			if c.gap {
				next = 5
			}
			r := ReturnResult{Status: "reached", Hops: []ReturnHop{routeHop(3, c.ip, "4809", c.region), routeHop(next, "202.97.1.1", "4134", "中国 上海")}}
			if c.ecmp {
				r.Hops = append(r.Hops, routeHop(4, "59.43.1.2", "4809", "中国 上海"))
			}
			AnnotateReturnRoute(&r)
			require.Equal(t, c.want, r.Line)
		})
	}
}
func TestReturnGIARejectsIncompleteAndAmbiguousEvidence(t *testing.T) {
	cases := map[string]func(*ReturnResult){
		"missing-border":   func(r *ReturnResult) { r.Hops[2].Samples = 0 },
		"missing-later":    func(r *ReturnResult) { r.Hops[4].Samples = 0 },
		"ttl-gap":          func(r *ReturnResult) { r.Hops[3].TTL = 8 },
		"not-reached":      func(r *ReturnResult) { r.Status = "partial" },
		"unknown-location": func(r *ReturnResult) { r.Hops[2].Location = ""; r.Hops[3].Location = "" },
		"late-163":         func(r *ReturnResult) { r.Hops[4].IP = "202.97.1.1"; r.Hops[4].ASN = "4134" },
		"multipath":        func(r *ReturnResult) { r.Hops = append(r.Hops, routeHop(3, "59.43.7.1", "4809", "中国 上海")) },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			r := giaFixture()
			change(&r)
			AnnotateReturnRoute(&r)
			require.Equal(t, "CN2（类型待确认）", r.Line)
		})
	}
	for _, location := range []string{"中国 香港", "中国 台湾", "China Hong Kong", "澳门"} {
		require.Equal(t, "overseas", routeRegion(ReturnHop{Country: "China", Location: location}))
	}
	require.Equal(t, "mainland", routeRegion(ReturnHop{Country: "CN"}))
	require.Empty(t, routeRegion(ReturnHop{Location: "Anycast"}))
}
func TestReturnPrivacyHidesSourceProviderPrefixAndMetadataButKeepsBackbone(t *testing.T) {
	r := ReturnResult{Name: "日本 8.8.8.8", Carrier: "edge 2606:4700:abcd::/48", Target: "8.8.8.8", Hops: []ReturnHop{
		routeHop(1, "8.8.8.1", "64510", "日本"), routeHop(2, "9.9.9.9", "64510", "日本"),
		routeHop(3, "59.43.1.1", "4809", "中国 香港"),
		routeHop(4, "9.9.8.7", "64510", "中国 香港"),
		routeHop(5, "8.8.8.9", "4809", "中国 上海"),
		routeHop(6, "2606:4700:abcd:1::1", "4809", "中国 上海"),
		routeHop(7, "10.1.1.1", "4809", "中国 上海"),
		routeHop(8, "59.43.2.1", "4809", "中国 上海"),
		routeHop(9, "11.22.33.44", "", "Japan 8.8.8.0/24"),
	}}
	r.Hops[2].Organization = "edge 2606:4700:abcd::42"
	AnnotateReturnRoute(&r)
	RedactReturnRoute(&r, "8.8.8.8", "2606:4700:abcd::9")
	// Source uses CN2 ASN, so all hops in that source ASN are conservatively hidden.
	for _, h := range r.Hops {
		require.Empty(t, h.IP)
		require.True(t, h.IPHidden)
	}
	raw, _ := json.Marshal(r)
	for _, s := range []string{"8.8.8.", "9.9.", "2606:4700:abcd", "11.22.33.44", "10.1.1.1"} {
		require.NotContains(t, string(raw), s)
	}
	r = giaFixture()
	AnnotateReturnRoute(&r)
	RedactReturnRoute(&r, "8.8.8.8")
	require.Empty(t, r.Hops[0].IP)
	require.Empty(t, r.Hops[1].IP)
	require.Equal(t, "59.43.1.1", r.Hops[2].IP)
	require.Empty(t, r.Hops[4].IP)
	require.Empty(t, r.Target)
	require.Equal(t, "CN2 GIA（路由特征）", r.Line)
}

func TestCN2UnconfirmedExplainsMissingHopsWithoutGuessingGIA(t *testing.T) {
	r := ReturnResult{Status: "reached", Target: "1.1.1.1", Hops: []ReturnHop{
		{TTL: 4, IP: "203.0.113.1", ASN: "23764", Country: "中国", Location: "中国 香港", Samples: 3},
		{TTL: 5, Samples: 0},
		{TTL: 6, IP: "59.43.39.81", Country: "中国", Location: "中国 上海", Samples: 3},
		{TTL: 7, IP: "59.43.159.17", Country: "中国", Location: "中国 上海", Samples: 3},
		{TTL: 8, Samples: 0},
		{TTL: 9, IP: "1.1.1.1", Samples: 3},
	}}
	AnnotateReturnRoute(&r)
	require.Equal(t, "CN2（类型待确认）", r.Line)
	require.Contains(t, strings.Join(r.Evidence, " "), "TTL 5、8")
	require.NotContains(t, strings.Join(r.Evidence, " "), "1.1.1.1")
}
