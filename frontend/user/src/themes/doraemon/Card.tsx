import {
	Activity,
	ArrowDown,
	ArrowUp,
	HardDrive,
	Network,
	Package,
	Wind,
} from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";
import BillingInfo from "@/components/billingInfo";
import PlanInfo from "@/components/PlanInfo";
import ServerFlag from "@/components/ServerFlag";
import ServerLinkTags from "@/components/ServerLinkTags";
import { formatBytes } from "@/lib/format";
import { saveMainPageScrollPosition } from "@/lib/navigation";
import { formatNezhaInfo, parsePublicNote } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";
import { art } from "./assets";
import { formatNetworkRate } from "./format";
import { DoraemonTraffic } from "./Traffic";
import {CardGadget} from "./Gadgets";
import { useDoraRateColor } from "./speed-color";
import { useDoraRateEffect } from "./speed-effect";
import { useDoraMotion } from "./use-motion";

type Props = { now: number; serverInfo: NezhaServer };
export const positive = (n: number) =>
	Number.isFinite(n) ? Math.max(0, n) : 0;
export const percent = (used: number, total: number) =>
	total > 0 ? Math.min(100, (positive(used) / total) * 100) : 0;
const duration = (n: number) =>
	n >= 86400
		? Math.floor(n / 86400) + " 天"
		: n >= 3600
			? Math.floor(n / 3600) + " 小时"
			: Math.floor(n / 60) + " 分钟";
function Meter({
	name,
	term,
	value,
	color,
	caption,
	icon: Icon,
}: {
	name: string;
	term: string;
	value: number;
	color: string;
	caption?: string;
	icon: typeof Wind;
}) {
	const safe = Math.min(100, positive(value));
	return (
		<div
			className="dora-meter"
			style={{ "--meter-color": color } as React.CSSProperties}
		>
			<div>
				<span title={name}>
					<Icon size={13} />
					{term}
				</span>
				<b>{safe.toFixed(1)}%</b>
			</div>
			<div
				className="dora-meter-track"
				role="progressbar"
				aria-label={term}
				aria-valuenow={safe}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<i style={{ width: safe + "%" }} />
			</div>
			<small className="dora-meter-name">{name}</small>
			{caption && <p>{caption}</p>}
		</div>
	);
}
function Card({ now, serverInfo: s }: Props) {
	const rateColor = useDoraRateColor();
	const rateEffect = useDoraRateEffect();
	const motion = useDoraMotion<HTMLElement>();
	const info = formatNezhaInfo(now, s),
		note = parsePublicNote(info.public_note);
	const st = s.state,
		host = s.host;
	return (
		<article
			{...motion}
			className={"dora-card " + (!info.online ? "is-offline" : "")}
			data-dora-card
			data-server-id={s.id}
		>
			<Link
				className="dora-card-detail"
				to={`/server/${s.id}`}
				aria-label={`查看服务器 ${s.name}`}
				onClick={saveMainPageScrollPosition}
			>
				<span className="sr-only">查看详情</span>
			</Link>
			<header className="dora-card-head">
				<i className="dora-nose" aria-hidden="true" />
				<div>
					<h2 title={s.name}>{s.name}</h2>
					<span>{info.online ? "元气满满 · 在线" : "待机充电中 · 离线"}</span>
				</div>
				<ServerFlag country_code={s.country_code} />
				<img src={art.bell} alt="" className="dora-card-bell" />
			</header>
			<div className="dora-card-body">
				<div className="dora-card-meta">
					<span>
						{info.online
							? "道具连续工作 " + duration(positive(st.uptime))
							: "最后在线 " +
								(!s.last_active.startsWith("000")
									? new Date(s.last_active).toLocaleString("zh-CN", {
											timeZone: "Asia/Shanghai",
											hour12: false,
										})
									: "暂无记录")}
					</span>
					<span>
						{host.platform || "未知系统"} · {host.arch || "—"}
					</span>
				</div>
				{info.online ? (
					<>
						<div className="dora-meters">
							<Meter
								name="竹蜻蜓转速"
								term="CPU"
								value={st.cpu}
								color="#0398d9"
								icon={Wind}
								caption={
									positive(st.load_1).toFixed(2) +
									" / " +
									positive(st.load_5).toFixed(2) +
									" / " +
									positive(st.load_15).toFixed(2)
								}
							/>
							<Meter
								name="四次元口袋"
								term="内存"
								value={percent(st.mem_used, host.mem_total)}
								color="#e35081"
								icon={Package}
								caption={
									formatBytes(positive(st.mem_used), 1) +
									" / " +
									formatBytes(positive(host.mem_total), 1)
								}
							/>
							<Meter
								name="百宝袋"
								term="磁盘"
								value={percent(st.disk_used, host.disk_total)}
								color="#dc9b15"
								icon={HardDrive}
								caption={
									formatBytes(positive(st.disk_used), 1) +
									" / " +
									formatBytes(positive(host.disk_total), 1)
								}
							/>
							<Meter
								name="备用口袋"
								term="Swap"
								value={percent(st.swap_used, host.swap_total)}
								color="#8b64d9"
								icon={Activity}
								caption={
									host.swap_total
										? formatBytes(positive(st.swap_used), 1) +
											" / " +
											formatBytes(positive(host.swap_total), 1)
										: "未配置 Swap"
								}
							/>
						</div>
						<div className="dora-network">
							<DoraemonTraffic serverId={s.id} />
							<div className="dora-transfer">
								<div>
									<div className="dora-transfer-heading">
										<span>
											<ArrowUp size={12} />
											上传
										</span>
										<b {...rateColor(st.net_out_speed, "up")} {...rateEffect(st.net_out_speed, "up")}>{formatNetworkRate(st.net_out_speed)}</b>
									</div>
									<small>
										累计 {formatBytes(positive(st.net_out_transfer), 1)}
									</small>
								</div>
								<div>
									<div className="dora-transfer-heading">
										<span>
											<ArrowDown size={12} />
											下载
										</span>
										<b {...rateColor(st.net_in_speed, "down")} {...rateEffect(st.net_in_speed, "down")}>{formatNetworkRate(st.net_in_speed)}</b>
									</div>
									<small>
										累计 {formatBytes(positive(st.net_in_transfer), 1)}
									</small>
								</div>
							</div>
						</div>
						<div className="dora-connections">
							<Network size={12} />
							<span>TCP {positive(st.tcp_conn_count)}</span>
							<span>UDP {positive(st.udp_conn_count)}</span>
							<span>进程 {positive(st.process_count)}</span>
						</div>
					</>
				) : (
					<div className="dora-offline">
						<DoraemonTraffic serverId={s.id} />
						<img src={art.doraemon} alt="" />
						<strong>道具暂时休息中</strong>
						<span>点击查看离线详情与历史记录</span>
					</div>
				)}
				{note?.billingDataMod && (
					<div className="dora-billing">
						<BillingInfo parsedData={note} />
					</div>
				)}
				{note?.planDataMod && <PlanInfo parsedData={note} />}
				<ServerLinkTags tags={note?.planDataMod?.linkTags} />
				<div className="dora-card-bottom">
					<CardGadget serverId={s.id}/>
					<small>#{s.id} · 查看详情 →</small>
				</div>
			</div>
		</article>
	);
}
export const DoraemonCard = memo(Card);
export function DoraemonInlineCard(props: Props) {
	return (
		<div className="dora-inline-card">
			<DoraemonCard {...props} />
		</div>
	);
}
