import { describe, it, expect } from "vitest";
import {
	networkInterfaceMetric,
	networkRate,
	networkRateHistory,
	networkHistoricalPoints,
} from "@/lib/network-interface-rates";
import { createServer } from "@/test/fixtures";
describe("per-interface rate identity", () => {
	const server = createServer({
		id: 7,
		state: {
			net_out_speed: 60 * 1024 ** 2,
			net_in_speed: 40 * 1024 ** 2,
			network_interfaces: [
				{
					name: "eth0",
					out_speed: 20 * 1024 ** 2,
					in_speed: 10 * 1024 ** 2,
					available: true,
				},
				{
					name: "eth1",
					out_speed: 40 * 1024 ** 2,
					in_speed: 30 * 1024 ** 2,
					available: true,
				},
				{ name: "idle", out_speed: 0, in_speed: 0, available: true },
				{ name: "warming", out_speed: 99, in_speed: 99, available: false },
			],
		},
	});
	it("preserves totals and selects exact names, never substitutes another interface", () => {
		expect(networkRate(server, "")).toEqual({
			upload: 60 * 1024 ** 2,
			download: 40 * 1024 ** 2,
		});
		expect(networkRate(server, "eth1")).toEqual({
			upload: 40 * 1024 ** 2,
			download: 30 * 1024 ** 2,
		});
		expect(networkRate(server, "idle")).toEqual({ upload: 0, download: 0 });
		expect(networkRate(server, "warming")).toEqual({
			upload: null,
			download: null,
		});
		expect(networkRate(server, "renamed")).toEqual({
			upload: null,
			download: null,
		});
	});
	it("keeps stable collision-free history keys", () => {
		expect(networkInterfaceMetric("eth0", "in")).toBe("nic_65746830_in_speed");
		expect(networkInterfaceMetric("", "out")).toBe("net_out_speed");
		expect(networkInterfaceMetric("eth.0", "in")).not.toBe(
			networkInterfaceMetric("eth_0", "in"),
		);
	});
	it("recomputes history on selection without mixing the old series", () => {
		const history = [
			{ now: 1000, servers: [server] },
			{ now: 2000, servers: [createServer({ id: 7 })] },
		];
		const rows = networkRateHistory(history, server, 3000, "eth1");
		expect(rows.map((r) => r.upload)).toEqual([40, null, 40]);
		expect(networkRateHistory(history, server, 3000, "")[2].upload).toBe(60);
	});
	it("keeps missing historical readings as gaps rather than zero", () => {
		expect(
			networkHistoricalPoints([
				[{ ts: 1, value: 1024 ** 2 }],
				[{ ts: 2, value: 0 }],
			]),
		).toEqual([
			{ timeStamp: "1", upload: 1, download: null },
			{ timeStamp: "2", upload: null, download: 0 },
		]);
	});

	it("breaks lines when both directions missed an entire history bucket", () => {
		const points = networkHistoricalPoints([
			[
				{ ts: 0, value: 0 },
				{ ts: 90000, value: 1024 ** 2 },
			],
			[
				{ ts: 0, value: 0 },
				{ ts: 90000, value: 1024 ** 2 },
			],
		]);
		expect(points).toEqual([
			{ timeStamp: "0", upload: 0, download: 0 },
			{ timeStamp: "30000", upload: null, download: null },
			{ timeStamp: "90000", upload: 1, download: 1 },
		]);
	});
});
