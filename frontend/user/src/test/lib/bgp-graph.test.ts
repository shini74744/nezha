import { describe, expect, it } from "vitest";
import {
	coreGraph,
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

describe("BGP core projection", () => {
	const dense = (single = false) =>
		graphFor({
			...old,
			total: 600,
			paths: Array.from({ length: 80 }, (_, i) => ({
				origin: as(10),
				direct: as(100 + (i % 12)),
				second: as(1000 + i),
				count: single ? 1 : i < 12 ? 20 - i : 1,
			})),
		});
	it("leaves small graphs and empty snapshots unchanged", () => {
		const small = graph();
		expect(coreGraph(small)).toBe(small);
		const empty = graphFor({ ...old, paths: [] });
		expect(coreGraph(empty)).toBe(empty);
	});
	it("bounds dense layers, folds one-sample tails and preserves original denominators", () => {
		const g = dense(),
			before = JSON.stringify(g),
			core = coreGraph(g);
		expect(core.nodes.length).toBeLessThanOrEqual(32);
		expect(core.nodes.length).toBeGreaterThan(2);
		for (const layer of new Set(core.nodes.map((n) => n.layer)))
			expect(
				core.nodes.filter((n) => n.layer === layer).length,
			).toBeLessThanOrEqual(8);
		expect(core.nodes.some((n) => n.asn === 1000)).toBe(true);
		expect(core.nodes.some((n) => n.asn === 1079)).toBe(false);
		expect(core.observed_path_count).toBe(g.observed_path_count);
		expect(core.included_path_count).toBe(g.included_path_count);
		expect(core.paths).toBe(g.paths);
		expect(JSON.stringify(g)).toBe(before);
		for (const edge of core.edges) expect(g.edges).toContain(edge);
		for (const node of core.nodes) {
			expect(g.nodes).toContain(node);
			expect(
				g.paths.some((p) => {
					const i = p.asns.indexOf(node.asn);
					return (
						i >= 0 &&
						p.asns
							.slice(0, i + 1)
							.every((asn) => core.nodes.some((n) => n.asn === asn))
					);
				}),
			).toBe(true);
		}
	});
	it("makes deterministic choices independent of response array ordering", () => {
		const g = dense();
		const reversed = {
			...g,
			nodes: [...g.nodes].reverse(),
			edges: [...g.edges].reverse(),
			paths: [...g.paths].reverse(),
		};
		const ids = (value: BGPGraph) =>
			coreGraph(value)
				.nodes.map((n) => n.asn)
				.sort((a, b) => a - b);
		expect(ids(g)).toEqual(ids(reversed));
	});
	it("keeps a useful sparse preview and preserves every origin", () => {
		const g = dense(true);
		g.nodes.push({
			...as(9999),
			layer: 0,
			role: "origin",
			sample_count: 1,
			collector_count: 1,
		});
		const core = coreGraph(g);
		expect(core.nodes.some((n) => n.asn === 9999)).toBe(true);
		expect(core.nodes.length).toBeGreaterThan(2);
		const star = graphFor({
			...old,
			paths: Array.from({ length: 50 }, (_, i) => ({
				origin: as(10),
				direct: as(200 + i),
				count: 1,
			})),
		});
		expect(coreGraph(star).nodes).toHaveLength(9);
	});
	it("does not jump over missing intermediate nodes or missing observed edges", () => {
		const g = dense();
		g.nodes.push({
			...as(999),
			layer: 4,
			role: "transit",
			sample_count: 600,
			collector_count: 20,
		});
		g.paths.unshift({ asns: [10, 888, 999], count: 600, collector_count: 20 });
		g.paths.unshift({ asns: [10, 999], count: 600, collector_count: 20 });
		const core = coreGraph(g);
		expect(core.nodes.some((n) => n.asn === 999)).toBe(false);
		expect(core.edges.some((e) => e.source === 10 && e.target === 999)).toBe(
			false,
		);
	});
	it("caps total nodes on a deep graph and preserves route-server filtering semantics", () => {
		const g = dense(),
			base = graphFor(old);
		g.nodes = [base.nodes[0]];
		g.edges = [];
		g.paths = [];
		for (let branch = 0; branch < 8; branch++) {
			const asns = [10];
			for (let layer = 1; layer <= 8; layer++) {
				const asn = 100 + branch * 10 + layer;
				g.nodes.push({
					...as(asn),
					role: layer === 1 ? "direct" : "transit",
					layer,
					sample_count: 20 - branch,
					collector_count: 2,
					route_server: asn === 102,
				});
				g.edges.push({
					source: asns[asns.length - 1],
					target: asn,
					kind: "observed",
					provenance: "test",
					sample_count: 20 - branch,
					collector_count: 2,
				});
				asns.push(asn);
			}
			g.paths.push({ asns, count: 20 - branch, collector_count: 2 });
		}
		const core = coreGraph(g);
		expect(core.nodes).toHaveLength(32);
		const hidden = layoutGraph(core, false, false);
		expect(hidden.nodes.some((n) => n.asn === 102)).toBe(false);
		expect(hidden.edges.some((e) => e.source === 101 && e.target === 103)).toBe(
			false,
		);
		expect(selectedPaths(g, 103, null).nodes.has(102)).toBe(true);
	});
});
