import { describe, expect, it } from "vitest";
import {
	graphFor,
	layoutGraph,
	selectedPaths,
	sourceColor,
} from "@/lib/bgp-graph";
import type { BGPGraph, BGPTopology } from "@/lib/network-insight-api";

const as = (asn: number) => ({ asn, name: `AS${asn}`, tier1: false });
const old: BGPTopology = {
	family: "IPv4",
	prefix: "8.8.8.0/24",
	status: "ok",
	source: "RIPE RIS",
	observed_at: "2026-10-06",
	total: 5,
	paths: [
		{ origin: as(10), direct: as(20), second: as(30), count: 3 },
		{ origin: as(10), direct: as(40), second: as(50), count: 2 },
	],
};
const graph = (): BGPGraph => ({
	...graphFor(old),
	legacy: false,
	paths: [
		{ asns: [10, 20, 30, 60, 70, 80], count: 3, collector_count: 2 },
		{ asns: [10, 40, 50], count: 2, collector_count: 1 },
	],
	nodes: [
		...graphFor(old).nodes,
		...[60, 70, 80].map((asn, i) => ({
			...as(asn),
			layer: 3 + i,
			role: "transit" as const,
			sample_count: 3,
			collector_count: 2,
		})),
	],
	edges: [
		...graphFor(old).edges,
		...[
			[30, 60],
			[60, 70],
			[70, 80],
		].map(([source, target]) => ({
			source,
			target,
			kind: "observed" as const,
			provenance: "RIPE",
			sample_count: 3,
			collector_count: 2,
		})),
	],
});
describe("BGP observation graph", () => {
	it("preserves real full paths and does not invent missing old history", () => {
		const g = graph();
		expect(graphFor({ ...old, graph: g })).toBe(g);
		const legacy = graphFor(old);
		expect(legacy.legacy).toBe(true);
		expect(legacy.paths.every((p) => p.asns.length <= 3)).toBe(true);
		expect(legacy.collector_count).toBe(0);
		expect(legacy.supplemental_status).toBe("unavailable");
	});
	it("highlights only the paths that were actually stored", () => {
		const g = graph();
		const a = selectedPaths(g, 70, null);
		expect([...a.nodes]).toEqual([10, 20, 30, 60, 70, 80]);
		expect(a.nodes.has(40)).toBe(false);
		expect(a.edges.has("70:80")).toBe(true);
		expect(selectedPaths(g, null, "10:40").nodes).toEqual(
			new Set([10, 40, 50]),
		);
		expect(selectedPaths(g, null, null).active).toBe(false);
	});
	it("lays out all layers, does not mutate snapshots and hides RS without making new edges", () => {
		const g = graph();
		const rs = g.nodes.find((n) => n.asn === 60);
		if (!rs) throw new Error("missing fixture route server");
		rs.route_server = true;
		const original = JSON.stringify(g),
			all = layoutGraph(g, true, false),
			hidden = layoutGraph(g, false, false),
			vertical = layoutGraph(g, true, true);
		expect(all.levels).toHaveLength(6);
		expect(all.nodes).toHaveLength(8);
		expect(hidden.nodes.some((n) => n.asn === 60)).toBe(false);
		expect(hidden.edges.some((e) => e.source === 30 && e.target === 70)).toBe(
			false,
		);
		expect(
			vertical.nodes.find((n) => n.asn === 80)?.y ?? Number.NaN,
		).toBeLessThan(vertical.nodes.find((n) => n.asn === 10)?.y ?? Number.NaN);
		expect(JSON.stringify(g)).toBe(original);
		for (const n of all.nodes) {
			expect(Number.isFinite(n.x + n.y)).toBe(true);
		}
	});
	it("handles empty and wide graphs deterministically", () => {
		const g = graph();
		g.nodes = [];
		g.edges = [];
		g.paths = [];
		expect(layoutGraph(g, false, false).nodes).toEqual([]);
		const many = {
			...g,
			nodes: Array.from({ length: 256 }, (_, i) => ({
				...as(i + 1),
				layer: i % 6,
				role: "transit" as const,
				sample_count: 1,
				collector_count: 1,
			})),
		};
		expect(layoutGraph(many, true, false)).toEqual(
			layoutGraph(many, true, false),
		);
		expect(sourceColor(1299)).toBe(sourceColor(1299));
	});
	it("uses the nearest observed layer in old aggregates", () => {
		const converted = graphFor({
			...old,
			paths: [...old.paths, { origin: as(30), count: 1 }],
		});
		expect(converted.nodes.find((n) => n.asn === 30)?.role).toBe("origin");
	});
});
