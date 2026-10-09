import { describe, it, expect } from "vitest";
import {
	finalReturnRTT,
	returnQuality,
	comparableReturnRoutes,
	completedReturnSnapshots,
	compareReturnHops,
	compareReturnSnapshots,
} from "@/lib/return-route-view";
import type { ReturnResult, InsightSnapshot } from "@/lib/network-insight-api";
const route = (overrides: Partial<ReturnResult> = {}): ReturnResult => ({
	id: "bj-ct",
	name: "北京",
	carrier: "电信",
	family: "IPv4",
	protocol: "tcp",
	status: "reached",
	comparison_key: "1",
	hops: [
		{ ttl: 1, samples: 3, rtt_ms: 1, stage: "origin" },
		{ ttl: 12, samples: 3, rtt_ms: 100, stage: "destination", ip_hidden: true },
	],
	...overrides,
});
const snap = (r: ReturnResult): InsightSnapshot => ({
	state: "complete",
	finished_at: 123,
	routes: [r],
});
describe("return final latency", () => {
	it("only averages target samples, including private destinations and zero", () => {
		expect(finalReturnRTT(route())).toBe(100);
		expect(
			finalReturnRTT(
				route({
					hops: [
						{ ttl: 9, samples: 2, stage: "destination", rtt_ms: 0 },
						{ ttl: 10, samples: 1, stage: "destination", rtt_ms: 90 },
						{ ttl: 11, samples: 3, rtt_ms: 1 },
					],
				}),
			),
		).toBe(30);
	});
	it("never substitutes last intermediate, failure or invalid samples", () => {
		for (const status of ["partial", "pending", "timeout"])
			expect(finalReturnRTT(route({ status }))).toBeUndefined();
		for (const n of [-1, NaN, Infinity])
			expect(
				finalReturnRTT(
					route({
						hops: [{ ttl: 1, samples: 3, stage: "destination", rtt_ms: n }],
					}),
				),
			).toBeUndefined();
		expect(
			finalReturnRTT(route({ hops: [{ ttl: 20, samples: 3, rtt_ms: 12 }] })),
		).toBeUndefined();
		expect(
			finalReturnRTT(
				route({
					hops: [{ ttl: 20, samples: 0, stage: "destination", rtt_ms: 12 }],
				}),
			),
		).toBeUndefined();
	});
	it("supports unannotated admin historical destination only", () => {
		expect(
			finalReturnRTT(
				route({
					target: "1.1.1.1",
					hops: [{ ttl: 5, ip: "1.1.1.1", samples: 3, rtt_ms: 12 }],
				}),
			),
		).toBe(12);
	});
});
describe("network quality category", () => {
	it("uses known network categories without inferring unknown transit", () => {
		for (const asn of ["4809", "9929", "58807"])
			expect(returnQuality({ ttl: 3, samples: 3, asn })).toBe("优质线路");
		for (const asn of ["4134", "4837", "58453", "9808"])
			expect(returnQuality({ ttl: 3, samples: 3, asn })).toBe("普通线路");
		for (const asn of ["23764", "10099", "2914", ""])
			expect(returnQuality({ ttl: 3, samples: 3, asn })).toBeUndefined();
		expect(
			returnQuality({ ttl: 3, samples: 3, asn: "4134", network: "电信 CN2" }),
		).toBe("优质线路");
		expect(returnQuality({ ttl: 3, samples: 0, asn: "4809" })).toBeUndefined();
	});
});
describe("snapshot comparison", () => {
	it("deduplicates and sorts completed history without mutating it", () => {
		const history = [
			{ state: "complete", finished_at: 10 },
			{ state: "running", finished_at: 20 },
			{ state: "complete", finished_at: 30 },
			{ state: "complete", finished_at: 10 },
			{ state: "idle" },
		];
		expect(completedReturnSnapshots(history).map((s) => s.finished_at)).toEqual(
			[30, 10],
		);
		expect(history[0].finished_at).toBe(10);
	});
	it("requires same target group and protocol; old hidden targets fail closed", () => {
		expect(comparableReturnRoutes(route(), route())).toBe(true);
		expect(
			comparableReturnRoutes(route(), route({ comparison_key: "2" })),
		).toBe(false);
		expect(comparableReturnRoutes(route(), route({ protocol: "icmp" }))).toBe(
			false,
		);
		expect(comparableReturnRoutes(route(), route({ family: "IPv6" }))).toBe(
			false,
		);
		expect(
			comparableReturnRoutes(
				route({ comparison_key: undefined }),
				route({ comparison_key: undefined }),
			),
		).toBe(false);
	});
	it("compares TTL sets independent of ECMP ordering, jitter and sample count", () => {
		const a = route({
			hops: [
				{ ttl: 2, samples: 3, asn: "4809", ip: "59.43.1.1", rtt_ms: 1 },
				{ ttl: 2, samples: 2, asn: "4809", ip: "59.43.1.2", rtt_ms: 2 },
			],
		});
		const b = route({ hops: [{ ...a.hops![1], rtt_ms: 22 }, a.hops![0]] });
		expect(compareReturnHops(a, b).every((h) => !h.changed)).toBe(true);
		b.hops!.push({ ttl: 4, samples: 0 });
		expect(compareReturnHops(a, b)[1].changed).toBe(true);
	});
	it("computes signed target delta and omits it for unlike targets", () => {
		const a = route(),
			b = route({
				hops: [
					{
						ttl: 10,
						stage: "destination",
						ip_hidden: true,
						samples: 3,
						rtt_ms: 112.3,
					},
				],
			});
		expect(
			compareReturnSnapshots(snap(a), snap(b), "IPv4")[0].delta,
		).toBeCloseTo(12.3);
		b.comparison_key = "2";
		expect(
			compareReturnSnapshots(snap(a), snap(b), "IPv4")[0].delta,
		).toBeUndefined();
	});
	it("includes additions/removals and filters family", () => {
		const a = snap(route());
		a.routes!.push(route({ id: "removed" }));
		const b = snap(route({ id: "new" }));
		b.routes!.push(route({ family: "IPv6" }));
		const rows = compareReturnSnapshots(a, b, "IPv4");
		expect(rows).toHaveLength(3);
		expect(rows.every((r) => r.changed && r.delta === undefined)).toBe(true);
	});
	it("latency-only jitter does not flag route changes", () => {
		const a = route(),
			b = structuredClone(a);
		b.hops![1].rtt_ms = 110;
		const row = compareReturnSnapshots(snap(a), snap(b), "IPv4")[0];
		expect(row.changed).toBe(false);
		expect(row.delta).toBe(10);
	});
});
