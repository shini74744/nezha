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
