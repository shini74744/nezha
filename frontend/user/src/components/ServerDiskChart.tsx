import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DiskIORates, DiskModeToggle } from "@/components/DiskCardHeader";
import { useTranslation } from "react-i18next";
import {
	Area,
	AreaChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import AnimatedCircularProgressBar from "@/components/ui/animated-circular-progress-bar";
import ChartSkeleton from "@/components/loading/ChartSkeleton";
import { fetchServerMetrics } from "@/lib/nezha-api";
import { formatBytes } from "@/lib/format";
import { cn, formatRelativeTime, formatTime } from "@/lib/utils";
import type {
	MetricDataPoint,
	MetricPeriod,
	NezhaServer,
	NezhaWebsocketResponse,
} from "@/types/nezha-api";

type Period = "realtime" | MetricPeriod;
type Point = {
	timeStamp: string;
	disk?: number;
	read?: number | null;
	write?: number | null;
};
const rate = (value: number) => `${formatBytes(value)}/s`;
const validRate = (value?: number) =>
	Number.isFinite(value ?? 0) && (value ?? 0) >= 0 ? (value ?? 0) : null;
const config = {
	disk: { label: "磁盘" },
	read: { label: "读取" },
	write: { label: "写入" },
};

export function realtimeDiskPoints(
	history: NezhaWebsocketResponse[],
	server: NezhaServer,
	now: number,
): Point[] {
	const samples = new Map<number, Point>();
	for (const payload of [...history, { now, servers: [server] }]) {
		const node = payload.servers.find((item) => item.id === server.id);
		if (!node || !Number.isFinite(payload.now)) continue;
		samples.set(payload.now, {
			timeStamp: String(payload.now),
			disk:
				node.host.disk_total > 0
					? (node.state.disk_used / node.host.disk_total) * 100
					: 0,
			read: node.state.disk_io_available
				? validRate(node.state.disk_read_speed)
				: null,
			write: node.state.disk_io_available
				? validRate(node.state.disk_write_speed)
				: null,
		});
	}
	return [...samples.entries()]
		.sort((a, b) => a[0] - b[0])
		.slice(-30)
		.map(([, point]) => point);
}
export function mergeDiskIOHistory(
	read: MetricDataPoint[],
	write: MetricDataPoint[],
): Point[] {
	const points = new Map<number, Point>();
	for (const [key, values] of [
		["read", read],
		["write", write],
	] as const) {
		for (const value of values) {
			if (!Number.isFinite(value.ts)) continue;
			const point = points.get(value.ts) ?? {
				timeStamp: String(value.ts),
				read: null,
				write: null,
			};
			point[key] = validRate(value.value);
			points.set(value.ts, point);
		}
	}
	return [...points.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, point]) => point);
}

export default function ServerDiskChart({
	now,
	data,
	messageHistory,
	period,
}: {
	now: number;
	data: NezhaServer;
	messageHistory: NezhaWebsocketResponse[];
	period: Period;
}) {
	const { t } = useTranslation();
	// A report, hover, or period update never changes the selected view.
	const [selection, setSelection] = useState({ serverId: data.id, io: false });
	const io = selection.serverId === data.id && selection.io;
	const toggle = () => setSelection({ serverId: data.id, io: !io });
	const realtime = useMemo(
		() => realtimeDiskPoints(messageHistory, data, now),
		[messageHistory, data, now],
	);
	const disk =
		data.host.disk_total > 0
			? (data.state.disk_used / data.host.disk_total) * 100
			: 0;
	const historical = useQuery({
		queryKey: ["disk-chart-history", data.id, period, io ? "io" : "capacity"],
		enabled: period !== "realtime",
		staleTime: 30_000,
		retry: 1,
		queryFn: async () => {
			const metrics = io
				? (["disk_read_speed", "disk_write_speed"] as const)
				: (["disk"] as const);
			const responses = await Promise.all(
				metrics.map((metric) =>
					fetchServerMetrics(data.id, metric, period as MetricPeriod),
				),
			);
			if (responses.some((response) => !response.success || !response.data))
				throw new Error("读取磁盘历史失败");
			return responses.map((response) => response.data.data_points ?? []);
		},
	});
	const points = useMemo<Point[]>(() => {
		if (period === "realtime") return realtime;
		if (!historical.data) return [];
		if (io)
			return mergeDiskIOHistory(historical.data[0], historical.data[1] ?? []);
		return historical.data[0].map((point) => ({
			timeStamp: String(point.ts),
			disk:
				data.host.disk_total > 0
					? (point.value / data.host.disk_total) * 100
					: 0,
		}));
	}, [period, realtime, historical.data, io, data.host.disk_total]);
	const loading = period !== "realtime" && historical.isPending;
	const failed = period !== "realtime" && historical.isError;
	const unavailable =
		io && !points.some((point) => point.read != null || point.write != null);
	const axes = (
		<>
			<CartesianGrid vertical={false} />
			<XAxis
				dataKey="timeStamp"
				tickLine={false}
				axisLine={false}
				tickMargin={8}
				minTickGap={200}
				interval="preserveStartEnd"
				tickFormatter={(value) => formatRelativeTime(value)}
			/>
			<YAxis
				tickLine={false}
				axisLine={false}
				mirror
				tickMargin={-15}
				domain={io ? [0, "auto"] : [0, 100]}
				tickFormatter={(value) =>
					io ? rate(Number(value)).replace(/\s/g, "") : `${value}%`
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
						formatter={(value, name) => (
							<div className="flex flex-1 items-center justify-between gap-2 leading-none">
								<span className="text-muted-foreground">
									{io
										? name === "read"
											? "读取"
											: "写入"
										: t("serverDetailChart.disk")}
								</span>
								<span className="font-medium text-foreground tabular-nums">
									{io ? rate(Number(value)) : `${Number(value).toFixed(1)}%`}
								</span>
							</div>
						)}
					/>
				}
			/>
		</>
	);
	return (
		<Card
			data-disk-mode={io ? "io" : "capacity"}
			className={cn({ "bg-card/70": !!window.CustomBackgroundImage })}
		>
			<CardContent className="px-6 py-3">
				<section className="flex flex-col gap-1">
					<div className="flex min-h-9 items-center justify-between gap-2">
						<DiskModeToggle
							io={io}
							onToggle={toggle}
							capacityLabel={t("serverDetailChart.disk")}
						/>
						{io ? (
							<DiskIORates
								read={
									data.state.disk_io_available
										? rate(validRate(data.state.disk_read_speed) ?? 0)
										: "—"
								}
								write={
									data.state.disk_io_available
										? rate(validRate(data.state.disk_write_speed) ?? 0)
										: "—"
								}
							/>
						) : (
							<section className="flex flex-col items-end gap-0.5">
								<section className="flex items-center gap-2">
									<p className="text-xs text-end w-10 font-medium">
										{disk.toFixed(0)}%
									</p>
									<AnimatedCircularProgressBar
										className="size-3 text-[0px]"
										max={100}
										min={0}
										value={disk}
										primaryColor="hsl(var(--chart-5))"
									/>
								</section>
								<div className="flex text-[11px] font-medium items-center gap-2">
									{formatBytes(data.state.disk_used)} /{" "}
									{formatBytes(data.host.disk_total)}
								</div>
							</section>
						)}
					</div>
					<div
						key={io ? "io" : "capacity"}
						className="animate-in fade-in duration-200 motion-reduce:animate-none"
					>
						{loading ? (
							<div className="h-[130px]">
								<ChartSkeleton />
							</div>
						) : failed ? (
							<div
								role="status"
								className="flex h-[130px] items-center justify-center text-xs text-muted-foreground"
							>
								读取历史失败，请稍后重试
							</div>
						) : unavailable ? (
							<div
								role="status"
								className="flex h-[130px] items-center justify-center text-xs text-muted-foreground"
							>
								暂无读写数据
							</div>
						) : (
							<ChartContainer
								deferMount
								config={config}
								className="aspect-auto h-[130px] w-full"
							>
								{io ? (
									<LineChart
										syncId="serverDetailCharts"
										accessibilityLayer
										data={points}
										margin={{ top: 12, left: 12, right: 12 }}
									>
										{axes}
										<Line
											isAnimationActive={false}
											dataKey="read"
											name="read"
											type="linear"
											dot={points.length === 1}
											connectNulls={false}
											stroke="hsl(var(--chart-1))"
										/>
										<Line
											isAnimationActive={false}
											dataKey="write"
											name="write"
											type="linear"
											dot={points.length === 1}
											connectNulls={false}
											stroke="hsl(var(--chart-10))"
										/>
									</LineChart>
								) : (
									<AreaChart
										syncId="serverDetailCharts"
										accessibilityLayer
										data={points}
										margin={{ top: 12, left: 12, right: 12 }}
									>
										{axes}
										<Area
											isAnimationActive={false}
											dataKey="disk"
											type="step"
											fill="hsl(var(--chart-5))"
											fillOpacity={0.3}
											stroke="hsl(var(--chart-5))"
										/>
									</AreaChart>
								)}
							</ChartContainer>
						)}
					</div>
				</section>
			</CardContent>
		</Card>
	);
}
