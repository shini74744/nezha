import type { BGPTopology, InsightSnapshot } from "./network-insight-api";

export function completedBGPSnapshots(history: InsightSnapshot[] = []) {
	const seen = new Set<number>();
	return history
		.filter((s) => {
			if (
				s.state !== "complete" ||
				!Number.isFinite(s.finished_at) ||
				!s.finished_at ||
				seen.has(s.finished_at)
			)
				return false;
			seen.add(s.finished_at);
			return true;
		})
		.sort((a, b) => b.finished_at! - a.finished_at!);
}
function paths(t: BGPTopology, legacy: boolean) {
	const out = new Map<string, number>();
	const items = legacy
		? (t.paths || []).map((p) => ({
				asns: [p.origin.asn, p.direct?.asn, p.second?.asn].filter(
					(n): n is number => !!n,
				),
				count: p.count,
			}))
		: t.graph!.paths;
	for (const p of items) {
		if (!p.asns.length) continue;
		const key = p.asns.join(" → ");
		out.set(
			key,
			(out.get(key) || 0) + (Number.isFinite(p.count) ? p.count : 0),
		);
	}
	return out;
}
export function compareBGP(before?: BGPTopology, after?: BGPTopology) {
	const legacy =
		!before?.graph ||
		!after?.graph ||
		!!before.graph.legacy ||
		!!after.graph.legacy;
	const comparable =
		!!before &&
		!!after &&
		before.family === after.family &&
		before.status === "ok" &&
		after.status === "ok";
	const left = comparable ? paths(before, legacy) : new Map<string, number>(),
		right = comparable ? paths(after, legacy) : new Map<string, number>();
	const rows = [...new Set([...left.keys(), ...right.keys()])]
		.sort()
		.map((path) => ({
			path,
			before: left.get(path),
			after: right.get(path),
			kind: !left.has(path)
				? "added"
				: !right.has(path)
					? "removed"
					: left.get(path) !== right.get(path)
						? "samples"
						: "same",
		}));
	const asns = (p: Map<string, number>) =>
		new Set([...p.keys()].flatMap((key) => key.split(" → ").map(Number)));
	const a = asns(left),
		b = asns(right);
	return {
		comparable,
		legacy,
		rows,
		addedAS: [...b].filter((n) => !a.has(n)).sort((x, y) => x - y),
		removedAS: [...a].filter((n) => !b.has(n)).sort((x, y) => x - y),
		truncated: !!before?.graph?.truncated || !!after?.graph?.truncated,
		prefixChanged:
			!!before?.prefix && !!after?.prefix && before.prefix !== after.prefix,
		prefixUnknown: !before?.prefix || !after?.prefix,
	};
}
