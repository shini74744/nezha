import {
	ArrowDown,
	ArrowUp,
	Boxes,
	DoorOpen,
	Heart,
	Power,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useRef } from "react";
import type ServerOverview from "@/components/ServerOverview";
import { useStatus } from "@/hooks/use-status";
import { createFiveTapGate } from "@/lib/five-tap";
import { formatBytes } from "@/lib/format";
import { art } from "./assets";
import { networkRateParts } from "./format";
import { useDoraRateColor } from "./speed-color";
import { useDoraRateEffect } from "./speed-effect";
import { useDoraMotion } from "./use-motion";

export function DoraemonOverview(
	p: ComponentProps<typeof ServerOverview> & { map?: ReactNode },
) {
	const { status, setStatus } = useStatus(),
		gate = useRef(createFiveTapGate());
	const rateColor = useDoraRateColor();
	const rateEffect = useDoraRateEffect();
	const motion = useDoraMotion<HTMLElement>();
	const tiles = [
		{
			title: "全部道具 · 服务器",
			value: String(p.total),
			icon: Boxes,
			color: "#d79712",
			status: "all",
		},
		{
			title: "元气满满 · 在线",
			value: String(p.online),
			icon: Heart,
			color: "#e54e78",
			status: "online",
		},
		{
			title: "待机充电 · 离线",
			value: String(p.offline),
			icon: Power,
			color: "#8f72d9",
			status: "offline",
		},
		{
			title: "任意门 · 上传",
			rate: networkRateParts(p.upSpeed),
			rateColor: rateColor(p.upSpeed, "up", true),
			rateEffect: rateEffect(p.upSpeed, "up", true),
			icon: ArrowUp,
			color: "#dc67a1",
		},
		{
			title: "任意门 · 下载",
			rate: networkRateParts(p.downSpeed),
			rateColor: rateColor(p.downSpeed, "down", true),
			rateEffect: rateEffect(p.downSpeed, "down", true),
			icon: ArrowDown,
			color: "#209e91",
		},
		{
			title: "时光机 · 累计传送",
			value: null,
			traffic: true,
			icon: DoorOpen,
			color: "#e18a34",
		},
	];
	return (
		<section {...motion} className={"dora-overview " + (!p.map ? "without-map" : "")}>
			<div className="dora-stat-grid">
				{tiles.map((tile) => (
					<button
						key={tile.title}
						className={"dora-stat" + (tile.status ? " dora-stat-count" : "")}
						style={{ "--stat-color": tile.color } as React.CSSProperties}
						aria-pressed={tile.status ? status === tile.status : undefined}
						disabled={!tile.status}
						onClick={() =>
							tile.status &&
							setStatus(tile.status as "all" | "online" | "offline")
						}
					>
						<span>{tile.title}</span>
						<tile.icon className="dora-stat-icon" size={22} />
						{tile.rate ? (
							<strong {...tile.rateColor} {...tile.rateEffect} className={["dora-stat-rate", tile.rateEffect?.className].filter(Boolean).join(" ")}>
								<span className="dora-rate-number">{tile.rate.value}</span>{" "}
								<span className="dora-rate-unit">{tile.rate.unit}</span>
							</strong>
						) : tile.traffic ? (
							<dl className="dora-total-traffic" aria-label="累计流量">
								<div>
									<dt>
										<ArrowUp size={12} />
										上传
									</dt>
									<dd>{formatBytes(p.up, 1)}</dd>
								</div>
								<div>
									<dt>
										<ArrowDown size={12} />
										下载
									</dt>
									<dd>{formatBytes(p.down, 1)}</dd>
								</div>
							</dl>
						) : (
							<strong>{tile.value}</strong>
						)}
						<tile.icon className="dora-stat-watermark" aria-hidden="true" />
					</button>
				))}
			</div>
			{p.map}
			<button
				className="dora-secret-toggle"
				aria-label="查看全部道具插图"
				onClick={() => {
					if (gate.current(Date.now())) p.onToggleDisplayHidden?.();
				}}
			>
				<img src={art.flying} alt="飞行的哆啦 A 梦" />
			</button>
		</section>
	);
}

export { DoraemonMap } from "./Map";
