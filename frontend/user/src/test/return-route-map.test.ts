import { describe, it, expect } from "vitest";
import {
	hasReturnCoordinates,
	returnMapData,
	returnMapFrame,
	returnUnlocatedReason,
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

it("explains the screenshot's missing early hops without fabricating positions", () => {
	const hops: ReturnHop[] = [
		{ ttl: 1, samples: 0 },
		{ ttl: 2, samples: 3, ip: "10.38.95.0" },
		{
			ttl: 3,
			samples: 3,
			ip: "9.34.128.126",
			location: "美国国防部网络信息中心",
		},
		hop(4, 114.17, 22.32),
	];
	expect(returnMapData(hops).points.map((p) => p.hops[0].ttl)).toEqual([4]);
	expect(hops.slice(0, 3).map(returnUnlocatedReason)).toEqual([
		"未响应",
		"内网或本地地址",
		"暂无定位信息",
	]);
	expect(returnUnlocatedReason({ ttl: 1, samples: 3, ip_hidden: true })).toBe(
		"地址已隐藏",
	);
	for (const ip of [
		"172.16.0.1",
		"192.168.0.1",
		"100.64.1.1",
		"fd00::1",
		"fe80::1",
		"::1",
	])
		expect(returnUnlocatedReason({ ttl: 1, samples: 1, ip })).toContain("内网");
	for (const ip of ["172.32.0.1", "192.169.0.1", "100.128.0.1", "2001:4860::1"])
		expect(returnUnlocatedReason({ ttl: 1, samples: 1, ip })).toContain(
			"暂无定位信息",
		);
});
