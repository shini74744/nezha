import type { ReturnHop } from "./network-insight-api";

export type MapPoint = {
	key: string;
	latitude: number;
	longitude: number;
	hops: ReturnHop[];
};
export function hasReturnCoordinates(
	h: ReturnHop,
): h is ReturnHop & { latitude: number; longitude: number } {
	return (
		h.samples > 0 &&
		!h.ip_hidden &&
		typeof h.latitude === "number" &&
		typeof h.longitude === "number" &&
		Number.isFinite(h.latitude) &&
		Number.isFinite(h.longitude) &&
		Math.abs(h.latitude) <= 90 &&
		Math.abs(h.longitude) <= 180 &&
		(h.latitude !== 0 || h.longitude !== 0)
	);
}
export function returnMapData(input: ReturnHop[]) {
	const hops = input
		.filter((h) => Number.isInteger(h.ttl) && h.ttl >= 1 && h.ttl <= 30)
		.slice(0, 90)
		.sort((a, b) => a.ttl - b.ttl);
	const points = new Map<string, MapPoint>(),
		byTTL = new Map<number, ReturnHop[]>();
	for (const hop of hops) {
		byTTL.set(hop.ttl, [...(byTTL.get(hop.ttl) || []), hop]);
		if (!hasReturnCoordinates(hop)) continue;
		const key = hop.latitude.toFixed(4) + ":" + hop.longitude.toFixed(4);
		const point = points.get(key) || {
			key,
			latitude: hop.latitude,
			longitude: hop.longitude,
			hops: [],
		};
		point.hops.push(hop);
		points.set(key, point);
	}
	const segments: Array<{
		from: [number, number];
		to: [number, number];
		ttl: number;
	}> = [];
	for (const [ttl, rows] of byTTL) {
		const next = byTTL.get(ttl + 1);
		// TTL-adjacent single replies only. Multipath probes do not identify an edge.
		if (rows.length !== 1 || next?.length !== 1) continue;
		const a = rows[0],
			b = next[0];
		if (!hasReturnCoordinates(a) || !hasReturnCoordinates(b)) continue;
		if (a.latitude === b.latitude && a.longitude === b.longitude) continue;
		segments.push({
			from: [a.longitude, a.latitude],
			to: [b.longitude, b.latitude],
			ttl,
		});
	}
	return {
		points: [...points.values()],
		segments,
		located: hops.filter(hasReturnCoordinates).length,
		total: hops.length,
		unlocated: hops.filter((h) => !hasReturnCoordinates(h)),
	};
}
// Choose the shortest longitude window so a dateline crossing does not span the globe.
export function returnMapFrame(points: MapPoint[]) {
	if (!points.length)
		return { longitude: 0, latitude: 0, lonSpan: 360, latSpan: 180 };
	const longitudes = points
		.map((p) => (p.longitude + 360) % 360)
		.sort((a, b) => a - b);
	let gap = -1,
		start = 0;
	for (let i = 0; i < longitudes.length; i++) {
		const next =
			longitudes[(i + 1) % longitudes.length] +
			(i === longitudes.length - 1 ? 360 : 0);
		if (next - longitudes[i] > gap) {
			gap = next - longitudes[i];
			start = next % 360;
		}
	}
	const span = 360 - gap,
		minLat = Math.min(...points.map((p) => p.latitude)),
		maxLat = Math.max(...points.map((p) => p.latitude));
	return {
		longitude: ((start + span / 2 + 180) % 360) - 180,
		latitude: (minLat + maxLat) / 2,
		lonSpan: Math.max(12, span),
		latSpan: Math.max(8, maxLat - minLat),
	};
}

export function returnUnlocatedReason(h: ReturnHop): string {
 if (!h.samples) return "未响应";
 if (h.ip_hidden) return "地址已隐藏";
 const ip = h.ip?.toLowerCase() || "";
 const parts = ip.split(".").map(Number);
 const internal4 = parts.length === 4 && parts.every(v => Number.isInteger(v) && v >= 0 && v <= 255) && (
  parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
  (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254) ||
  (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
 );
 const internal6 = ip.includes(":") && (/^(fc|fd|fe[89ab])/i.test(ip) || ip === "::1");
 if (internal4 || internal6) return "内网或本地地址，无公网定位";
 return "数据源缺少有效经纬度";
}
