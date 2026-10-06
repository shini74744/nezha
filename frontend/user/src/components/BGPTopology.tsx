import * as Dialog from "@radix-ui/react-dialog";
import {
	ArrowRight,
	ArrowUp,
	ChevronDown,
	Crosshair,
	Maximize2,
	Minus,
	Plus,
	Scan,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	coreGraph,
	edgeKey,
	graphFor,
	layoutGraph,
	NODE_H,
	NODE_W,
	roleLabel,
	selectedPaths,
	sourceColor,
} from "@/lib/bgp-graph";
import type {
	BGPGraphEdge,
	BGPTopology as Topology,
} from "@/lib/network-insight-api";
import "./bgp-observation.css";

type View = { x: number; y: number; scale: number };
const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));
function BGPTopology({ topology }: { topology: Topology }) {
	const graph = useMemo(() => graphFor(topology), [topology]);
	// Snapshot identity resets the view; background polling of the same snapshot does not.
	const identity = [
		topology.family,
		topology.prefix,
		topology.observed_at,
	].join("|");
	return <Observation key={identity} topology={topology} graph={graph} />;
}
function Observation({
	topology,
	graph,
}: {
	topology: Topology;
	graph: ReturnType<typeof graphFor>;
}) {
	const [full, setFull] = useState(false);
	const [enhanced, setEnhanced] = useState(false),
		[vertical, setVertical] = useState(false);
	const [showRS, setShowRS] = useState(false),
		[colored, setColored] = useState(true);
	const [supplemental, setSupplemental] = useState(false),
		[fullscreen, setFullscreen] = useState(false);
	const [selected, setSelected] = useState<number | null>(null),
		[selectedEdge, setSelectedEdge] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false),
		[legend, setLegend] = useState(false);
	const [sort, setSort] = useState<"layer" | "samples" | "collectors">(
		"samples",
	);
	const [view, setView] = useState<View>({ x: 0, y: 0, scale: 0.45 });
	const [size, setSize] = useState({ width: 0, height: 720 });
	const viewport = useRef<HTMLDivElement>(null),
		fullscreenButton = useRef<HTMLButtonElement>(null);
	const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(
		null,
	);
	const attachViewport = useCallback((el: HTMLDivElement | null) => {
		viewport.current = el;
		setViewportElement(el);
	}, []);
	const pointers = useRef(new Map<number, { x: number; y: number }>()),
		dragged = useRef(false);
	const core = useMemo(() => coreGraph(graph), [graph]);
	const layout = useMemo(
		() => layoutGraph(full ? graph : core, showRS, vertical),
		[graph, core, full, showRS, vertical],
	);
	const availableNodes = graph.nodes.filter(
		(n) => showRS || !n.route_server,
	).length;
	const foldedNodes = availableNodes - layout.nodes.length;
	const byASN = useMemo(
		() => new Map(layout.nodes.map((n) => [n.asn, n])),
		[layout],
	);
	const related = useMemo(
		() => selectedPaths(graph, selected, selectedEdge),
		[graph, selected, selectedEdge],
	);
	const selectedNode = selected === null ? undefined : byASN.get(selected);
	const edgeSelection = layout.edges.find((e) => edgeKey(e) === selectedEdge);
	const fitView = useCallback(
		(initial = false) => {
			const el = viewport.current;
			if (!el || !layout.nodes.length) return;
			const minX = Math.min(...layout.nodes.map((n) => n.x - NODE_W / 2)),
				maxX = Math.max(...layout.nodes.map((n) => n.x + NODE_W / 2));
			const minY = Math.min(...layout.nodes.map((n) => n.y - NODE_H / 2)),
				maxY = Math.max(...layout.nodes.map((n) => n.y + NODE_H / 2));
			const focusOrigin = initial && full;
			const scale = clamp(
				Math.min(
					focusOrigin
						? (el.clientWidth - 40) / layout.width
						: (el.clientWidth - 40) / (maxX - minX + 40),
					(el.clientHeight - 70) / (maxY - minY),
				),
				focusOrigin ? 0.45 : 0.02,
				1,
			);
			setView({
				scale,
				x:
					focusOrigin && !vertical
						? Math.max(
								72,
								(el.clientWidth - layout.width * scale) / 2 + 160 * scale,
							)
						: (el.clientWidth - (minX + maxX) * scale) / 2,
				y: (el.clientHeight - (minY + maxY) * scale) / 2,
			});
		},
		[layout, vertical, full],
	);
	// Geometry changes (not array identity during polling) warrant a new fit.
	const geometry = layout.nodes.map((n) => `${n.asn}:${n.x}:${n.y}`).join("|");
	const fitRef = useRef(fitView);
	fitRef.current = fitView;
	// biome-ignore lint/correctness/useExhaustiveDependencies: Geometry identity, not polling object identity, controls viewport fitting.
	useEffect(() => {
		const el = viewportElement;
		if (!el) return;
		let width = el.clientWidth,
			height = el.clientHeight;
		setSize({ width, height });
		fitRef.current(true);
		const observer = new ResizeObserver(() => {
			// The first notification can arrive after a wheel/drag or portal remount.
			// Refit only on a real size change, never discard the user's current view.
			if (width === el.clientWidth && height === el.clientHeight) return;
			width = el.clientWidth;
			height = el.clientHeight;
			setSize({ width, height });
			fitRef.current(true);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [viewportElement, geometry]);
	useEffect(() => {
		if (selected !== null && !byASN.has(selected)) setSelected(null);
	}, [selected, byASN]);
	useEffect(() => {
		if (
			selectedEdge !== null &&
			!layout.edges.some((e) => edgeKey(e) === selectedEdge)
		)
			setSelectedEdge(null);
	}, [selectedEdge, layout.edges]);
	const zoom = useCallback(
		(factor: number, x = size.width / 2, y = size.height / 2) =>
			setView((v) => {
				const scale = clamp(v.scale * factor, 0.02, 2.5),
					ratio = scale / v.scale;
				return { scale, x: x - (x - v.x) * ratio, y: y - (y - v.y) * ratio };
			}),
		[size.width, size.height],
	);
	useEffect(() => {
		if (!viewportElement) return;
		const onWheel = (event: WheelEvent) => {
			if (
				!event.cancelable ||
				!Number.isFinite(event.deltaY) ||
				event.deltaY === 0
			)
				return;
			const rect = viewportElement.getBoundingClientRect();
			// Browsers may latch a wheel gesture to its first element after the pointer leaves.
			if (
				event.clientX < rect.left ||
				event.clientX >= rect.right ||
				event.clientY < rect.top ||
				event.clientY >= rect.bottom
			)
				return;
			// A non-passive native listener cancels page scrolling only inside the canvas.
			// Bind to the actual element so fullscreen portal remounts work as well.
			event.preventDefault();
			const unit =
				event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
			const delta = clamp(event.deltaY * unit, -120, 120);
			zoom(
				Math.exp(-delta * 0.002),
				event.clientX - rect.left - viewportElement.clientLeft,
				event.clientY - rect.top - viewportElement.clientTop,
			);
		};
		viewportElement.addEventListener("wheel", onWheel, { passive: false });
		return () => viewportElement.removeEventListener("wheel", onWheel);
	}, [viewportElement, zoom]);
	const clear = () => {
		setSelected(null);
		setSelectedEdge(null);
	};
	const rows = useMemo(
		() =>
			[...layout.edges].sort((a, b) => {
				if (sort === "layer")
					return (
						(byASN.get(a.source)?.layer ?? 0) -
							(byASN.get(b.source)?.layer ?? 0) ||
						b.sample_count - a.sample_count ||
						a.source - b.source ||
						a.target - b.target
					);
				return (
					(sort === "samples"
						? b.sample_count - a.sample_count
						: b.collector_count - a.collector_count) ||
					a.source - b.source ||
					a.target - b.target
				);
			}),
		[layout.edges, sort, byASN],
	);
	const extra =
		enhanced && supplemental
			? graph.supplemental_edges.filter(
					(e) => byASN.has(e.source) && byASN.has(e.target),
				)
			: [];
	const allEdges = [...extra, ...layout.edges];
	const drawEdge = (edge: BGPGraphEdge, index: number) => {
		const a = byASN.get(edge.source),
			b = byASN.get(edge.target);
		if (!a || !b) return null;
		const inferred = edge.kind === "supplemental";
		const peerHint =
			enhanced &&
			a.layer === b.layer &&
			(a.tier1 || a.near_tier1) &&
			(b.tier1 || b.near_tier1);
		const color = inferred
			? "#9d82d5"
			: peerHint
				? "#ed9b45"
				: colored
					? a.role === "origin"
						? "var(--bgp-origin-edge)"
						: sourceColor(a.asn)
					: "#8594ae";
		const dim =
			related.active && (inferred || !related.edges.has(edgeKey(edge)));
		const lane = ((index % 7) - 3) * 5;
		let path: string, arrow: string;
		if (!vertical) {
			const forward = b.x > a.x,
				ax = a.x + ((forward || a.layer === b.layer ? 1 : -1) * NODE_W) / 2,
				bx = b.x + ((forward ? -1 : 1) * NODE_W) / 2;
			const bend =
				a.layer === b.layer
					? Math.max(ax, bx) + 30 + Math.abs(lane)
					: (ax + bx) / 2 + lane;
			path = `M ${ax} ${a.y} H ${bend} V ${b.y} H ${bx}`;
			arrow = `${bx},${b.y} ${bx + (forward ? -11 : 11)},${b.y - 5} ${bx + (forward ? -11 : 11)},${b.y + 5}`;
		} else {
			const forward = b.y < a.y,
				ay = a.y + ((forward ? -1 : 1) * NODE_H) / 2,
				by = b.y + ((forward ? 1 : -1) * NODE_H) / 2;
			const bend =
				a.layer === b.layer
					? Math.max(ay, by) + 30 + Math.abs(lane)
					: (ay + by) / 2 + lane;
			path = `M ${a.x} ${ay} V ${bend} H ${b.x} V ${by}`;
			arrow = `${b.x},${by} ${b.x - 5},${by + (forward ? 11 : -11)} ${b.x + 5},${by + (forward ? 11 : -11)}`;
		}
		return (
			<g
				key={edge.kind + edgeKey(edge)}
				opacity={
					dim
						? 0.12
						: inferred
							? 0.55
							: graph.legacy
								? 0.85
								: 0.35 +
									0.55 *
										Math.sqrt(
											edge.collector_count / Math.max(1, graph.collector_count),
										)
				}
			>
				<path
					d={path}
					fill="none"
					stroke={color}
					strokeWidth={
						inferred
							? 1.6
							: clamp(
									Math.sqrt(
										edge.sample_count / Math.max(1, graph.observed_path_count),
									) * 5,
									1.3,
									5,
								)
					}
					strokeDasharray={inferred || peerHint ? "7 5" : undefined}
				/>
				<polygon points={arrow} fill={color} />
			</g>
		);
	};
	const controls = (
		<div className="bgp-toolbar" role="toolbar" aria-label="BGP 图表工具">
			<div className="bgp-segments">
				<button
					type="button"
					aria-pressed={!full}
					onClick={() => {
						setFull(false);
						setExpanded(false);
					}}
				>
					主干图
				</button>
				<button
					type="button"
					aria-pressed={full}
					onClick={() => {
						setFull(true);
						setExpanded(false);
					}}
				>
					完整图
				</button>
			</div>
			<div className="bgp-segments">
				<button
					type="button"
					aria-pressed={!enhanced}
					onClick={() => setEnhanced(false)}
				>
					严格观测
				</button>
				<button
					type="button"
					aria-pressed={enhanced}
					onClick={() => setEnhanced(true)}
				>
					增强解释
				</button>
			</div>
			<div className="bgp-segments">
				<button
					type="button"
					aria-label="横向布局"
					aria-pressed={!vertical}
					onClick={() => setVertical(false)}
				>
					<ArrowRight />
				</button>
				<button
					type="button"
					aria-label="纵向布局"
					aria-pressed={vertical}
					onClick={() => setVertical(true)}
				>
					<ArrowUp />
				</button>
			</div>
			<button
				type="button"
				className="bgp-pill"
				aria-pressed={showRS}
				onClick={() => setShowRS((v) => !v)}
				title={
					graph.annotation_status !== "available"
						? "路由服务器注释暂不可用，不会猜测节点身份"
						: "显示已识别的路由服务器"
				}
			>
				路由服务器
			</button>
			<button
				type="button"
				className="bgp-pill"
				aria-pressed={colored}
				onClick={() => setColored((v) => !v)}
			>
				按源着色
			</button>
			<button
				type="button"
				className="bgp-pill"
				aria-pressed={enhanced && supplemental}
				disabled={
					!enhanced ||
					graph.legacy ||
					graph.supplemental_status === "unavailable"
				}
				onClick={() => setSupplemental((v) => !v)}
				title="增强解释模式：显示 RIPEstat ASN 级邻接补充，不属于此前缀的观测路径"
			>
				补充连线
			</button>
			<div className="bgp-view-controls">
				<div className="bgp-zoom">
					<button
						type="button"
						aria-label="缩小"
						disabled={view.scale <= 0.02}
						onClick={() => zoom(1 / 1.2)}
					>
						<Minus />
					</button>
					<output aria-label="缩放比例">{Math.round(view.scale * 100)}%</output>
					<button
						type="button"
						aria-label="放大"
						disabled={view.scale >= 2.5}
						onClick={() => zoom(1.2)}
					>
						<Plus />
					</button>
				</div>
				<button
					type="button"
					className="bgp-round"
					aria-label="适应画布"
					onClick={() => fitView()}
				>
					<Scan />
				</button>
				<button
					ref={!fullscreen ? fullscreenButton : undefined}
					type="button"
					className="bgp-round"
					aria-label={fullscreen ? "退出全屏" : "全屏显示"}
					onClick={() => setFullscreen((v) => !v)}
				>
					{fullscreen ? <X /> : <Maximize2 />}
				</button>
			</div>
		</div>
	);
	const chart = (
		<div
			ref={attachViewport}
			className="bgp-viewport"
			data-bgp-graph
			role="application"
			aria-label="BGP 观测拓扑，滚轮缩放，拖动平移，加减键缩放，Home 键适应画布"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard pan/zoom control for the graph viewport.
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "+" || e.key === "=") {
					e.preventDefault();
					zoom(1.2);
				} else if (e.key === "-") {
					e.preventDefault();
					zoom(1 / 1.2);
				} else if (e.key === "Home") {
					e.preventDefault();
					fitView();
				} else if (e.key === "Escape") clear();
				else if (
					["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
				) {
					e.preventDefault();
					setView((v) => ({
						...v,
						x:
							v.x +
							(e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0),
						y:
							v.y +
							(e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0),
					}));
				}
			}}
			onPointerDown={(e) => {
				if (
					e.button !== 0 ||
					(e.target as HTMLElement).closest("button, .bgp-node-info")
				)
					return;
				e.currentTarget.setPointerCapture(e.pointerId);
				if (!pointers.current.size) dragged.current = false;
				pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
			}}
			onPointerMove={(e) => {
				const prev = pointers.current.get(e.pointerId);
				if (!prev) return;
				const others = [...pointers.current.entries()].filter(
					([id]) => id !== e.pointerId,
				);
				if (others.length) {
					const other = others[0][1],
						before = Math.hypot(prev.x - other.x, prev.y - other.y),
						after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
					const rect = e.currentTarget.getBoundingClientRect();
					if (before > 8)
						zoom(
							after / before,
							(e.clientX + other.x) / 2 - rect.left,
							(e.clientY + other.y) / 2 - rect.top,
						);
				} else
					setView((v) => ({
						...v,
						x: v.x + e.clientX - prev.x,
						y: v.y + e.clientY - prev.y,
					}));
				if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 1)
					dragged.current = true;
				pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
			}}
			onPointerUp={(e) => {
				if (!pointers.current.has(e.pointerId)) return;
				pointers.current.delete(e.pointerId);
				if (!dragged.current) clear();
			}}
			onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
			onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
		>
			<div
				className="bgp-world"
				style={{
					width: layout.width,
					height: layout.height,
					transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
				}}
			>
				<svg
					width={layout.width}
					height={layout.height}
					aria-hidden="true"
					className="bgp-edges"
				>
					{allEdges.map(drawEdge)}
				</svg>
				{layout.nodes.map((n) => (
					<button
						type="button"
						key={n.asn}
						data-bgp-asn={n.asn}
						className={`bgp-node bgp-node-${n.route_server ? "rs" : n.role}${related.active && !related.nodes.has(n.asn) ? " bgp-dimmed" : ""}${selected === n.asn ? " bgp-selected" : ""}`}
						style={{
							left: n.x - NODE_W / 2,
							top: n.y - NODE_H / 2,
							width: NODE_W,
							height: NODE_H,
						}}
						title={`AS${n.asn} · ${n.name} · ${n.sample_count} 个样本`}
						aria-label={`AS${n.asn}，${n.name}，${roleLabel(n)}`}
						aria-pressed={selected === n.asn}
						onClick={() => {
							setSelected((v) => (v === n.asn ? null : n.asn));
							setSelectedEdge(null);
						}}
						onFocus={() => {
							// Keep keyboard-focused nodes visible even when the chart is zoomed or panned.
							const x = n.x * view.scale + view.x,
								y = n.y * view.scale + view.y;
							if (
								x < 30 ||
								x > size.width - 30 ||
								y < 30 ||
								y > size.height - 30
							)
								setView((v) => ({
									...v,
									x: size.width / 2 - n.x * v.scale,
									y: size.height / 2 - n.y * v.scale,
								}));
						}}
					>
						<strong>AS{n.asn}</strong>
						<span className="bgp-node-name">{n.name || `AS${n.asn}`}</span>
						{(n.tier1 || n.near_tier1) && (
							<span className="bgp-tier" title="骨干注释，不代表商业关系已证实">
								{n.tier1 ? "T1" : "≈T1"}
							</span>
						)}
					</button>
				))}
			</div>
			{layout.levels.map((l) => (
				<span
					className={`bgp-layer ${vertical ? "bgp-layer-vertical" : ""}`}
					key={l.level}
					style={
						vertical
							? { top: view.y + l.position * view.scale }
							: { left: view.x + l.position * view.scale }
					}
				>
					{l.level === 0 ? "起源" : `L${l.level}`}
				</span>
			))}
			{selectedNode && (
				<aside className="bgp-node-info" aria-label="节点信息">
					<div className="bgp-info-actions">
						<button
							type="button"
							aria-label="居中选中节点"
							onClick={() =>
								setView((v) => ({
									...v,
									x: size.width / 2 - selectedNode.x * v.scale,
									y: size.height / 2 - selectedNode.y * v.scale,
								}))
							}
						>
							<Crosshair />
						</button>
						<button type="button" aria-label="清除选择" onClick={clear}>
							<X />
						</button>
					</div>
					<strong>AS{selectedNode.asn}</strong>
					<p>{selectedNode.name}</p>
					<dl>
						<div>
							<dt>角色</dt>
							<dd>{roleLabel(selectedNode)}</dd>
						</div>
						<div>
							<dt>层级</dt>
							<dd>第 {selectedNode.layer} 层</dd>
						</div>
						<div>
							<dt>样本数</dt>
							<dd>{selectedNode.sample_count}</dd>
						</div>
						<div>
							<dt>采集源</dt>
							<dd>{graph.legacy ? "未保存" : selectedNode.collector_count}</dd>
						</div>
					</dl>
				</aside>
			)}
			{edgeSelection && (
				<aside className="bgp-node-info bgp-edge-info" aria-label="分支信息">
					<button
						type="button"
						className="bgp-info-close"
						aria-label="清除选择"
						onClick={clear}
					>
						<X />
					</button>
					<strong>
						AS{edgeSelection.source} → AS{edgeSelection.target}
					</strong>
					<p>高亮包含此分支的观测路径</p>
					<p>
						{edgeSelection.sample_count} 个样本 /{" "}
						{graph.legacy
							? "采集源未保存"
							: `${edgeSelection.collector_count} 个采集源`}
					</p>
				</aside>
			)}
		</div>
	);
	if (topology.status !== "ok")
		return (
			<div
				role="status"
				className="py-12 text-center text-sm text-muted-foreground"
			>
				{(
					{
						no_public_ip: "未获取到此协议的公网 IP",
						no_routes: "数据源暂未观测到该地址的 BGP 路由",
						unavailable: "BGP 数据源暂时不可用，请稍后重试",
					} as Record<string, string>
				)[topology.status] || "暂无路由数据"}
			</div>
		);
	const content = (
		<div className={`bgp-observation${fullscreen ? " bgp-fullscreen" : ""}`}>
			<header className="bgp-heading">
				<h3>
					<span>BGP</span> 观测图
				</h3>
				<span aria-live="polite">
					{selected !== null
						? `已高亮 AS${selected} 的观测路径`
						: selectedEdge
							? "已高亮选中分支的观测路径"
							: "点 ASN 节点可高亮相关路径"}
				</span>
			</header>
			{controls}
			<div className="bgp-scope" aria-live="polite">
				<span>
					{full ? "完整图" : "主干图"} · 显示 {layout.nodes.length} /{" "}
					{availableNodes} 个 AS
				</span>
				{foldedNodes > 0 && (
					<span>已折叠 {foldedNodes} 个 AS，切换完整图查看</span>
				)}
			</div>
			{chart}
			{!layout.nodes.length && (
				<p role="status" className="bgp-notice">
					本次快照没有可展示的观测路径。
				</p>
			)}
			{graph.legacy && (
				<p className="bgp-notice">
					旧快照仅保存前三层摘要；重新检测后可查看完整多层路径和采集源。
				</p>
			)}
			{graph.truncated && (
				<p className="bgp-notice">
					快照收录 {graph.included_path_count} / {graph.observed_path_count}{" "}
					条观测样本；超出安全上限的完整路径未收录。
				</p>
			)}
			<section className="bgp-summary" aria-label="观测分支摘要">
				<header>
					<div>
						<h4>观测分支摘要</h4>
						<p>
							仅列当前视图的分支，统计仍基于原始快照；每行是直接观测到的 AS
							相邻关系。
						</p>
					</div>
					<div className="bgp-sort" role="toolbar" aria-label="分支排序">
						{(
							[
								["layer", "层级"],
								["samples", "样本"],
								["collectors", "采集源"],
							] as const
						).map(([value, name]) => (
							<button
								key={value}
								type="button"
								aria-pressed={sort === value}
								onClick={() => setSort(value)}
							>
								{name}
								{sort === value ? (value === "layer" ? " ↑" : " ↓") : ""}
							</button>
						))}
					</div>
				</header>
				<div className="bgp-branch-list">
					{(expanded ? rows : rows.slice(0, 6)).map((e) => (
						<button
							type="button"
							className="bgp-branch"
							key={edgeKey(e)}
							aria-pressed={selectedEdge === edgeKey(e)}
							onClick={() => {
								setSelected(null);
								setSelectedEdge((v) => (v === edgeKey(e) ? null : edgeKey(e)));
							}}
						>
							<span className="bgp-branch-level">
								{byASN.get(e.source)?.layer === 0
									? "起源"
									: `L${byASN.get(e.source)?.layer}`}
							</span>
							<span className="bgp-branch-text">
								<strong>
									AS{e.source} → AS{e.target}
								</strong>
								<span>{byASN.get(e.target)?.name}</span>
							</span>
							<span className="bgp-branch-bar" aria-hidden="true">
								<i
									style={{
										width: `${Math.max(8, (Math.log1p(e.sample_count) / Math.log1p(Math.max(1, graph.observed_path_count))) * 100)}%`,
									}}
								/>
							</span>
							<span className="bgp-branch-count">
								{e.sample_count} / {graph.legacy ? "—" : e.collector_count}
							</span>
						</button>
					))}
				</div>
				{rows.length > 6 && (
					<button
						type="button"
						className="bgp-expand"
						aria-expanded={expanded}
						onClick={() => setExpanded((v) => !v)}
					>
						{expanded ? "收起分支" : `展开全部 ${rows.length} 段分支`}
					</button>
				)}
				<p className="bgp-footnote">
					右侧数字为该段的样本数 / 采集源数。补充连线属于推断关系，不计入本表。
				</p>
			</section>
			<section className="bgp-legend">
				<button
					type="button"
					className="bgp-legend-toggle"
					aria-expanded={legend}
					onClick={() => setLegend((v) => !v)}
				>
					<strong>图例与使用说明</strong>
					<span>
						补充连线 {enhanced && supplemental ? "已启用" : "未启用"}
						<ChevronDown
							style={{ transform: legend ? "rotate(180deg)" : undefined }}
						/>
					</span>
				</button>
				<p>
					实线表示已观测到的 AS 路径，颜色区分来源 ASN。BGP 路由观测不代表实际流量路径、网络质量或延迟。
				</p>
				{legend && (
					<div className="bgp-legend-grid">
						<div>
							<h4>视图与节点</h4>
							<p>
								主干图精选主要分支，保留起源节点及连接路径；完整图展示本次记录收录的全部节点。
							</p>
							<p>
								切换视图不会改变原始记录或样本统计。路由服务器可通过独立开关显示或隐藏。
							</p>
							<p>蓝色：目标网络的起源 AS</p>
							<p>绿色：与起源 AS 直接相邻的观测节点</p>
							<p>灰色：路径上的其他网络</p>
							<p>紫色：已识别的路由服务器</p>
							<p>
								线条越粗，观测样本越多；颜色越深，采集来源越广。路径方向不代表商业上下游关系。
							</p>
							<p>点击节点可高亮相关路径，再次点击取消。</p>
							<p>
								支持滚轮或双指缩放、拖动画布；也可用 Tab 切换节点、Enter 或空格选中，方向键移动、加减键缩放。
							</p>
						</div>
						<div>
							<h4>标记与数据来源</h4>
							<p>T1 / ≈T1 为骨干网络参考标记，不代表已确认的商业关系。</p>
							<p>
								橙色折线提示同层骨干网络之间可能的互联，仅供参考。
							</p>
							<p>
								灰紫虚线为 RIPEstat 提供的 AS 邻接关系，不属于本次目标网段的观测路径，也不计入路径统计。
							</p>
							<p>
								路由数据：{topology.source}。路由服务器信息：PeeringDB
								{graph.annotation_status === "available" ? "" : "（暂不可用）"}
								。
							</p>
							<p>
								补充数据：
								{graph.supplemental_status === "available"
									? "已获取"
									: graph.supplemental_status === "partial"
										? "部分可用"
										: "暂不可用"}
								。补充连线仅展示部分已知关系，不代表完整的互联网拓扑。
							</p>
						</div>
					</div>
				)}
			</section>
		</div>
	);
	return (
		<>
			{!fullscreen && content}
			<Dialog.Root open={fullscreen} onOpenChange={setFullscreen}>
				<Dialog.Portal>
					<Dialog.Overlay className="bgp-dialog-overlay" />
					<Dialog.Content
						className="bgp-dialog"
						aria-describedby={undefined}
						onCloseAutoFocus={(e) => {
							e.preventDefault();
							fullscreenButton.current?.focus();
						}}
					>
						<Dialog.Title className="sr-only">BGP 观测图全屏</Dialog.Title>
						{fullscreen && content}
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
export default memo(BGPTopology);
