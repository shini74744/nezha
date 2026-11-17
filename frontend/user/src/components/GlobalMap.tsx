import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { ArrowLeft, ArrowUpRight, Globe2, LocateFixed } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import useTooltip from "@/hooks/use-tooltip";
import { geoJsonString } from "@/lib/geo-json-string";
import { countryCoordinates } from "@/lib/geo-limit";
import { saveMainPageScrollPosition } from "@/lib/navigation";
import { formatNezhaInfo } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";
import MapTooltip from "./MapTooltip";
import "./global-map.css";

type MapFeature = {
	type: "Feature";
	properties: { iso_a2_eh: string; iso_a3_eh: string; [key: string]: string };
	geometry: never;
};
type TooltipServer = { id: number; name: string; status: boolean };
const filteredFeatures = (
	JSON.parse(geoJsonString).features as MapFeature[]
).filter((feature) => feature.properties.iso_a3_eh !== "");
const graticule = geoGraticule10();
const emptyRegionNames: Record<string, string> = {};
const sphere = { type: "Sphere" as const };

export default function GlobalMap({
	serverList,
	now,
}: {
	serverList: NezhaServer[];
	now: number;
}) {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { setTooltipData } = useTooltip();
	const [selected, setSelected] = useState<string | null>(null);
	const { countries, countryServers, serverCounts, online } = useMemo(() => {
		const countryServers: Record<string, TooltipServer[]> = {};
		let online = 0;
		for (const server of serverList) {
			const status = formatNezhaInfo(now, server).online;
			if (status) online++;
			if (!server.country_code) continue;
			const code = server.country_code.toUpperCase();
			countryServers[code] ??= [];
			countryServers[code].push({
				id: server.id,
				name: server.name,
				status,
			});
		}
		const countries = Object.keys(countryServers).sort(
			(a, b) =>
				countryServers[b].length - countryServers[a].length ||
				a.localeCompare(b),
		);
		const serverCounts = Object.fromEntries(
			countries.map((code) => [code, countryServers[code].length]),
		);
		return { countries, countryServers, serverCounts, online };
	}, [serverList, now]);
	const regionNames = useMemo(() => {
		let names: Intl.DisplayNames | undefined;
		try {
			names = new Intl.DisplayNames(
				[i18n.resolvedLanguage || i18n.language || "en"],
				{ type: "region" },
			);
		} catch {
			/* Use the map's names on older browsers. */
		}
		return Object.fromEntries(
			countries.map((code) => {
				let name = countryCoordinates[code]?.name || code;
				try {
					name = names?.of(code) || name;
				} catch {
					/* Unknown region codes remain visible. */
				}
				return [code, name];
			}),
		);
	}, [countries, i18n.language, i18n.resolvedLanguage]);
	const active = selected && countryServers[selected] ? selected : null;
	const selectedServers = active ? countryServers[active] : [];
	const selectedOnline = selectedServers.filter(
		(server) => server.status,
	).length;
	const selectCountry = (code: string | null) => {
		setSelected(code);
		setTooltipData(null);
	};
	const openServer = (id: number) => {
		setTooltipData(null);
		saveMainPageScrollPosition();
		navigate(`/server/${id}`);
	};
	const maxCount = Math.max(1, ...Object.values(serverCounts));

	return (
		<section className="global-map-shell" aria-label={t("map.Title")}>
			<header className="global-map-header">
				<div className="global-map-heading">
					<span className="global-map-emblem" aria-hidden="true">
						<Globe2 size={23} strokeWidth={1.5} />
					</span>
					<div>
						<h2>{t("map.Title")}</h2>
						<p>
							{t("map.Distributions")} <strong>{countries.length}</strong>{" "}
							{t("map.Regions")}
						</p>
					</div>
				</div>
				<div className="global-map-totals">
					<div>
						<span>{t("map.TotalNodes")}</span>
						<strong>{serverList.length}</strong>
					</div>
					<div>
						<span>
							<i className="map-status-dot online" />
							{t("map.Online")}
						</span>
						<strong>{online}</strong>
					</div>
				</div>
			</header>
			<div className="global-map-body">
				<div className="global-map-stage">
					<InteractiveMap
						countries={countries}
						countryServers={countryServers}
						serverCounts={serverCounts}
						width={960}
						height={500}
						filteredFeatures={filteredFeatures}
						selectedCountry={active}
						onSelectCountry={selectCountry}
						regionNames={regionNames}
					/>
					<div className="global-map-caption">
						<span>
							<i />
							{t("map.Deployed")}
						</span>
						<span>{t("map.SelectHint")}</span>
					</div>
				</div>
				<aside
					className="global-map-panel"
					aria-label={active ? regionNames[active] : t("map.RegionOverview")}
				>
					{active ? (
						<>
							<button
								type="button"
								className="global-map-back"
								onClick={() => selectCountry(null)}
							>
								<ArrowLeft size={14} />
								{t("map.AllRegions")}
							</button>
							<div className="global-map-region-title">
								<span className="global-map-region-code">{active}</span>
								<h3>{regionNames[active]}</h3>
							</div>
							<div className="global-map-region-stats">
								<strong>
									{selectedServers.length}
									<small>{t("map.Servers")}</small>
								</strong>
								<span>
									<i className="map-status-dot online" />
									{t("map.Online")} {selectedOnline}
									<br />
									<i className="map-status-dot offline" />
									{t("map.Offline")} {selectedServers.length - selectedOnline}
								</span>
							</div>
							<div className="global-map-server-list">
								{selectedServers.map((server) => (
									<button
										type="button"
										key={server.id}
										onClick={() => openServer(server.id)}
									>
										<i
											role="img"
											className={`map-status-dot ${server.status ? "online" : "offline"}`}
											aria-label={t(
												server.status ? "map.Online" : "map.Offline",
											)}
										/>
										<span>{server.name}</span>
										<ArrowUpRight size={14} aria-hidden="true" />
									</button>
								))}
							</div>
						</>
					) : (
						<>
							<div className="global-map-panel-heading">
								<h3>{t("map.RegionOverview")}</h3>
								<LocateFixed size={16} aria-hidden="true" />
							</div>
							<p className="global-map-panel-hint">{t("map.SelectHint")}</p>
							<div className="global-map-region-list">
								{countries.map((code) => (
									<button
										type="button"
										key={code}
										onClick={() => selectCountry(code)}
										aria-label={`${regionNames[code]} · ${serverCounts[code]} ${t("map.Servers")}`}
									>
										<span className="global-map-list-code">{code}</span>
										<span className="global-map-list-label">
											{regionNames[code]}
											<i
												style={{
													width: `${(serverCounts[code] / maxCount) * 100}%`,
												}}
											/>
										</span>
										<strong>{serverCounts[code]}</strong>
									</button>
								))}
								{countries.length === 0 && (
									<p className="global-map-empty">{t("map.NoRegions")}</p>
								)}
							</div>
						</>
					)}
				</aside>
			</div>
			{countries.length > 0 && (
				<nav className="global-map-regions" aria-label={t("map.AllRegions")}>
					<button
						type="button"
						aria-pressed={!active}
						onClick={() => selectCountry(null)}
					>
						{t("map.AllRegions")}
					</button>
					{countries.map((code) => (
						<button
							type="button"
							key={code}
							aria-pressed={active === code}
							onClick={() => selectCountry(code)}
						>
							<span>{regionNames[code]}</span>
							<b>{serverCounts[code]}</b>
						</button>
					))}
				</nav>
			)}
		</section>
	);
}

interface InteractiveMapProps {
	countries: string[];
	serverCounts: Record<string, number>;
	width: number;
	height: number;
	filteredFeatures: MapFeature[];
	countryServers: Record<string, TooltipServer[]>;
	selectedCountry?: string | null;
	onSelectCountry?: (country: string) => void;
	regionNames?: Record<string, string>;
}

export function InteractiveMap({
	countries,
	serverCounts,
	width,
	height,
	filteredFeatures,
	countryServers,
	selectedCountry,
	onSelectCountry,
	regionNames = emptyRegionNames,
}: InteractiveMapProps) {
	const { setTooltipData } = useTooltip();
	const { t } = useTranslation();
	const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const [hovered, setHovered] = useState<string | null>(null);
	const { path, projection } = useMemo(() => {
		const projection = geoNaturalEarth1()
			.rotate([-10, 0, 0])
			.fitExtent(
				[
					[14, 12],
					[width - 14, height - 12],
				],
				sphere,
			);
		return { path: geoPath().projection(projection), projection };
	}, [width, height]);
	const shapes = useMemo(
		() =>
			filteredFeatures.map((feature) => ({
				feature,
				d: path(feature) || "",
				centroid: path.centroid(feature),
			})),
		[filteredFeatures, path],
	);
	const hoverAnchor = useRef<{
		centroid: [number, number];
		name: string;
	} | null>(null);
	useEffect(() => {
		if (!hovered || !hoverAnchor.current) return;
		if (!countryServers[hovered]) {
			setHovered(null);
			setTooltipData(null);
			return;
		}
		setTooltipData({
			centroid: hoverAnchor.current.centroid,
			country: regionNames[hovered] || hoverAnchor.current.name,
			count: serverCounts[hovered] || 0,
			servers: countryServers[hovered],
		});
	}, [hovered, countryServers, serverCounts, regionNames, setTooltipData]);
	const highlighted = useMemo(() => new Set(countries), [countries]);
	const features = useMemo(
		() =>
			new Map(
				filteredFeatures.map((feature) => [
					feature.properties.iso_a2_eh,
					feature,
				]),
			),
		[filteredFeatures],
	);
	const show = (code: string, centroid: [number, number], name: string) => {
		hoverAnchor.current = { centroid, name };
		setHovered(code);
		setTooltipData({
			centroid,
			country: regionNames[code] || name,
			count: serverCounts[code] || 0,
			servers: countryServers[code] ?? [],
		});
	};
	const clear = () => {
		setHovered(null);
		setTooltipData(null);
	};
	const select = (code: string) => {
		clear();
		onSelectCountry?.(code);
	};
	const keySelect = (event: React.KeyboardEvent<SVGElement>, code: string) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			select(code);
		}
		if (event.key === "Escape") clear();
	};
	return (
		<div className="global-map-canvas relative" onMouseLeave={clear}>
			<svg
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				xmlns="http://www.w3.org/2000/svg"
				aria-label={t("map.Title")}
			>
				<defs>
					<linearGradient id={`land-${id}`} x1="0" y1="0" x2="0" y2="1">
						<stop className="map-land-top" offset="0%" />
						<stop className="map-land-bottom" offset="100%" />
					</linearGradient>
					<linearGradient id={`active-${id}`} x1="0" y1="0" x2="1" y2="1">
						<stop className="map-active-top" offset="0%" />
						<stop className="map-active-bottom" offset="100%" />
					</linearGradient>
					<radialGradient id={`ocean-${id}`}>
						<stop className="map-ocean-center" offset="0%" />
						<stop className="map-ocean-edge" offset="100%" />
					</radialGradient>
				</defs>
				<rect
					width={width}
					height={height}
					fill="transparent"
					onMouseEnter={clear}
				/>
				<g pointerEvents="none">
					<path
						className="global-map-ocean"
						d={path(sphere) || ""}
						fill={`url(#ocean-${id})`}
					/>
					<path className="global-map-grid" d={path(graticule) || ""} />
				</g>
				<g className="global-map-land">
					{shapes.map(({ feature, d, centroid }, index) => {
						const code = feature.properties.iso_a2_eh;
						const occupied = highlighted.has(code);
						return (
							<path
								key={code + index}
								data-country={code}
								data-occupied={occupied || undefined}
								data-selected={selectedCountry === code || undefined}
								data-hovered={hovered === code || undefined}
								className="global-map-country"
								d={d}
								fill={`url(#${occupied ? "active" : "land"}-${id})`}
								role={occupied ? "button" : undefined}
								tabIndex={occupied ? 0 : undefined}
								aria-label={
									occupied
										? `${regionNames[code] || feature.properties.name} · ${serverCounts[code]} ${t("map.Servers")}`
										: undefined
								}
								onMouseEnter={() =>
									occupied
										? show(code, centroid, feature.properties.name)
										: clear()
								}
								onFocus={() =>
									occupied && show(code, centroid, feature.properties.name)
								}
								onBlur={clear}
								onClick={() => occupied && select(code)}
								onKeyDown={(event) => occupied && keySelect(event, code)}
							/>
						);
					})}
				</g>
				<g className="global-map-markers">
					{countries.map((code) => {
						const coords = countryCoordinates[code];
						const feature = features.get(code);
						const point = coords
							? projection([coords.lng, coords.lat])
							: feature
								? path.centroid(feature)
								: null;
						if (!point?.every(Number.isFinite)) return null;
						const [x, y] = point;
						const online = (countryServers[code] ?? []).some(
							(server) => server.status,
						);
						const name =
							regionNames[code] ||
							coords?.name ||
							feature?.properties.name ||
							code;
						return (
							// biome-ignore lint/a11y/useSemanticElements: SVG markers require an SVG group; keyboard activation is provided.
							<g
								key={code}
								className="global-map-marker"
								data-region={code}
								data-selected={selectedCountry === code || undefined}
								data-hovered={hovered === code || undefined}
								data-online={online}
								role="button"
								tabIndex={0}
								aria-label={`${name} · ${serverCounts[code]} ${t("map.Servers")}`}
								onMouseEnter={() => show(code, [x, y], name)}
								onFocus={() => show(code, [x, y], name)}
								onBlur={clear}
								onClick={() => select(code)}
								onKeyDown={(event) => keySelect(event, code)}
							>
								<circle
									className="global-map-marker-hit"
									cx={x}
									cy={y}
									r={11}
								/>
								<circle
									className="global-map-marker-halo"
									cx={x}
									cy={y}
									r={8}
								/>
								<circle
									className="global-map-marker-core"
									cx={x}
									cy={y}
									r={3.5}
								/>
							</g>
						);
					})}
				</g>
			</svg>
			<MapTooltip width={width} height={height} />
		</div>
	);
}
