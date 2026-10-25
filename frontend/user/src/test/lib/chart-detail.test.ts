import { describe, expect, it } from "vitest";
import {
	detailDateInput,
	detailDateLabel,
	parseDetailDate,
	normalizeDetailPoints,
	nearestDetailIndex,
	detailPlotPoints,
	detailWindow,
	detailInterval,
} from "@/lib/chart-detail";
const ts = Date.parse("2026-10-26T00:00:00+08:00"),
	series = [{ key: "value", label: "CPU", color: "blue" }];
describe("detailed chart time and actual samples", () => {
	it("uses Beijing time independently of the browser timezone and rejects invalid calendar dates", () => {
		expect(detailDateInput(ts)).toBe("2026-10-26T00:00:00");
		expect(detailDateLabel(ts)).toBe("2026-10-26 00:00:00");
		expect(parseDetailDate("2026-10-26T00:00")).toBe(ts);
		expect(parseDetailDate("2026-10-26T00:00:00.000")).toBe(ts);
		expect(parseDetailDate("2026-10-26T00:00:00.789")).toBe(ts + 789);
		expect(parseDetailDate("2026-02-30T00:00:00")).toBeUndefined();
		expect(parseDetailDate("not a date")).toBeUndefined();
	});
	it("sorts and copies input, drops invalid times, and preserves missing values as gaps", () => {
		const input = [
			{ timeStamp: String(ts + 30000), value: Infinity },
			{ timeStamp: String(ts), value: 12 },
			{ timeStamp: "invalid", value: 9 },
			{ timeStamp: null, value: 9 },
			{ timeStamp: String(ts), value: 13 },
		];
		const original = JSON.stringify(input),
			points = normalizeDetailPoints(input, series);
		expect(points).toEqual([
			{ ts, value: 13 },
			{ ts: ts + 30000, value: null },
		]);
		expect(JSON.stringify(input)).toBe(original);
		input[4].value = 50;
		expect(points[0].value).toBe(13);
	});
	it("accepts offline timestamps and never converts missing values to zero", () => {
		expect(
			normalizeDetailPoints(
				[{ ts, value: 0 }, { ts: ts + 1000 }],
				series,
				"ts",
			),
		).toEqual([
			{ ts, value: 0 },
			{ ts: ts + 1000, value: null },
		]);
	});
	it("finds actual nearest points, with deterministic ties and boundaries", () => {
		const points = [
			{ ts, value: 1 },
			{ ts: ts + 30000, value: 2 },
			{ ts: ts + 60000, value: 3 },
		];
		expect(nearestDetailIndex([], ts)).toBe(-1);
		expect(nearestDetailIndex(points, ts - 1000)).toBe(0);
		expect(nearestDetailIndex(points, ts + 15000)).toBe(0);
		expect(nearestDetailIndex(points, ts + 16000)).toBe(1);
		expect(nearestDetailIndex(points, ts + 90000)).toBe(2);
	});
	it("marks outages without inventing values and does not mutate records", () => {
		const points = [
			{ ts, value: 1 },
			{ ts: ts + 180000, value: 3 },
		];
		expect(detailPlotPoints(points, 30000, series)).toEqual([
			points[0],
			{ ts: ts + 30000, value: null },
			points[1],
		]);
		expect(points).toHaveLength(2);
	});
	it("rejects reversed, empty and out-of-data ranges but permits single-point ranges", () => {
		const points = [
			{ ts, value: 1 },
			{ ts: ts + 60000, value: 2 },
		];
		expect(detailWindow(points, ts, ts)).toEqual([ts, ts]);
		for (const [a, b] of [
			[ts + 60000, ts],
			[ts - 1, ts],
			[ts, ts + 60001],
			[ts + 1, ts + 59999],
		])
			expect(detailWindow(points, a, b)).toBeUndefined();
	});
	it("retains each historical granularity and infers realtime interval", () => {
		expect(detailInterval("1d", [])).toBe(30000);
		expect(detailInterval("7d", [])).toBe(1800000);
		expect(detailInterval("30d", [])).toBe(7200000);
		expect(
			detailInterval("realtime", [
				{ ts },
				{ ts: ts + 3000 },
				{ ts: ts + 6000 },
			]),
		).toBe(3000);
	});
});
