import dayjs from "dayjs";
import type { NezhaServer } from "@/types/nezha-api";
import {NativeName} from "@/appearance/widgets";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BackIcon } from "@/components/Icon";
import { ServerDetailLoading } from "@/components/loading/ServerDetailLoading";
import ServerFlag from "@/components/ServerFlag";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { formatBytes } from "@/lib/format";
import { cn, formatNezhaInfo } from "@/lib/utils";
import NumericText from "./NumericText";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "./ui/accordion";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./ui/tooltip";

export default function ServerDetailOverview({
	server_id,
	recorded,
}: {
	server_id: string;
	recorded?: { at?: number; metrics: Record<string, number>; elapsed: string; server?: NezhaServer };
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();

	const [hasHistory, setHasHistory] = useState(false);

	useEffect(() => {
		const previousPath = sessionStorage.getItem("fromMainPage");
		if (previousPath) {
			setHasHistory(true);
		}

		return () => {
			if (previousPath) {
				sessionStorage.removeItem("fromMainPage");
			}
		};
	}, []);

	const { lastData, connected } = useWebSocketContext();

	if (!connected && !lastData) {
		return <ServerDetailLoading />;
	}

	const linkClick = () => {
		if (hasHistory) {
			navigate(-1);
		} else {
			navigate("/");
		}
	};

	const nezhaWsData = lastData;

	if (!nezhaWsData) {
		return <ServerDetailLoading />;
	}

	const server = recorded?.server ?? nezhaWsData.servers.find((s) => s.id === Number(server_id));

	if (!server) {
		return <ServerDetailLoading />;
	}

	const info = formatNezhaInfo(nezhaWsData.now, server);
	const snapshot = recorded ? {
		...info, online: false, uptime: recorded.metrics.uptime ?? 0,
		load_1: recorded.metrics.load1?.toFixed(2) ?? "未知",
		load_5: recorded.metrics.load5?.toFixed(2) ?? "未知",
		load_15: recorded.metrics.load15?.toFixed(2) ?? "未知",
		net_out_transfer: recorded.metrics.net_out_transfer ?? 0,
		net_in_transfer: recorded.metrics.net_in_transfer ?? 0,
		last_active_time_string: recorded.at ? dayjs(recorded.at).format("YYYY-MM-DD HH:mm:ss") : "",
		boot_time_string: recorded.server ? info.boot_time_string : recorded.at && recorded.metrics.uptime !== undefined ? dayjs(recorded.at - recorded.metrics.uptime * 1000).format("YYYY-MM-DD HH:mm:ss") : "",
	} : info;
	const {
		name,
		online,
		uptime,
		version,
		arch,
		mem_total,
		disk_total,
		country_code,
		platform,
		platform_version,
		cpu_info,
		gpu_info,
		load_1,
		load_5,
		load_15,
		net_out_transfer,
		net_in_transfer,
		last_active_time_string,
		boot_time_string,
	} = snapshot;

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	countries.registerLocale(enLocale);

	return (
		<div
			data-offline-summary={recorded ? true : undefined}
			className={cn({
				"bg-card/70 p-4 rounded-[10px]": customBackgroundImage,
			})}
		>
			<div
				onClick={linkClick}
				className="flex flex-none cursor-pointer font-semibold leading-none items-center break-all tracking-tight gap-1 text-xl server-name"
			>
				<BackIcon />
				<NativeName online={online} detail>{name}</NativeName>
			</div>
			<section className="flex flex-wrap gap-2 mt-3">
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">
								{t("serverDetail.status")}
							</p>
							<Badge
								className={cn(
									"text-[9px] rounded-[6px] w-fit px-1 py-0 -mt-[0.3px] dark:text-white",
									{
										" bg-green-800": online,
										" bg-red-600": !online,
									},
								)}
							>
								{online ? t("serverDetail.online") : t("serverDetail.offline")}
							</Badge>
						</section>
					</CardContent>
				</Card>
				{(online || recorded?.metrics.uptime !== undefined) && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.uptime")}
								</p>
								<NumericText
									value={
										uptime / 86400 >= 1
											? `${Math.floor(uptime / 86400)} ${t("serverDetail.days")} ${Math.floor((uptime % 86400) / 3600)} ${t("serverDetail.hours")}`
											: `${Math.floor(uptime / 3600)} ${t("serverDetail.hours")}`
									}
									className="text-xs"
								/>
							</section>
						</CardContent>
					</Card>
				)}
				{version && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.version")}
								</p>
								<div className="text-xs">{version} </div>
							</section>
						</CardContent>
					</Card>
				)}
				{arch && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.arch")}
								</p>
								<div className="text-xs">{arch} </div>
							</section>
						</CardContent>
					</Card>
				)}

				{mem_total ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.mem")}
								</p>
								<div className="text-xs">{formatBytes(mem_total)}</div>
							</section>
						</CardContent>
					</Card>
				) : null}

				{disk_total ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.disk")}
								</p>
								<div className="text-xs">{formatBytes(disk_total)}</div>
							</section>
						</CardContent>
					</Card>
				) : null}

				{country_code && (
					<TooltipProvider delayDuration={100}>
						<Tooltip>
							<TooltipTrigger asChild>
								<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
									<CardContent className="px-1.5 py-1">
										<section className="flex flex-col items-start gap-0.5">
											<p className="text-xs text-muted-foreground">
												{t("serverDetail.region")}
											</p>
											<section className="flex items-start gap-1">
												<div className="text-xs text-start">
													{country_code?.toUpperCase()}
												</div>
												{country_code && (
													<ServerFlag
														className="text-[11px] -mt-px"
														country_code={country_code}
													/>
												)}
											</section>
										</section>
									</CardContent>
								</Card>
							</TooltipTrigger>
							<TooltipContent>
								<p>{countries.getName(country_code?.toUpperCase(), "en")}</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				)}
			</section>
			<section className="flex flex-wrap gap-2 mt-1">
				{platform && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.system")}
								</p>
								<div className="text-xs">
									{" "}
									{platform} {platform_version ? ` - ${platform_version}` : ""}
								</div>
							</section>
						</CardContent>
					</Card>
				)}
				{cpu_info.length > 0 && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">{"CPU"}</p>
								<div className="text-xs"> {cpu_info.join(", ")}</div>
							</section>
						</CardContent>
					</Card>
				)}
				{gpu_info.length > 0 && (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">{"GPU"}</p>
								<div className="text-xs">{gpu_info.join(", ")}</div>
							</section>
						</CardContent>
					</Card>
				)}
			</section>
			<section className="flex flex-wrap gap-2 mt-1">
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">{"Load"}</p>
							<div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
								{[
									{ label: "1m", value: load_1 },
									{ label: "5m", value: load_5 },
									{ label: "15m", value: load_15 },
								].map(({ label, value }) => (
									<div key={label} className="flex items-center gap-1">
										<span className="text-[10px] text-muted-foreground">
											{label}
										</span>
										<NumericText value={`${value}`} className="text-xs" />
									</div>
								))}
							</div>
						</section>
					</CardContent>
				</Card>
				{net_out_transfer ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.upload")}
								</p>
								{net_out_transfer ? (
									<NumericText
										value={formatBytes(net_out_transfer)}
										className="text-xs"
									/>
								) : (
									<div className="text-xs"> {t("serverDetail.unknown")}</div>
								)}
							</section>
						</CardContent>
					</Card>
				) : null}
				{net_in_transfer ? (
					<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
						<CardContent className="px-1.5 py-1">
							<section className="flex flex-col items-start gap-0.5">
								<p className="text-xs text-muted-foreground">
									{t("serverDetail.download")}
								</p>
								{net_in_transfer ? (
									<NumericText
										value={formatBytes(net_in_transfer)}
										className="text-xs"
									/>
								) : (
									<div className="text-xs"> {t("serverDetail.unknown")}</div>
								)}
							</section>
						</CardContent>
					</Card>
				) : null}
			</section>
			<section className="flex flex-wrap gap-2 mt-1">
				{(!recorded || recorded.server) && server?.state.temperatures &&
					server?.state.temperatures.length > 0 && (
						<section className="flex flex-wrap gap-2 ml-1.5">
							<Accordion type="single" collapsible className="w-fit">
								<AccordionItem value="item-1" className="border-none">
									<AccordionTrigger className="text-xs py-0 text-muted-foreground font-normal">
										{t("serverDetail.temperature")}
									</AccordionTrigger>
									<AccordionContent className="pb-0">
										<section className="flex items-start flex-wrap gap-2">
											{server?.state.temperatures.map((item, index) => (
												<div className="text-xs flex items-center" key={index}>
													<p className="font-semibold">{item.Name}</p>:{" "}
													{item.Temperature.toFixed(2)} °C
												</div>
											))}
										</section>
									</AccordionContent>
								</AccordionItem>
							</Accordion>
						</section>
					)}
			</section>

			<section className="flex flex-wrap gap-2 mt-1">
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">
								{t("serverDetail.bootTime")}
							</p>
							<div className="text-xs">
								{boot_time_string ? boot_time_string : "N/A"}
							</div>
						</section>
					</CardContent>
				</Card>
				<Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0">
					<CardContent className="px-1.5 py-1">
						<section className="flex flex-col items-start gap-0.5">
							<p className="text-xs text-muted-foreground">
								{t("serverDetail.lastActive")}
							</p>
							{recorded?.at ? <time className="text-xs" dateTime={new Date(recorded.at).toISOString()}>{last_active_time_string}</time> : <NumericText value={last_active_time_string || "N/A"} className="text-xs" />}
						</section>
					</CardContent>
				</Card>
				{recorded && <Card className="rounded-[10px] bg-transparent border-none shadow-none ring-0"><CardContent className="px-1.5 py-1"><section className="flex flex-col items-start gap-0.5"><p className="text-xs text-muted-foreground">距最后上报（离线时长）</p><p className="text-xs">{recorded.elapsed}</p></section></CardContent></Card>}
			</section>
		</div>
	);
}
