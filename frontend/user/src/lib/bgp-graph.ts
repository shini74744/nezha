import type {
	BGPGraph,
	BGPGraphEdge,
	BGPGraphNode,
	BGPTopology,
} from "./network-insight-api";
export const NODE_W = 132,
	NODE_H = 56;
export const roleLabel = (n: BGPGraphNode) =>
	n.route_server
		? "已识别的路由服务器"
		: n.role === "origin"
			? "前缀起源"
			: n.role === "direct"
				? "观测到的直接外层 hop"
				: "观测到的更外层 transit";
export const edgeKey = (e: Pick<BGPGraphEdge, "source" | "target">) =>
	`${e.source}:${e.target}`;
export function graphFor(topology: BGPTopology): BGPGraph {
	if (topology.graph?.version === 1) return topology.graph;
	// An old saved snapshot only has three-AS aggregates. Do not invent deeper hops.
	const nodes = new Map<number, BGPGraphNode>(),
		edges = new Map<string, BGPGraphEdge>();
	const paths = (topology.paths || []).map((p) => {
		const path = [p.origin, p.direct, p.second].filter((n) => !!n);
		path.forEach((n, i) => {
			const old = nodes.get(n.asn);
			if (old) {
				old.sample_count += p.count;
				old.layer = Math.min(old.layer, i);
				old.role =
					old.layer === 0 ? "origin" : old.layer === 1 ? "direct" : "transit";
			} else
				nodes.set(n.asn, {
					...n,
					layer: i,
					role: i === 0 ? "origin" : i === 1 ? "direct" : "transit",
					sample_count: p.count,
					collector_count: 0,
				});
			if (i) {
				const source = path[i - 1].asn,
					target = n.asn,
					k = edgeKey({ source, target }),
					e = edges.get(k);
				if (e) e.sample_count += p.count;
				else
					edges.set(k, {
						source,
						target,
						kind: "observed",
						provenance: topology.source,
						sample_count: p.count,
						collector_count: 0,
					});
			}
		});
		return { asns: path.map((n) => n.asn), count: p.count, collector_count: 0 };
	});
	return {
		version: 1,
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		paths,
		observed_path_count: topology.total,
		included_path_count: paths.reduce((s, p) => s + p.count, 0),
		collector_count: 0,
		truncated: false,
		supplemental_edges: [],
		supplemental_status: "unavailable",
		annotation_status: "unavailable",
		legacy: true,
	};
}
// Display-only projection. Keep the original paths, counts and annotations intact:
// selection and percentages still refer to the saved observation, not this subset.
export function coreGraph(graph: BGPGraph): BGPGraph {
	const maxNodes = 32,
		maxPerLayer = 8;
	const layers = new Map<number, number>();
	for (const node of graph.nodes)
		layers.set(node.layer, (layers.get(node.layer) ?? 0) + 1);
	if (
		graph.nodes.length <= maxNodes &&
		[...layers.values()].every((n) => n <= maxPerLayer)
	)
		return graph;

	const byASN = new Map(graph.nodes.map((n) => [n.asn, n]));
	const observed = new Set(
		graph.edges.filter((e) => e.kind === "observed").map(edgeKey),
	);
	const kept = new Set(
		graph.nodes.filter((n) => n.role === "origin").map((n) => n.asn),
	);
	const occupied = new Map<number, number>();
	for (const asn of kept) {
		const layer = byASN.get(asn)?.layer ?? 0;
		occupied.set(layer, (occupied.get(layer) ?? 0) + 1);
	}
	const comparePath = (a: number[], b: number[]) => {
		for (let i = 0; i < Math.min(a.length, b.length); i++)
			if (a[i] !== b[i]) return a[i] - b[i];
		return a.length - b.length;
	};
	// Index only actual contiguous prefixes. Hidden intermediate ASNs are never
	// bypassed by a fabricated edge, even when their nearest layer differs.
	const prefixes = new Map<
		number,
		{ asns: number[]; count: number; collectors: number }[]
	>();
	for (const path of graph.paths) {
		if (byASN.get(path.asns[0])?.role !== "origin") continue;
		const seen = new Set<number>();
		for (let i = 0; i < path.asns.length; i++) {
			const asn = path.asns[i];
			if (
				!byASN.has(asn) ||
				seen.has(asn) ||
				(i > 0 &&
					!observed.has(edgeKey({ source: path.asns[i - 1], target: asn })))
			)
				break;
			seen.add(asn);
			const list = prefixes.get(asn) ?? [];
			list.push({
				asns: path.asns.slice(0, i + 1),
				count: path.count,
				collectors: path.collector_count,
			});
			prefixes.set(asn, list);
		}
	}
	const candidates = graph.nodes
		.filter((n) => n.role !== "origin")
		.sort(
			(a, b) =>
				b.sample_count - a.sample_count ||
				b.collector_count - a.collector_count ||
				a.layer - b.layer ||
				a.asn - b.asn,
		);
	const add = (node: BGPGraphNode) => {
		if (kept.has(node.asn)) return;
		const choices = (prefixes.get(node.asn) ?? [])
			.map((p) => ({
				...p,
				missing: p.asns.filter((asn) => !kept.has(asn)),
			}))
			.sort(
				(a, b) =>
					a.missing.length - b.missing.length ||
					b.count - a.count ||
					b.collectors - a.collectors ||
					comparePath(a.asns, b.asns),
			);
		for (const prefix of choices) {
			if (kept.size + prefix.missing.length > maxNodes) continue;
			const next = new Map(occupied);
			for (const asn of prefix.missing) {
				const layer = byASN.get(asn)?.layer ?? 0;
				next.set(layer, (next.get(layer) ?? 0) + 1);
			}
			// Origins are always retained; the per-layer limit applies to branches.
			if (
				prefix.missing.some(
					(asn) => (next.get(byASN.get(asn)?.layer ?? 0) ?? 0) > maxPerLayer,
				)
			)
				continue;
			for (const asn of prefix.missing) kept.add(asn);
			for (const [layer, count] of next) occupied.set(layer, count);
			return;
		}
	};
	const origins = kept.size;
	for (const node of candidates) if (node.sample_count >= 2) add(node);
	// Sparse observations still get a useful connected preview, without claiming
	// that a one-sample branch is a well-established upstream.
	if (kept.size === origins) for (const node of candidates) add(node);
	return {
		...graph,
		nodes: graph.nodes.filter((n) => kept.has(n.asn)),
		edges: graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)),
	};
}
export interface PlacedNode extends BGPGraphNode {
	x: number;
	y: number;
}
export function layoutGraph(
	graph: BGPGraph,
	showRS: boolean,
	vertical: boolean,
) {
	const nodes = graph.nodes.filter((n) => showRS || !n.route_server);
	const present = new Set(nodes.map((n) => n.asn)),
		edges = graph.edges.filter(
			(e) => present.has(e.source) && present.has(e.target),
		);
	const nodeByASN = new Map(nodes.map((n) => [n.asn, n]));
	const levels = [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b);
	const layers = levels.map((layer) =>
		nodes
			.filter((n) => n.layer === layer)
			.sort((a, b) => b.sample_count - a.sample_count || a.asn - b.asn),
	);
	// A right-to-left barycentre pass follows downstream lanes. Terminal nodes
	// sort after connected nodes, then by observed samples for stable placement.
	for (let i = layers.length - 2; i > 0; i--) {
		const normalized = new Map<number, number>();
		for (const list of layers)
			for (const [j, n] of list.entries())
				normalized.set(n.asn, (j + 0.5) / list.length);
		const score = (n: BGPGraphNode) => {
			const links = edges.filter(
				(e) =>
					e.source === n.asn &&
					(nodeByASN.get(e.target)?.layer ?? -1) > n.layer,
			);
			return links.length
				? links.reduce((sum, e) => sum + (normalized.get(e.target) ?? 0.5), 0) /
						links.length
				: 2;
		};
		layers[i].sort(
			(a, b) =>
				score(a) - score(b) || b.sample_count - a.sample_count || a.asn - b.asn,
		);
	}
	const rows = Math.max(1, ...layers.map((l) => l.length)),
		span = (rows - 1) * 82;
	const centers: number[] = [];
	let x = 96;
	layers.forEach((_, i) => {
		if (i) x += layers[i].length === 1 ? 156 : 264;
		centers.push(x);
	});
	const width = (centers[centers.length - 1] ?? 96) + 312,
		height = span + 168;
	const placed: PlacedNode[] = layers.flatMap((list, i) =>
		list.map((n, j) => {
			const y =
				84 +
				(list.length === 1
					? span / 2
					: (j * span) / Math.max(1, list.length - 1));
			return {
				...n,
				x: vertical ? y + (NODE_W - NODE_H) / 2 : centers[i],
				y: vertical ? width - centers[i] : y,
			};
		}),
	);
	return {
		nodes: placed,
		edges,
		levels: levels.map((level, i) => ({
			level,
			position: vertical ? width - centers[i] : centers[i],
		})),
		width: vertical ? height + NODE_W : width,
		height: vertical ? width : height,
	};
}
export function selectedPaths(
	graph: BGPGraph,
	asn: number | null,
	edge: string | null,
) {
	const nodes = new Set<number>(),
		edges = new Set<string>();
	for (const path of graph.paths) {
		const keys = path.asns
			.slice(1)
			.map((target, i) => edgeKey({ source: path.asns[i], target }));
		if (asn !== null && !path.asns.includes(asn)) continue;
		if (edge !== null && !keys.includes(edge)) continue;
		for (const n of path.asns) nodes.add(n);
		for (const key of keys) edges.add(key);
	}
	return { nodes, edges, active: asn !== null || edge !== null };
}
export function sourceColor(asn: number) {
	// Golden-angle hues distinguish neighbouring ASNs and remain stable over time.
	return `hsl(${(asn * 137.508) % 360} 75% var(--bgp-edge-lightness, 60%))`;
}
