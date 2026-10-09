import { describe, expect, it } from "vitest";
import { compareBGP, completedBGPSnapshots } from "@/lib/bgp-compare";
import type { BGPTopology } from "@/lib/network-insight-api";

const topology = (paths: number[][]): BGPTopology => ({
	family: "IPv4",
	prefix: "8.8.8.0/24",
	status: "ok",
	source: "test",
	total: paths.length,
	paths: [
		{
			origin: { asn: 1, name: "", tier1: false },
			direct: { asn: 2, name: "", tier1: false },
			count: 1,
		},
	],
	graph: {
		version: 1,
		nodes: [],
		edges: [],
		paths: paths.map((asns) => ({ asns, count: 1, collector_count: 1 })),
		observed_path_count: paths.length,
		included_path_count: paths.length,
		collector_count: 1,
		truncated: false,
		supplemental_edges: [],
		supplemental_status: "ok",
		annotation_status: "ok",
	},
});
describe("BGP snapshot comparison", () => {
	it("compares ordered unique paths, samples and AS presence", () => {
		const a = topology([
				[1, 2, 3],
				[1, 2, 3],
				[1, 4],
			]),
			b = topology([
				[1, 2, 3],
				[1, 3, 2],
				[1, 5],
			]);
		const d = compareBGP(a, b);
		expect(d.rows.map((r) => r.kind).sort()).toEqual(
			["added", "added", "removed", "samples"].sort(),
		);
		expect(d.addedAS).toEqual([5]);
		expect(d.removedAS).toEqual([4]);
	});
	it("ignores path order, names, graph layout and supplemental edges", () => {
		const a = topology([
				[1, 2],
				[1, 3],
			]),
			b = topology([
				[1, 3],
				[1, 2],
			]);
		b.graph!.supplemental_edges = [
			{
				source: 1,
				target: 999,
				kind: "supplemental",
				provenance: "test",
				sample_count: 1,
				collector_count: 1,
			},
		];
		expect(compareBGP(a, b).rows.every((r) => r.kind === "same")).toBe(true);
		expect(compareBGP(a, b).addedAS).toEqual([]);
	});
	it("does not treat failed or missing snapshots as route withdrawals", () => {
		const a = topology([[1, 2]]),
			b = topology([]);
		b.status = "error";
		for (const d of [
			compareBGP(a, b),
			compareBGP(a),
			compareBGP(undefined, b),
		]) {
			expect(d.comparable).toBe(false);
			expect(d.rows).toEqual([]);
		}
	});
	it("marks prefix changes, redaction and truncation", () => {
		const a = topology([[1, 2]]),
			b = topology([[1, 3]]);
		b.prefix = "1.1.1.0/24";
		b.graph!.truncated = true;
		expect(compareBGP(a, b)).toMatchObject({
			prefixChanged: true,
			truncated: true,
		});
		delete b.prefix;
		expect(compareBGP(a, b)).toMatchObject({
			prefixChanged: false,
			prefixUnknown: true,
		});
	});
	it("compares both sides at legacy summary depth when either is legacy", () => {
		const a = topology([[1, 2, 3, 4]]),
			b = topology([[1, 2, 3, 5]]);
		delete a.graph;
		const d = compareBGP(a, b);
		expect(d.legacy).toBe(true);
		expect(d.rows).toHaveLength(1);
		expect(d.rows[0].kind).toBe("same");
	});
	it("deduplicates and excludes incomplete or invalid snapshots", () => {
		expect(
			completedBGPSnapshots([
				{ state: "complete", finished_at: 1 },
				{ state: "complete", finished_at: 3 },
				{ state: "complete", finished_at: 1 },
				{ state: "running", finished_at: 5 },
				{ state: "complete", finished_at: NaN },
			]).map((s) => s.finished_at),
		).toEqual([3, 1]);
	});
});
