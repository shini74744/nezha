// Agent rates are bytes/second. Network units are decimal megabits/gigabits.
const safeRate = (rate: number) =>
	Number.isFinite(rate) ? Math.max(0, rate) : 0;
export function formatMbps(bytesPerSecond: number): string {
	return `${((safeRate(bytesPerSecond) / 1_000_000) * 8).toFixed(1)} Mbps`;
}
export function networkRateParts(bytesPerSecond: number) {
	const mbps = (safeRate(bytesPerSecond) / 1_000_000) * 8;
	// Standard SI network units: 1000 Mbps = 1 Gbps.
	return mbps >= 1000
		? { value: (mbps / 1000).toFixed(2), unit: "Gbps" }
		: { value: mbps.toFixed(1), unit: "Mbps" };
}
export function formatNetworkRate(bytesPerSecond: number) {
	const { value, unit } = networkRateParts(bytesPerSecond);
	return `${value} ${unit}`;
}
