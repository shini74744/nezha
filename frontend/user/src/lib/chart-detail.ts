export type DetailPeriod = "realtime" | "last" | "1d" | "7d" | "30d";
export type DetailSeries = { key: string; label: string; color: string };
export type DetailPoint = { ts: number; [key: string]: number | null };
export type TimeWindow = [number, number];
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;

export function detailDateInput(ts: number): string {
	return new Date(ts + BEIJING_OFFSET).toISOString().slice(0, 19);
}
export function detailDateLabel(ts: number): string {
	return detailDateInput(ts).replace("T", " ");
}
export function parseDetailDate(value: string): number | undefined {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value))
		return;
	const normalized = value.length === 16 ? value + ":00" : value;
	const ts = Date.parse(normalized + "+08:00");
	if (!Number.isFinite(ts) || detailDateInput(ts) !== normalized.slice(0, 19))
		return;
	return ts;
}
export function detailInterval(
	period: DetailPeriod,
	points: DetailPoint[],
): number {
	if (period === "1d") return 30_000;
	if (period === "7d") return 1_800_000;
	if (period === "30d") return 7_200_000;
	const gaps = points
		.slice(1)
		.map((p, i) => p.ts - points[i].ts)
		.filter((x) => x > 0)
		.sort((a, b) => a - b);
	return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 3_000;
}
export function normalizeDetailPoints(
	data: readonly Record<string, unknown>[],
	series: DetailSeries[],
	timeKey = "timeStamp",
): DetailPoint[] {
	const rows = new Map<number, DetailPoint>();
	for (const item of data) {
		const raw = item[timeKey];
		if (raw === null || raw === undefined || raw === "") continue;
		const ts = Number(raw);
		if (
			!Number.isFinite(ts) ||
			ts <= 0 ||
			!Number.isFinite(new Date(ts).getTime())
		)
			continue;
		const row: DetailPoint = rows.get(ts) ?? { ts };
		for (const { key } of series) {
			const value = item[key];
			row[key] =
				typeof value === "number" && Number.isFinite(value) ? value : null;
		}
		rows.set(ts, row);
	}
	return [...rows.values()].sort((a, b) => a.ts - b.ts);
}
export function nearestDetailIndex(
	points: readonly DetailPoint[],
	ts: number,
): number {
	if (!points.length) return -1;
	let lo = 0,
		hi = points.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (points[mid].ts < ts) lo = mid + 1;
		else hi = mid;
	}
	if (lo === 0) return 0;
	if (lo === points.length) return lo - 1;
	return ts - points[lo - 1].ts <= points[lo].ts - ts ? lo - 1 : lo;
}
export function detailPlotPoints(
	points: DetailPoint[],
	interval: number,
	series: DetailSeries[],
): DetailPoint[] {
	const result: DetailPoint[] = [];
	for (const point of points) {
		const previous = result[result.length - 1];
		if (previous && point.ts - previous.ts > interval * 2) {
			result.push({
				ts: previous.ts + interval,
				...Object.fromEntries(series.map((s) => [s.key, null])),
			});
		}
		result.push(point);
	}
	return result;
}
export function detailWindow(
	points: DetailPoint[],
	start: number,
	end: number,
	bounds?: TimeWindow,
): TimeWindow | undefined {
	if (
		(!points.length && !bounds) ||
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		start > end
	)
		return;
	if (start < (bounds?.[0] ?? points[0].ts) || end > (bounds?.[1] ?? points[points.length - 1].ts)) return;
	if (!bounds && !points.some((p) => p.ts >= start && p.ts <= end)) return;
	return [start, end];
}
