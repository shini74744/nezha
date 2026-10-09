import { describe, it, expect } from "vitest";
import {
	hasReturnCoordinates,
	returnMapData,
	returnMapFrame,
} from "@/lib/return-route-map";
import type { ReturnHop } from "@/lib/network-insight-api";
const hop = (ttl: number, longitude = 120, latitude = 30): ReturnHop => ({
	ttl,
	samples: 3,
	longitude,
	latitude,
	ip: "1.1.1.1",
});
describe("return route map data", () => {
	it.each([
		{ latitude: undefined },
		{ longitude: undefined },
		{ latitude: 91 },
		{ longitude: -181 },
		{ latitude: NaN },
		{ longitude: Infinity },
		{ latitude: 0, longitude: 0 },
		{ samples: 0 },
		{ ip_hidden: true },
	])("omits unreliable coordinates %j", (patch) => {
		expect(hasReturnCoordinates({ ...hop(1), ...patch })).toBe(false);
	});
	it("accepts valid zero axes and deduplicates colocated hops without altering order", () => {
		const original = [hop(3, 0, 30), hop(1, 120, 0), hop(2, 120, 0)],
			copy = JSON.stringify(original);
		const data = returnMapData(original);
		expect(data.points).toHaveLength(2);
		expect(data.points[0].hops.map((h) => h.ttl)).toEqual([1, 2]);
		expect(data.segments).toHaveLength(1);
		expect(JSON.stringify(original)).toBe(copy);
	});
	it("never connects across missing TTLs, missing coordinates or ECMP replies", () => {
		expect(returnMapData([hop(1), hop(3, 130)]).segments).toEqual([]);
		expect(
			returnMapData([hop(1), { ttl: 2, samples: 0 }, hop(3, 130)]).segments,
		).toEqual([]);
		expect(
			returnMapData([hop(1), hop(2, 121), hop(2, 122), hop(3, 130)]).segments,
		).toEqual([]);
	});
	it("joins only adjacent single replies", () => {
		const data = returnMapData([hop(1, 120), hop(2, 121), hop(3, 122)]);
		expect(data.located).toBe(3);
		expect(data.segments.map((s) => s.ttl)).toEqual([1, 2]);
	});
	it("fits antimeridian crossings in a short window and keeps single-point bounds finite", () => {
		const data = returnMapData([hop(1, 179), hop(2, -179)]);
		const frame = returnMapFrame(data.points);
		expect(Math.abs(frame.longitude)).toBe(180);
		expect(frame.lonSpan).toBe(12);
		expect(
			returnMapFrame(returnMapData([hop(1)]).points).latSpan,
		).toBeGreaterThan(0);
		expect(returnMapData([{ ttl: 1, samples: 3 }]).points).toEqual([]);
	});
});
