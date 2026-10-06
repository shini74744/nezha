import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	ASNode,
	BGPTopology as Topology,
} from "@/lib/network-insight-api";
import { cn } from "@/lib/utils";

export default function BGPTopology({ topology }: { topology: Topology }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [expanded, setExpanded] = useState(false);
	const graph = useMemo(() => {
		const columns = [
			new Map<number, { node: ASNode; count: number }>(),
			new Map<number, { node: ASNode; count: number }>(),
			new Map<number, { node: ASNode; count: number }>(),
		];
		for (const p of topology.paths)
			for (const [i, n] of [p.origin, p.direct, p.second].entries())
				if (n) {
					const old = columns[i].get(n.asn);
					columns[i].set(n.asn, {
						node: n,
						count: (old?.count || 0) + p.count,
					});
				}
		const allLists = columns.map((c) =>
			[...c.values()].sort(
				(a, b) => b.count - a.count || a.node.asn - b.node.asn,
			),
		);
		const direct = expanded ? allLists[1] : allLists[1].slice(0, 6);
		const directASNs = new Set(direct.map((v) => v.node.asn));
		const secondASNs = new Set(
			topology.paths
				.filter((p) => p.direct && directASNs.has(p.direct.asn) && p.second)
				.map((p) => p.second?.asn),
		);
		const second = allLists[2].filter((v) => secondASNs.has(v.node.asn));
		const lists = [allLists[0], direct, expanded ? second : second.slice(0, 8)];
		const totalNodes = allLists.reduce((sum, nodes) => sum + nodes.length, 0);
		const canExpand = allLists[1].length > 6 || allLists[2].length > 8;
		const height = Math.max(420, ...lists.map((l) => l.length * 78 + 65)),
			positions = new Map<string, { x: number; y: number }>();
		lists.forEach((list, col) => {
			list.forEach((item, index) => {
				positions.set(`${col}:${item.node.asn}`, {
					x: 20 + col * 330,
					y:
						60 +
						((height - 100) / Math.max(list.length, 1)) * (index + 0.5) -
						27,
				});
			});
		});
		const edges = new Map<
			string,
			{ from: string; to: string; count: number }
		>();
		for (const p of topology.paths)
			for (const [col, left, right] of [
				[0, p.origin, p.direct],
				[1, p.direct, p.second],
			] as const) {
				if (!left || !right) continue;
				const from = `${col}:${left.asn}`,
					to = `${col + 1}:${right.asn}`,
					key = `${from}>${to}`,
					old = edges.get(key);
				edges.set(key, { from, to, count: (old?.count || 0) + p.count });
			}
		return {
			lists,
			height,
			positions,
			edges: [...edges.values()],
			canExpand,
			totalNodes,
		};
	}, [topology, expanded]);
	useEffect(() => {
		const el = canvas.current,
			ctx = el?.getContext("2d");
		if (!el || !ctx) return;
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		el.width = 980 * ratio;
		el.height = graph.height * ratio;
		ctx.scale(ratio, ratio);
		ctx.clearRect(0, 0, 980, graph.height);
		ctx.strokeStyle = "rgba(120,140,160,0.55)";
		for (const edge of graph.edges) {
			const a = graph.positions.get(edge.from),
				b = graph.positions.get(edge.to);
			if (!a || !b) continue;
			ctx.lineWidth = Math.max(
				1,
				Math.sqrt(edge.count / Math.max(topology.total, 1)) * 13,
			);
			ctx.beginPath();
			ctx.moveTo(a.x + 240, a.y + 27);
			ctx.bezierCurveTo(a.x + 292, a.y + 27, b.x - 52, b.y + 27, b.x, b.y + 27);
			ctx.stroke();
		}
	}, [graph, topology.total]);
	if (topology.status !== "ok")
		return (
			<div
				className="py-12 text-center text-sm text-muted-foreground"
				role="status"
			>
				{(
					{
						no_public_ip: "节点未上报此协议的公网 IP",
						no_routes: "数据源暂未观测到该地址的 BGP 路由",
						unavailable: "BGP 数据源暂时不可用，请稍后重试",
					} as Record<string, string>
				)[topology.status] || "暂无路由数据"}
			</div>
		);
	const displayed = topology.paths.reduce((sum, p) => sum + p.count, 0);
	return (
		<div>
			<p className="text-xs text-muted-foreground sm:hidden mb-2">
				左右滑动查看完整拓扑
			</p>
			{graph.canExpand && (
				<div className="flex flex-wrap items-center justify-between gap-2 mb-3">
					<p className="text-xs text-muted-foreground">
						{expanded
							? "显示本次汇总的全部 AS"
							: "默认显示主要 AS，避免拓扑过长"}
					</p>
					<Button
						type="button"
						size="sm"
						variant="outline"
						aria-expanded={expanded}
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? "收起为主要 AS" : `展开全部 AS（${graph.totalNodes}）`}
					</Button>
				</div>
			)}
			<section
				className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Allow keyboard panning of the scrollable topology.
				tabIndex={0}
				aria-label="BGP 路由拓扑，可横向滚动"
				data-bgp-graph
			>
				<div className="relative" style={{ width: 980, height: graph.height }}>
					<canvas
						ref={canvas}
						className="absolute inset-0 pointer-events-none"
						style={{ width: 980, height: graph.height }}
						aria-hidden
					/>
					{[
						"源 AS",
						"直接上游 · 所示路径占比",
						"二级上游 · 蓝框为骨干参考",
					].map((label, col) => (
						<h3
							key={label}
							className="absolute top-2 text-xs font-semibold text-muted-foreground"
							style={{ left: 20 + col * 330 }}
						>
							{label}
						</h3>
					))}
					{graph.lists.flatMap((list, col) =>
						list.map(({ node, count }) => {
							const position = graph.positions.get(`${col}:${node.asn}`);
							if (!position) return null;
							return (
								<a
									key={`${col}:${node.asn}`}
									href={`https://stat.ripe.net/AS${node.asn}`}
									target="_blank"
									rel="noopener noreferrer"
									className={cn(
										"absolute flex flex-col justify-center rounded-xl border px-3 py-2 h-[56px] w-[240px] bg-card text-xs shadow-sm focus-visible:outline focus-visible:outline-2",
										col === 0
											? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
											: node.tier1
												? "border-blue-500 bg-blue-50 dark:bg-blue-950"
												: "border-border",
									)}
									style={{ left: position.x, top: position.y }}
									title={`${node.name} · ${count} 条观测路径`}
								>
									<span className="flex justify-between gap-2 font-semibold">
										<span>AS{node.asn}</span>
										{col === 1 && (
											<span className="text-muted-foreground">
												{((count / Math.max(topology.total, 1)) * 100).toFixed(
													1,
												)}
												%
											</span>
										)}
									</span>
									<span className="truncate mt-0.5">{node.name}</span>
								</a>
							);
						}),
					)}
				</div>
			</section>
			<p className="text-[11px] leading-relaxed text-muted-foreground mt-3">
				来源：{topology.source}
				。按采集器观测路径计数，不代表带宽或商业上下游关系；蓝框仅作常见骨干 AS
				参考。
				{displayed < topology.total &&
					`汇总 ${displayed} / ${topology.total} 条路径；占比为所示观测数占全部观测数，不包含未展示路径。`}
			</p>
		</div>
	);
}
