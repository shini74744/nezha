import { geoEquirectangular, geoPath } from "d3-geo";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { geoJsonString } from "@/lib/geo-json-string";
import { countryCoordinates } from "@/lib/geo-limit";
import { formatNezhaInfo } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";
import { art } from "./assets";
import { DoraNetwork } from "./Network";
import { useDoraMotion } from "./use-motion";

const world = JSON.parse(geoJsonString) as {
	features: Array<{
		type: "Feature";
		properties: { iso_a2_eh: string; name: string };
		geometry: never;
	}>;
};
type Destination = {
	code: string;
	point: number[];
	servers: NezhaServer[];
	online: number;
};
export function nearbyRegions(
	nodes: Pick<Destination, "code" | "point">[],
	code: string,
	scale: number,
) {
	const center = nodes.find((n) => n.code === code);
	if (!center) return [];
	return nodes
		.filter(
			(n) =>
				Math.hypot(n.point[0] - center.point[0], n.point[1] - center.point[1]) *
					Math.max(scale, 0.01) <=
				44,
		)
		.map((n) => n.code)
		.sort();
}
export function DoraemonMap({
	now,
	serverList,
}: {
	now: number;
	serverList: NezhaServer[];
}) {
	const motion = useDoraMotion<HTMLElement>();
	const [active, setActive] = useState("");
	const [door, setDoor] = useState(false);
	const [choices, setChoices] = useState<string[]>([]);
	const [compact, setCompact] = useState(() => {
		try {
			return localStorage.getItem("doraemon:compact-map") !== "false";
		} catch {
			return true;
		}
	});
	const [scale, setScale] = useState(0.4);
	const svgRef = useRef<SVGSVGElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const returnFocus = useRef<HTMLElement | SVGElement | null>(null);
	const countries = useMemo(() => {
		const map = new Map<string, NezhaServer[]>();
		for (const server of serverList) {
			const code = server.country_code?.toUpperCase();
			if (code) map.set(code, [...(map.get(code) || []), server]);
		}
		return map;
	}, [serverList]);
	const projection = useMemo(
		() =>
			geoEquirectangular().scale(137).translate([450, 245]).rotate([-12, 0, 0]),
		[],
	);
	const path = useMemo(() => geoPath().projection(projection), [projection]);
	const features = useMemo(
		() => world.features.filter((f) => f.properties.iso_a2_eh),
		[],
	);
	const nodes = useMemo(
		() =>
			[...countries].flatMap(([code, servers]) => {
				const coords = countryCoordinates[code];
				const feature = features.find((f) => f.properties.iso_a2_eh === code);
				const point = coords
					? projection([coords.lng, coords.lat])
					: feature
						? path.centroid(feature)
						: null;
				return point?.every(Number.isFinite)
					? [
							{
								code,
								point,
								servers,
								online: servers.filter((s) => formatNezhaInfo(now, s).online)
									.length,
							},
						]
					: [];
			}),
		[countries, features, path, projection, now],
	);
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const measure = () => {
			const box = svg.getBoundingClientRect();
			if (box.width && box.height)
				setScale(Math.min(box.width / 900, box.height / 460));
		};
		measure();
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		observer?.observe(svg);
		window.addEventListener("resize", measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	useEffect(() => {
		if (door)
			panelRef.current
				?.querySelector<HTMLElement>(
					choices.length
						? ".dora-region-choice"
						: ".dora-destinations a, .dora-door-close",
				)
				?.focus();
		else {
			returnFocus.current?.focus();
			returnFocus.current = null;
		}
	}, [door, choices.length]);
	const close = () => {
		setDoor(false);
		setActive("");
		setChoices([]);
	};
	const open = (
		code: string,
		trigger: HTMLElement | SVGElement,
		exact = false,
	) => {
		returnFocus.current = trigger;
		const nearby = exact ? [code] : nearbyRegions(nodes, code, scale);
		setChoices(nearby.length > 1 ? nearby : []);
		setActive(nearby.length > 1 ? "" : code);
		setDoor(true);
	};
	const selected = active && countries.has(active) ? active : "";
	const destinations = selected ? countries.get(selected) || [] : serverList;
	const validChoices = choices.filter((code) => countries.has(code));
	return (
		<section
			className="dora-map"
			data-compact={compact}
			aria-label="任意门传送网络"
			{...motion}
		>
			<div className="dora-map-title" inert={door}>
				<div>
					<strong>🚪 任意门传送网络</strong>
					<p>
						{countries.size} 个目的地 · {serverList.length} 件神奇道具
					</p>
				</div>
				<div className="dora-map-actions">
					<button
						className="dora-map-size"
						aria-label={compact ? "展开地图" : "紧凑地图"}
						aria-pressed={!compact}
						onClick={() => {
							setCompact(!compact);
							try {
								localStorage.setItem("doraemon:compact-map", String(!compact));
							} catch {
								/* Optional preference storage. */
							}
						}}
					>
						{compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
					</button>
					<button
						aria-expanded={door}
						onClick={(e) => {
							returnFocus.current = e.currentTarget;
							setActive("");
							setChoices([]);
							setDoor(true);
						}}
					>
						任意门
					</button>
				</div>
			</div>
			<div className="dora-map-canvas" inert={door}>
				{/* biome-ignore lint/a11y/useSemanticElements: SVG group contains keyboard-accessible destinations. */}
				<svg
					ref={svgRef}
					viewBox="0 0 900 460"
					role="group"
					aria-label="服务器地区分布图"
				>
					{features.map((feature, i) => (
						<path
							key={i}
							d={path(feature) || ""}
							className={
								countries.has(feature.properties.iso_a2_eh)
									? "dora-country occupied"
									: "dora-country"
							}
						/>
					))}
					<DoraNetwork nodes={nodes.filter((n) => n.online)} />
					{nodes.map((node) => (
						// biome-ignore lint/a11y/useSemanticElements: SVG cannot contain native HTML buttons; keyboard behavior is provided.
						<g
							key={node.code}
							tabIndex={0}
							role="button"
							aria-label={node.code + " " + node.servers.length + " 台服务器"}
							aria-expanded={door && selected === node.code}
							onMouseEnter={() => {
								if (!door) setActive(node.code);
							}}
							onClick={(e) => open(node.code, e.currentTarget)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									open(node.code, e.currentTarget, true);
								}
							}}
						>
							<circle
								className="dora-map-hit"
								cx={node.point[0]}
								cy={node.point[1]}
								r={22 / scale}
							/>
							<circle
								className={
									node.online ? "dora-map-halo" : "dora-map-halo is-offline"
								}
								cx={node.point[0]}
								cy={node.point[1]}
								r={9}
							/>
							<circle
								className="dora-map-dot"
								cx={node.point[0]}
								cy={node.point[1]}
								r={4}
							/>
							<title>
								{node.code + ": " + node.servers.map((s) => s.name).join("、")}
							</title>
						</g>
					))}
				</svg>
			</div>
			<img className="dora-map-peek" src={art.doraemon} alt="" />
			<div className="dora-map-caption" aria-hidden={door}>
				{selected ? (
					<>
						<b>
							{selected} · {destinations.length} 台服务器
						</b>
						<span>{destinations.map((s) => s.name).join("、")}</span>
					</>
				) : (
					<>
						<b>任意门目的地</b>
						<span>点击地区，选择服务器详情</span>
					</>
				)}
			</div>
			{door && (
				<section
					ref={panelRef}
					className="dora-door-panel"
					aria-label="任意门目的地"
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							close();
						}
					}}
				>
					<img src={art.door} alt="" />
					<div>
						<strong>
							{validChoices.length
								? "这些地区比较近，请选择"
								: selected
									? selected + " · 选择服务器"
									: "选择你的目的地"}
						</strong>
						<div className="dora-destinations">
							{validChoices.length
								? validChoices.map((code) => (
										<button
											className="dora-region-choice"
											key={code}
											onClick={() => {
												setActive(code);
												setChoices([]);
											}}
										>
											{code} · {countries.get(code)?.length} 台服务器 →
										</button>
									))
								: destinations.map((s) => (
										<Link key={s.id} to={"/server/" + s.id}>
											{s.name} →
										</Link>
									))}
							{!validChoices.length && !destinations.length && (
								<p>暂无可用服务器</p>
							)}
						</div>
						<button className="dora-door-close" onClick={close}>
							关闭任意门
						</button>
					</div>
				</section>
			)}
		</section>
	);
}
