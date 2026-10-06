package networkinsight

import (
	"fmt"
	"sort"
	"strings"
)

const maxGraphNodes = 256
const maxGraphEdges = 2048
const maxGraphPaths = 1024

type GraphNode struct {
	ASNode
	Layer       int    `json:"layer"`
	Role        string `json:"role"`
	Samples     int    `json:"sample_count"`
	Collectors  int    `json:"collector_count"`
	NearTier1   bool   `json:"near_tier1,omitempty"`
	RouteServer bool   `json:"route_server,omitempty"`
}
type GraphEdge struct {
	Source     uint32 `json:"source"`
	Target     uint32 `json:"target"`
	Kind       string `json:"kind"`
	Provenance string `json:"provenance"`
	Samples    int    `json:"sample_count"`
	Collectors int    `json:"collector_count"`
}
type ObservedPath struct {
	ASNs       []uint32 `json:"asns"`
	Count      int      `json:"count"`
	Collectors int      `json:"collector_count"`
}
type BGPGraph struct {
	Version            int            `json:"version"`
	Nodes              []GraphNode    `json:"nodes"`
	Edges              []GraphEdge    `json:"edges"`
	Paths              []ObservedPath `json:"paths"`
	Total              int            `json:"observed_path_count"`
	Included           int            `json:"included_path_count"`
	Collectors         int            `json:"collector_count"`
	Truncated          bool           `json:"truncated"`
	Supplemental       []GraphEdge    `json:"supplemental_edges"`
	SupplementalStatus string         `json:"supplemental_status"`
	AnnotationStatus   string         `json:"annotation_status"`
}
type pathSamples struct {
	path       []uint32
	count      int
	collectors map[string]bool
}

// Normalize prepends, reject AS sets/loops and never expose collector peer IPs.
func normalizedPath(r Route, prefix string) []uint32 {
	if r.Prefix != prefix || len(r.Path) == 0 || len(r.Path) > 128 {
		return nil
	}
	p := make([]uint32, 0, len(r.Path))
	seen := map[uint32]bool{}
	for _, asn := range r.Path {
		if asn == 0 {
			return nil
		}
		if len(p) > 0 && p[len(p)-1] == asn {
			continue
		}
		if seen[asn] {
			return nil
		}
		seen[asn] = true
		p = append(p, asn)
	}
	for i, j := 0, len(p)-1; i < j; i, j = i+1, j-1 {
		p[i], p[j] = p[j], p[i]
	}
	return p
}
func collectorID(source string) string {
	if source == "" {
		return ""
	}
	return strings.SplitN(source, "-", 2)[0]
}
func BuildGraph(routes []Route, prefix string) *BGPGraph {
	g := &BGPGraph{Version: 1, Nodes: []GraphNode{}, Edges: []GraphEdge{}, Paths: []ObservedPath{}, Supplemental: []GraphEdge{}, SupplementalStatus: "unavailable", AnnotationStatus: "unavailable"}
	seen := map[string]bool{}
	paths := map[string]*pathSamples{}
	collectors := map[string]bool{}
	for _, r := range routes {
		p := normalizedPath(r, prefix)
		if len(p) == 0 {
			continue
		}
		k := fmt.Sprint(p)
		unique := r.Source + ":" + k
		if seen[unique] {
			continue
		}
		seen[unique] = true
		if paths[k] == nil {
			paths[k] = &pathSamples{path: p, collectors: map[string]bool{}}
		}
		v := paths[k]
		v.count++
		g.Total++
		if c := collectorID(r.Source); c != "" {
			v.collectors[c] = true
			collectors[c] = true
		}
	}
	g.Collectors = len(collectors)
	ordered := make([]*pathSamples, 0, len(paths))
	for _, p := range paths {
		ordered = append(ordered, p)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].count != ordered[j].count {
			return ordered[i].count > ordered[j].count
		}
		return fmt.Sprint(ordered[i].path) < fmt.Sprint(ordered[j].path)
	})
	nodes := map[uint32]*GraphNode{}
	edges := map[[2]uint32]*GraphEdge{}
	nodeCollectors := map[uint32]map[string]bool{}
	edgeCollectors := map[[2]uint32]map[string]bool{}
	for _, p := range ordered {
		newNodes, newEdges := 0, 0
		for i, asn := range p.path {
			if nodes[asn] == nil {
				newNodes++
			}
			if i > 0 && edges[[2]uint32{p.path[i-1], asn}] == nil {
				newEdges++
			}
		}
		if len(g.Paths) >= maxGraphPaths || len(nodes)+newNodes > maxGraphNodes || len(edges)+newEdges > maxGraphEdges {
			g.Truncated = true
			continue
		}
		g.Paths = append(g.Paths, ObservedPath{ASNs: p.path, Count: p.count, Collectors: len(p.collectors)})
		g.Included += p.count
		for layer, asn := range p.path {
			n := nodes[asn]
			if n == nil {
				n = &GraphNode{ASNode: node(asn), Layer: layer, Role: "transit"}
				nodes[asn] = n
				nodeCollectors[asn] = map[string]bool{}
			}
			if layer < n.Layer {
				n.Layer = layer
			}
			n.Samples += p.count
			for c := range p.collectors {
				nodeCollectors[asn][c] = true
			}
			if layer == 0 {
				n.Role = "origin"
			} else if layer == 1 && n.Role != "origin" {
				n.Role = "direct"
			}
			if layer > 0 {
				key := [2]uint32{p.path[layer-1], asn}
				e := edges[key]
				if e == nil {
					e = &GraphEdge{Source: key[0], Target: key[1], Kind: "observed", Provenance: "RIPE RIS"}
					edges[key] = e
					edgeCollectors[key] = map[string]bool{}
				}
				e.Samples += p.count
				for c := range p.collectors {
					edgeCollectors[key][c] = true
				}
			}
		}
	}
	for asn, n := range nodes {
		n.Collectors = len(nodeCollectors[asn])
		n.NearTier1 = asn == 3320
		if n.NearTier1 {
			n.Tier1 = false
		}
		g.Nodes = append(g.Nodes, *n)
	}
	sort.Slice(g.Nodes, func(i, j int) bool {
		a, b := g.Nodes[i], g.Nodes[j]
		if a.Layer != b.Layer {
			return a.Layer < b.Layer
		}
		if a.Samples != b.Samples {
			return a.Samples > b.Samples
		}
		return a.ASN < b.ASN
	})
	for k, e := range edges {
		e.Collectors = len(edgeCollectors[k])
		g.Edges = append(g.Edges, *e)
	}
	sort.Slice(g.Edges, func(i, j int) bool {
		a, b := g.Edges[i], g.Edges[j]
		if a.Source != b.Source {
			return a.Source < b.Source
		}
		return a.Target < b.Target
	})
	return g
}
