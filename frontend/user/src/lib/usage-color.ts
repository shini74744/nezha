// Preserve fractional usage: there are no buckets or rounded color stops.
export function usagePercent(value: number): number {
	return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export function usageColor(value: number): string {
	const hue = 120 * (1 - usagePercent(value) / 100);
	return `hsl(${hue} var(--usage-saturation, 75%) var(--usage-lightness, 45%))`;
}
