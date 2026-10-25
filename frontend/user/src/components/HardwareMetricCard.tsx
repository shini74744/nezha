import MetricTimeTick from "@/components/MetricTimeTick";
import ChartDetailButton from "@/components/ChartDetail";
import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import GpuMemorySummary from "@/components/GpuMemorySummary";
import { cn, formatRelativeTime, formatTime } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { snapshotInterval } from "@/lib/snapshot-interval";
import {
	availableModes,
	cpuTemperatureReading,
	hardwarePoints,
	hardwareValue,
	memoryPair,
	recordedMetricKey,
	sampleGPU,
	type HardwareMode,
	type State,
} from "@/lib/hardware-metrics";
import type {
	MetricDataPoint,
	NezhaWebsocketResponse,
} from "@/types/nezha-api";

type Props = {
	id: number;
	now: number;
	state: State;
	index?: number;
	name?: string;
	identity?: string;
	history?: NezhaWebsocketResponse[];
	recorded?: boolean;
	recent?: Record<string, MetricDataPoint[]>;
};
const labels: Record<HardwareMode, string> = {
	usage: "使用率",
	temperature: "温度",
	frequency: "频率",
	memory: "显存",
	shared: "共享内存",
};
const clockLabels: Record<string, string> = {
	current: "当前频率",
	reported: "系统报告频率",
	nominal: "标称频率",
};
export default function HardwareMetricCard({
	id,
	now,
	state,
	index,
	name,
	identity,
	history = [],
	recorded = false,
	recent = {},
}: Props) {
	const { t } = useTranslation();
	const scope = index === undefined ? "CPU" : "GPU";
	const cardKey = id + ":" + scope + ":" + (identity ?? index ?? "cpu");
	const [selected, setSelected] = useState<{ key: string; mode: HardwareMode }>(
		{ key: cardKey, mode: "usage" },
	);
	const modes = availableModes(state, index, identity);
	const requested = selected.key === cardKey ? selected.mode : "usage";
	const mode = modes.includes(requested) ? requested : (modes[0] ?? "usage");
	const next = modes[(modes.indexOf(mode) + 1) % modes.length] ?? mode;
	const label = (m: HardwareMode) => t("hardware." + m, labels[m]);
	const title = scope + " " + label(mode);
	const v = hardwareValue(state, mode, index, identity);
	const percent = ["usage", "memory", "shared"].includes(mode);
	const format = (value: number) =>
		mode === "temperature"
			? value.toFixed(1) + " °C"
			: mode === "frequency"
				? value >= 1000
					? (value / 1000).toFixed(2) + " GHz"
					: value.toFixed(0) + " MHz"
				: value.toFixed(1) + "%";
	const gpu =
		index === undefined ? undefined : sampleGPU(state, index, identity);
	const pair =
		mode === "memory" || mode === "shared"
			? memoryPair(gpu, mode === "shared")
			: undefined;
	const points = useMemo(() => {
		if (!recorded)
			return hardwarePoints(history, id, now, state, mode, index, identity);
		const rows = recent[recordedMetricKey(mode, index)] ?? [];
		const values = rows.map((p) => ({
			timeStamp: String(p.ts),
			value: Number.isFinite(p.value) ? p.value : null,
		}));
		if (v !== undefined && !values.some((p) => Number(p.timeStamp) === now))
			values.push({ timeStamp: String(now), value: v });
		values.sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp));
		const interval = snapshotInterval(values.map((p) => Number(p.timeStamp)));
		const withGaps: typeof values = [];
		for (const row of values) {
			const prev = withGaps[withGaps.length - 1];
			if (prev && Number(row.timeStamp) - Number(prev.timeStamp) > interval * 2)
				withGaps.push({
					timeStamp: String(Number(prev.timeStamp) + interval),
					value: null,
				});
			withGaps.push(row);
		}
		return withGaps;
	}, [recorded, recent, history, id, now, state, mode, index, identity, v]);
	const color = index === undefined ? 1 : 3;
	return (
		<Card
			data-hardware-card={scope}
			data-hardware-mode={mode}
			data-recorded={recorded || undefined}
			className={cn({ "bg-card/70": !!window.CustomBackgroundImage })}
		>
			<CardContent className="relative flex h-full flex-col px-6 py-3">
				<div className="flex h-[76px] min-w-0 flex-col justify-start gap-1">
					<div className="flex min-h-7 min-w-0 items-center justify-between gap-2">
						<button
							type="button"
							disabled={modes.length < 2}
							onClick={() => setSelected({ key: cardKey, mode: next })}
							aria-label={
								modes.length > 1
									? t("hardware.switch", "点击切换到") +
										scope +
										" " +
										label(next)
									: title
							}
							title={
								modes.length > 1
									? t("hardware.switch", "点击切换到") +
										scope +
										" " +
										label(next)
									: title
							}
							className="inline-flex min-w-0 touch-manipulation items-center gap-1.5 rounded-sm text-left text-md font-medium outline-none transition-colors enabled:cursor-pointer enabled:hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
						>
							<span className="whitespace-nowrap">{title}</span>
							{modes.length > 1 && (
								<ArrowLeftRight
									aria-hidden
									className="size-3 shrink-0 text-muted-foreground"
								/>
							)}
						</button>
						<span
							data-hardware-value
							className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums"
						>
							{v === undefined ? "—" : format(v)}
						</span>
					</div>
					{name && (
						<p
							className="truncate text-[11px] text-muted-foreground"
							title={name}
						>
							GPU: {name.replace(/ \[[^\]]+\]$/, "")}
						</p>
					)}
					<div className="min-h-4 text-[11px] text-muted-foreground">
						{mode === "frequency" ? (
							<span>
								{t(
									"hardware." + state.cpu_frequency_kind,
									clockLabels[state.cpu_frequency_kind ?? ""] ?? "",
								)}
							</span>
						) : mode === "temperature" ? (
							<span>
								{index === undefined
									? cpuTemperatureReading(state)?.source === "package"
										? t("hardware.cpuPackage", "CPU 封装温度")
										: cpuTemperatureReading(state)?.source === "core"
											? t("hardware.cpuCoreMax", "最高核心温度")
											: t(
													"hardware.cpuSensorFallback",
													"CPU 传感器温度（未识别封装或核心）",
												)
									: t("hardware.gpuCore", "GPU 核心温度")}
							</span>
						) : pair ? (
							<span className="whitespace-nowrap tabular-nums">
								{formatBytes(pair.used)} / {formatBytes(pair.total)}
							</span>
						) : index !== undefined && mode === "usage" ? (
							<GpuMemorySummary memory={gpu} recorded={recorded} />
						) : null}
					</div>
				</div>
				<ChartContainer
					config={{ value: { label: title } }}
					className="mt-auto aspect-auto h-[130px] w-full shrink-0"
				>
					<AreaChart
						key={mode}
						accessibilityLayer
						data={points}
						syncId={recorded ? "offlineDetailCharts" : "serverDetailCharts"}
						margin={{ top: 12, left: 12, right: 12 }}
					>
						<CartesianGrid vertical={false} />
						<XAxis tick={<MetricTimeTick />}
							dataKey="timeStamp"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={200}
							interval="preserveStartEnd"
							tickFormatter={(value) =>
								recorded ? formatTime(Number(value)) : formatRelativeTime(value)
							}
						/>
						<YAxis
							tickLine={false}
							axisLine={false}
							mirror
							tickMargin={-15}
							domain={percent ? [0, 100] : [0, "auto"]}
							tickFormatter={(value) =>
								format(Number(value)).replace(/\s/g, "")
							}
						/>
						<ChartTooltip
							isAnimationActive={false}
							content={
								<ChartTooltipContent
									indicator="dot"
									labelFormatter={(_, payload) =>
										formatTime(Number(payload[0]?.payload?.timeStamp))
									}
									formatter={(value) => (
										<div className="flex flex-1 items-center justify-between gap-2">
											<span>{title}</span>
											<span className="tabular-nums">
												{format(Number(value))}
											</span>
										</div>
									)}
								/>
							}
						/>
						<Area
							dataKey="value"
							type="step"
							fill={"hsl(var(--chart-" + color + "))"}
							stroke={"hsl(var(--chart-" + color + "))"}
							fillOpacity={0.3}
							isAnimationActive={false}
							connectNulls={false}
							dot={points.length === 1}
						/>
					</AreaChart>
				</ChartContainer>
                <ChartDetailButton scopeKey={cardKey+":"+mode+":"+recorded} title={title} data={points}
                    period={recorded?"last":"realtime"} series={[{key:"value",label:title,color:"hsl(var(--chart-"+color+"))"}]} formatValue={format}/>
			</CardContent>
		</Card>
	);
}
