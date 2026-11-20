// Preserve fractional usage: there are no buckets or rounded color stops.
export function usagePercent(value: number): number {
	return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export function usageColor(value: number): string {
	const hue = 120 * (1 - usagePercent(value) / 100);
	return `hsl(${hue} var(--usage-saturation, 75%) var(--usage-lightness, 45%))`;
}

// Remaining time runs in the opposite direction: full is green, expiry is red.
export function remainingTimeColor(value: number): string {
	return `hsl(${usagePercent(value) * 1.2} var(--usage-saturation, 75%) var(--usage-lightness, 45%))`;
}
