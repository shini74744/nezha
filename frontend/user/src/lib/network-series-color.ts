/** A stable identity owns its hue; neither list position nor a repeating palette is used. */
export function networkSeriesColor(identity: number | string): string {
	let seed: number;
	if (typeof identity === "number" && Number.isFinite(identity))
		seed = identity;
	else {
		seed = 2166136261;
		for (const char of String(identity))
			seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
	}
	const hue = (((seed * 137.50776405003785) % 360) + 360) % 360;
	return `hsl(${hue.toFixed(5)} var(--network-series-saturation, 68%) var(--network-series-lightness, 43%))`;
}
