import { geoEquirectangular, geoPath } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { geoJsonString } from "@/lib/geo-json-string";
import type { ReturnHop } from "@/lib/network-insight-api";
import { returnMapData, returnMapFrame, returnUnlocatedReason } from "@/lib/return-route-map";
import { cn } from "@/lib/utils";

const world = JSON.parse(geoJsonString) as {
	features: Array<{
		geometry: never;
		type: "Feature";
		properties: Record<string, unknown>;
	}>;
};
export default function ReturnRouteMap({ hops }: { hops: ReturnHop[] }) {
	const canvas = useRef<HTMLDivElement>(null);
	const [{ width, height }, setSize] = useState({ width: 760, height: 380 });
	useEffect(() => {
		const element = canvas.current;
		if (!element) return;
		const update = () => {
			const box = element.getBoundingClientRect();
			if (box.width && box.height)
				setSize({ width: box.width, height: box.height });
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [hops]);
	const data = useMemo(() => returnMapData(hops), [hops]);
	const [selection, setSelection] = useState<string>();
	const selected =
		data.points.find((p) => p.key === selection) || data.points[0];
	const drawing = useMemo(() => {
		const frame = returnMapFrame(data.points);
		const scale = Math.min(
			760,
			(((width - 100) / frame.lonSpan) * 180) / Math.PI,
			(((height - 100) / frame.latSpan) * 180) / Math.PI,
		);
		const projection = geoEquirectangular()
			.rotate([-frame.longitude, 0])
			.center([0, frame.latitude])
			.scale(scale)
			.translate([width / 2, height / 2])
			.clipExtent([
				[0, 0],
				[width, height],
			]);
		const path = geoPath(projection);
		return {
			land: world.features.map((f) => path(f)).filter(Boolean),
			points: data.points.map((p) => ({
				...p,
				xy: projection([p.longitude, p.latitude])!,
			})),
			lines: data.segments.map((s) => ({
				ttl: s.ttl,
				d: path({ type: "LineString", coordinates: [s.from, s.to] }),
			})),
		};
	}, [data, width, height]);
	return (
		<div className="space-y-3" data-return-map>
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
				<span className="inline-flex items-center gap-1.5 font-medium">
					<MapPin className="size-3.5" aria-hidden />
					路由定位
				</span>
				<span className="text-muted-foreground">
					已定位 {data.located} / {data.total} 个跳点记录
				</span>
			</div>
			{!!data.unlocated.length && (
                <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground" data-return-map-missing>
                    {data.unlocated.length} 条记录未绘制：{[...new Set(data.unlocated.map(returnUnlocatedReason))].map(reason => reason + " " + data.unlocated.filter(h => returnUnlocatedReason(h) === reason).length + " 条").join("；")}。不根据地址归属名称猜测坐标。
                </p>
            )}
			{!!data.unlocated.length && (
				<details className="rounded-lg bg-muted/30 px-3 py-2 text-xs">
					<summary className="cursor-pointer">
						为什么有些跳点没显示？（{data.unlocated.length} 条）
					</summary>
					<ul className="mt-2 space-y-1 text-muted-foreground">
						{data.unlocated.map((h, i) => (
							<li key={i}>
								第 {h.ttl} 跳 ·{" "}
								{returnUnlocatedReason(h)}
							</li>
						))}
					</ul>
				</details>
			)}
			{data.points.length ? (
				<>
					<div
						ref={canvas}
						className="relative isolate h-[230px] overflow-hidden rounded-xl border bg-muted/35 sm:h-[320px]"
						data-return-map-canvas
					>
						<svg
							viewBox={`0 0 ${width} ${height}`}
							preserveAspectRatio="xMidYMid meet"
							className="absolute inset-0 h-full w-full"
							role="img"
							aria-label="回程路由地理位置示意图"
						>
							<title>
								回程路由地理位置示意图，连接仅表示相邻 TTL 的观测顺序
							</title>
							<g
								className="fill-muted-foreground/10 stroke-muted-foreground/25"
								strokeWidth=".6"
							>
								{drawing.land.map((d, i) => (
									<path key={i} d={d!} />
								))}
							</g>
							<g
								className="stroke-primary/65"
								fill="none"
								strokeWidth="2"
								strokeLinecap="round"
							>
								{drawing.lines.map((line) => (
									<path key={line.ttl} d={line.d || ""} data-return-map-edge />
								))}
							</g>
						</svg>
						{drawing.points.map((p) => (
							<button
								key={p.key}
								type="button"
								data-return-map-point
								className={cn(
									"absolute z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-primary",
									selected?.key === p.key && "z-20",
								)}
								style={{
									left: `${(p.xy[0] / width) * 100}%`,
									top: `${(p.xy[1] / height) * 100}%`,
								}}
								aria-pressed={selected?.key === p.key}
								aria-label={`查看第 ${p.hops.map((h) => h.ttl).join("、")} 跳定位`}
								onClick={() => setSelection(p.key)}
							>
								<span
									className={cn(
										"flex h-6 min-w-6 items-center justify-center rounded-full border px-1 text-[10px] font-semibold shadow-sm",
										selected?.key === p.key
											? "border-primary bg-primary text-primary-foreground"
											: "border-primary/50 bg-card text-foreground",
									)}
								>
									{p.hops[0].ttl}
									{p.hops.length > 1 ? "+" : ""}
								</span>
							</button>
						))}
					</div>
					<div
						className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]"
						aria-label="选择路由定位"
					>
						{data.points.map((p) => (
							<button
								key={p.key}
								type="button"
								aria-pressed={selected?.key === p.key}
								className={cn(
									"min-h-11 shrink-0 rounded-lg border px-3 text-xs",
									selected?.key === p.key
										? "border-primary/40 bg-primary/10"
										: "bg-background/40",
								)}
								onClick={() => setSelection(p.key)}
							>
								第 {p.hops.map((h) => h.ttl).join("、")} 跳
							</button>
						))}
					</div>
					{selected && (
						<div
							className="space-y-2 rounded-xl border bg-background/40 p-3 text-xs"
							data-return-map-selection
						>
							{selected.hops.map((h, i) => (
								<div key={h.ttl + ":" + i} className="space-y-1 break-words">
									<p className="flex flex-wrap items-center justify-between gap-2 font-medium">
										<span>
											第 {h.ttl} 跳 · {h.asn ? "AS" + h.asn : "未识别 ASN"}
										</span>
										<span className="tabular-nums">
											{h.rtt_ms !== undefined && Number.isFinite(h.rtt_ms)
												? h.rtt_ms.toFixed(1) + " ms"
												: "—"}
										</span>
									</p>
									<p className="text-muted-foreground">
										{h.location || "定位名称未提供"}
										{h.organization ? " · " + h.organization : ""}
									</p>
									{h.ip && (
										<p className="break-all font-mono text-muted-foreground">
											{h.ip}
										</p>
									)}
								</div>
							))}
						</div>
					)}
				</>
			) : (
				<div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 p-5 text-center">
					<MapPin className="size-6 text-muted-foreground" aria-hidden />
					<p className="text-sm font-medium">暂无可用定位数据</p>
					<p className="text-xs leading-5 text-muted-foreground">
						旧快照未保存坐标，可重新检测。未响应、地址隐藏或定位缺失的跳点不绘制。
					</p>
				</div>
			)}
			<p className="text-[11px] leading-5 text-muted-foreground">
				IP 定位仅供参考，不代表真实机房或光缆路径。连线仅表示相邻 TTL
				的观测顺序；缺失定位、未响应和多路径之间不推测连线。同位置的跳点合并显示。
			</p>

		</div>
	);
}