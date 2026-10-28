import NetworkInterfaceSelect from "./NetworkInterfaceSelect";
import {networkInterfaceMetric, networkRate, networkRateHistory, networkHistoricalPoints} from "@/lib/network-interface-rates";
import OnlineHistoryPanel from "./OnlineHistoryPanel";
import { metricTimeAxis, metricTimeWindow } from "@/lib/metric-time-window";
import RealtimeViewMenu from "./RealtimeViewMenu";
import MetricTimeTick from "@/components/MetricTimeTick";
import ChartDetailButton from "@/components/ChartDetail";
import { useMetricHistory } from "@/hooks/use-metric-history";
import { HistoryError } from "./HistoryError";
import { IsolatedChildren } from "./LocalErrorBoundary";
import { useLoginUser } from "@/hooks/use-login-user";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { NetworkRateContext } from "@/context/network-rate-context";
import { useFeature } from "@/appearance/context";
import { formatSpeed } from "@/appearance/widgets";
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
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveIndicator } from "@/hooks/use-active-indicator";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { formatBytes } from "@/lib/format";
import {
	fetchServerMetrics,
	fetchSetting,
} from "@/lib/nezha-api";
import {
	cn,
	formatNezhaInfo,
	formatRelativeTime,
	formatTime,
} from "@/lib/utils";
import type {
	MetricPeriod,
	NezhaServer,
	NezhaGPUStat,
	NezhaWebsocketResponse,
} from "@/types/nezha-api";

import ChartSkeleton from "./loading/ChartSkeleton";
import DiskChart from "./ServerDiskChart";
import GpuMemorySummary from "./GpuMemorySummary";
import HardwareMetricCard from "./HardwareMetricCard";
import { ServerDetailChartLoading } from "./loading/ServerDetailLoading";
import AnimatedCircularProgressBar from "./ui/animated-circular-progress-bar";

type ChartPeriod = "realtime" | MetricPeriod;

type gpuChartData = {
	timeStamp: string;
	gpu: number;
};

type cpuChartData = {
	timeStamp: string;
	cpu: number;
};

type processChartData = {
	timeStamp: string;
	process: number;
};

type memChartData = {
	timeStamp: string;
	mem: number;
	swap: number;
};


type connectChartData = {
	timeStamp: string;
	tcp: number;
	udp: number;
};

const formatCardBits = (bytes: number) => formatSpeed(bytes, true);

export function PeriodSelector({
	selectedPeriod,
	onPeriodChange,
	isLogin,
	isTsdbEnabled,
	offline = false,
 onOnline,
}: {
	selectedPeriod: ChartPeriod;
	onPeriodChange: (period: ChartPeriod) => void;
	isLogin: boolean;
	isTsdbEnabled: boolean;
	offline?: boolean;
 onOnline?: () => void;
}) {
	const { t } = useTranslation();

	const periods = useMemo<{ value: ChartPeriod; label: string }[]>(
		() => [
			{ value: "realtime", label: offline ? "最后状态" : t("serverDetailChart.realtime") },
			{ value: "1d", label: t("serverDetailChart.period1d") },
			{ value: "7d", label: t("serverDetailChart.period7d") },
			{ value: "30d", label: t("serverDetailChart.period30d") },
		],
		[t, offline],
	);
	const periodValues = useMemo(
		() => periods.map((period) => period.value),
		[periods],
	);
	const { containerRef, enableIndicatorAnimation, indicator, setItemRef } =
		useActiveIndicator(periodValues, selectedPeriod);

	return (
		<TooltipProvider delayDuration={120}>
			<div
				ref={containerRef}
                data-metric-period-selector
				className="relative flex gap-0.5 mb-3 flex-wrap sm:-mt-5 -mt-3 p-0.5 bg-muted dark:bg-muted/40 rounded-full w-fit border border-border/60 dark:border-border"
			>
				{indicator && (
					<div
						className="active-indicator-fade-in absolute left-0 top-0 z-10 bg-white dark:bg-background rounded-full ring-1 ring-border/60 dark:ring-border/40"
						style={{
							height: indicator.height,
							transform: `translate(${indicator.x}px, ${indicator.y}px)`,
							transition: indicator.shouldAnimate
								? "transform 0.5s var(--timing), width 0.5s var(--timing), height 0.5s var(--timing)"
								: "none",
							width: indicator.width,
						}}
					/>
				)}
				{periods.map((period, index) => {
					const isHistoryPeriod = period.value !== "realtime";
					const isLockedByTsdb = !isTsdbEnabled && isHistoryPeriod;
					// Only realtime and 1d are available for non-logged-in users
					const isLockedByLogin =
						!isLockedByTsdb &&
						!isLogin &&
						period.value !== "realtime" &&
						period.value !== "1d";
					const isLocked = isLockedByTsdb || isLockedByLogin;

					const periodItem = (
						<button
							type="button"
							ref={setItemRef(index)}
							aria-disabled={isLocked}
							aria-pressed={selectedPeriod === period.value}
							tabIndex={isLocked ? -1 : 0}
							onClick={() => {
								if (!isLocked && !(period.value === "realtime" && onOnline)) {
									if (selectedPeriod !== period.value) {
										enableIndicatorAnimation();
									}
									onPeriodChange(period.value);
								}
							}}
							className={cn(
								"relative cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-300",
								selectedPeriod === period.value
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
								isLocked && "cursor-not-allowed opacity-40 grayscale",
							)}
						>
							<span className="relative z-20 flex items-center gap-1.5">
								{period.value === "realtime" && (
									<span className={cn("inline-flex rounded-full h-1.5 w-1.5", offline ? "bg-red-500" : "bg-emerald-500 dark:bg-emerald-400")}></span>
								)}
								{period.label}
							</span>
						</button>
					);

					if (isLockedByTsdb || isLockedByLogin) {
						return (
							<Tooltip key={period.value}>
								<TooltipTrigger asChild>{periodItem}</TooltipTrigger>
								<TooltipContent>
									{isLockedByTsdb
										? t(
												"serverDetailChart.tsdbRequired",
												"Enable TSDB to use historical data",
											)
										: t(
												"serverDetailChart.loginRequired",
												"Please login to view",
											)}
								</TooltipContent>
							</Tooltip>
						);
					}

					return <div key={period.value} className="flex">{period.value === "realtime" && onOnline ? <RealtimeViewMenu onOnline={onOnline!} offline={offline} onRealtime={() => { if(selectedPeriod !== "realtime") enableIndicatorAnimation(); onPeriodChange("realtime"); }}>{periodItem}</RealtimeViewMenu> : periodItem}</div>;
				})}
			</div>
		</TooltipProvider>
	);
}

export default function ServerDetailChart({
	server_id,
}: {
	server_id: string;
}) {
	const { lastData, connected, messageHistory } = useWebSocketContext();
	const [selectedPeriod, setSelectedPeriod] = useState<ChartPeriod>("realtime");
 const [onlineView, setOnlineView] = useState(false);
 useEffect(() => setOnlineView(false), [server_id]);

	// Check if user is logged in
	const { isLogin } = useLoginUser();

	const { data: settingData } = useQuery({
		queryKey: ["setting"],
		queryFn: () => fetchSetting(),
		refetchOnMount: true,
		refetchOnWindowFocus: true,
	});
	const isTsdbEnabled = settingData?.data?.tsdb_enabled ?? true;

	useEffect(() => {
		if (!isTsdbEnabled && selectedPeriod !== "realtime") {
			setSelectedPeriod("realtime");
		}
	}, [isTsdbEnabled, selectedPeriod]);

	// Reset period if user is not logged in and selected period is restricted
	useEffect(() => {
		if (
			isTsdbEnabled &&
			!isLogin &&
			selectedPeriod !== "realtime" &&
			selectedPeriod !== "1d"
		) {
			setSelectedPeriod("1d");
		}
	}, [isLogin, isTsdbEnabled, selectedPeriod]);

	if (!connected && !lastData) {
		return <ServerDetailChartLoading />;
	}

	const nezhaWsData = lastData;

	if (!nezhaWsData) {
		return <ServerDetailChartLoading />;
	}

	const server = nezhaWsData.servers.find((s) => s.id === Number(server_id));

	if (!server) {
		return <ServerDetailChartLoading />;
	}

	const gpuStats = server.state.gpu || [];
	const gpuList = server.host.gpu || [];
	const gpuDetails = server.state.gpus || [];

	const activePeriod = !isTsdbEnabled ? "realtime" : !isLogin && selectedPeriod !== "realtime" ? "1d" : selectedPeriod;
	if (onlineView) return <OnlineHistoryPanel serverId={server_id} onRealtime={() => { setOnlineView(false); setSelectedPeriod("realtime"); }}/>;
	return (
		<section className="flex flex-col">
			<PeriodSelector
				selectedPeriod={activePeriod}
    onOnline={() => setOnlineView(true)}
				onPeriodChange={setSelectedPeriod}
				isLogin={isLogin}
				isTsdbEnabled={isTsdbEnabled}
			/>
			<section className="grid md:grid-cols-2 lg:grid-cols-3 grid-cols-1 gap-3 server-charts"><IsolatedChildren resetKey={server_id + ":" + activePeriod}>
    {activePeriod==="realtime"?<HardwareMetricCard id={server.id} now={nezhaWsData.now} state={server.state} history={messageHistory}/>:<CpuChart now={nezhaWsData.now} data={server} messageHistory={messageHistory} period={activePeriod}/>}
    {gpuStats.map((gpu,index)=>{
     const name=gpuDetails[index]?.name || (gpuList.length===gpuStats.length?gpuList[index]:undefined) || "#"+(index+1);
     return activePeriod==="realtime"?<HardwareMetricCard key={gpuDetails[index]?.name??index} id={server.id} now={nezhaWsData.now} state={server.state} index={index} identity={gpuDetails[index]?.name} name={name} history={messageHistory}/>:
      <GpuChart key={index} index={index} id={server.id} now={nezhaWsData.now} gpuStat={gpu} gpuName={name} gpuMemory={gpuDetails[index]} messageHistory={messageHistory} period={activePeriod}/>;
    })}
				<MemChart
					now={nezhaWsData.now}
					data={server}
					messageHistory={messageHistory}
					period={activePeriod}
				/>
				<DiskChart
					now={nezhaWsData.now}
					data={server}
					messageHistory={messageHistory}
					period={activePeriod}
				/>
				<ProcessChart
					now={nezhaWsData.now}
					data={server}
					messageHistory={messageHistory}
					period={activePeriod}
				/>
				<NetworkChart
					now={nezhaWsData.now}
					data={server}
					messageHistory={messageHistory}
					period={activePeriod}
				/>
				<ConnectChart
					now={nezhaWsData.now}
					data={server}
					messageHistory={messageHistory}
					period={activePeriod}
				/>
			</IsolatedChildren>
</section>
		</section>
	);
}

function useHistoricalData<T>(
 serverId: number, metricName: Parameters<typeof fetchServerMetrics>[1], period: ChartPeriod,
 transformData: (timestamp: number, value: number) => T,
) {
 const history = useMetricHistory(serverId, [metricName], period);
 const displayData = (history.series?.[0] ?? []).map(point => transformData(point.ts, point.value));
 return { ...history, displayData };
}

function GpuChart({
	now,
	id,
	index,
	gpuStat,
	gpuName,
	gpuMemory,
	messageHistory,
	period,
}: {
	now: number;
	id: number;
	index: number;
	gpuStat: number;
	gpuName?: string;
	gpuMemory?: NezhaGPUStat;
	messageHistory: NezhaWebsocketResponse[];
	period: ChartPeriod;
}) {
	const [gpuChartData, setGpuChartData] = useState<gpuChartData[]>([]);
	const hasInitialized = useRef(false);
	const [historyLoaded, setHistoryLoaded] = useState(false);

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	const transformGpuData = useMemo(
		() => (timestamp: number, value: number) => ({
			timeStamp: timestamp.toString(),
			gpu: value,
		}),
		[],
	);

	const { displayData: gpuHistoricalData, isLoading, error, retry } =
		useHistoricalData<gpuChartData>(id, "gpu", period, transformGpuData);

	// 初始化历史数据
	useEffect(() => {
		if (
			period === "realtime" &&
			!hasInitialized.current &&
			messageHistory.length > 0
		) {
			const historyData = messageHistory
				.map((wsData) => {
					const server = wsData.servers.find((s) => s.id === id);
					if (!server) return null;
					const { gpu } = formatNezhaInfo(wsData.now, server);
					return {
						timeStamp: wsData.now.toString(),
						gpu: gpu[index],
					};
				})
				.filter((item): item is gpuChartData => item !== null)
				.reverse();

			setGpuChartData(historyData);
			hasInitialized.current = true;
			setHistoryLoaded(true);
		}
	}, [messageHistory, id, index, period]);

	// Reset when switching to realtime
	useEffect(() => {
		if (period === "realtime") {
			hasInitialized.current = false;
			setHistoryLoaded(false);
		}
	}, [period]);

	useEffect(() => {
		if (gpuStat && historyLoaded && period === "realtime") {
			const timestamp = Date.now().toString();
			setGpuChartData((prevData) => {
				let newData = [] as gpuChartData[];
				if (prevData.length === 0) {
					newData = [
						{ timeStamp: timestamp, gpu: gpuStat },
						{ timeStamp: timestamp, gpu: gpuStat },
					];
				} else {
					newData = [...prevData, { timeStamp: timestamp, gpu: gpuStat }];
					if (newData.length > 30) {
						newData.shift();
					}
				}
				return newData;
			});
		}
	}, [gpuStat, historyLoaded, period]);

	const chartConfig = {
		gpu: {
			label: "GPU",
		},
	} satisfies ChartConfig;

	const displayData = period === "realtime" ? gpuChartData : gpuHistoricalData;

	return (
		<Card
			className={cn({
				"bg-card/70": customBackgroundImage,
			})}
		>
			<CardContent className="relative flex h-full flex-col px-6 py-3">
				<section className="flex flex-1 flex-col gap-1">
					<div className="flex min-w-0 items-center justify-between gap-2">
						<section className="flex min-w-0 flex-1 flex-col items-start gap-2">
							{!gpuName && <p className="text-md font-medium">GPU</p>}
							{gpuName && <p className="text-xs mt-1 mb-1.5 break-all">GPU: {gpuName}</p>}
						</section>
						<section className="flex shrink-0 items-center gap-2">
							<p className="text-xs text-end min-w-10 whitespace-nowrap font-medium tabular-nums">
								{gpuStat.toFixed(2)}%
							</p>
							<AnimatedCircularProgressBar
								className="size-3 text-[0px]"
								max={100}
								min={0}
								value={gpuStat}
								primaryColor="hsl(var(--chart-3))"
							/>
						</section>
					</div>
					{/* TSDB stores utilization only, not historical VRAM. */}
					{period === "realtime" && <GpuMemorySummary memory={gpuMemory} />}
					<ChartContainer deferMount
						config={chartConfig}
						className="mt-auto aspect-auto h-[130px] w-full shrink-0"
					>
						{error ? <HistoryError retry={retry} /> : isLoading ? (
							<ChartSkeleton />
						) : (
							<AreaChart
								syncId="serverDetailCharts"
								accessibilityLayer
								data={displayData}
								margin={{
									top: 12,
									left: 12,
									right: 12,
								}}
							>
								<CartesianGrid vertical={false} />
								<XAxis tick={<MetricTimeTick />}
									dataKey="timeStamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={200}
									interval="preserveStartEnd"
									tickFormatter={(value) => formatRelativeTime(value)}
                                {...metricTimeAxis(period,now)}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									mirror={true}
									tickMargin={-15}
									domain={[0, 100]}
									tickFormatter={(value) => `${value}%`}
								/>
								<ChartTooltip
									isAnimationActive={false}
									content={
										<ChartTooltipContent
											indicator="dot"
											labelFormatter={(_, payload) => {
												return formatTime(
													Number(payload[0]?.payload?.timeStamp),
												);
											}}
											formatter={(value) => (
												<div className="flex flex-1 items-center justify-between leading-none">
													<span className="text-muted-foreground">GPU</span>
													<span className="ml-2 font-medium text-foreground tabular-nums">
														{Number(value).toFixed(1)}%
													</span>
												</div>
											)}
										/>
									}
								/>
								<Area
									isAnimationActive={false}
									dataKey="gpu"
									type="step"
									fill="hsl(var(--chart-3))"
									fillOpacity={0.3}
									stroke="hsl(var(--chart-3))"
								/>
							</AreaChart>
						)}
					</ChartContainer>
					<ChartDetailButton timeWindow={metricTimeWindow(period,now)} scopeKey={id+":"+period+":gpu:"+index} title={gpuName ? "GPU "+gpuName : "GPU 使用率"} data={displayData} period={period}
						series={[{key:"gpu",label:"GPU",color:"hsl(var(--chart-3))"}]} formatValue={value => value.toFixed(1)+"%"} disabled={isLoading || !!error}/>
				</section>
			</CardContent>
		</Card>
	);
}

function CpuChart({
	now,
	data,
	messageHistory,
	period,
}: {
	now: number;
	data: NezhaServer;
	messageHistory: NezhaWebsocketResponse[];
	period: ChartPeriod;
}) {
	const [cpuChartData, setCpuChartData] = useState<cpuChartData[]>([]);
	const hasInitialized = useRef(false);
	const [historyLoaded, setHistoryLoaded] = useState(false);

	const { cpu } = formatNezhaInfo(now, data);

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	const transformCpuData = useMemo(
		() => (timestamp: number, value: number) => ({
			timeStamp: timestamp.toString(),
			cpu: value,
		}),
		[],
	);

	const { displayData: cpuHistoricalData, isLoading, error, retry } =
		useHistoricalData<cpuChartData>(data.id, "cpu", period, transformCpuData);

	// 初始化历史数据
	useEffect(() => {
		if (
			period === "realtime" &&
			!hasInitialized.current &&
			messageHistory.length > 0
		) {
			const historyData = messageHistory
				.map((wsData) => {
					const server = wsData.servers.find((s) => s.id === data.id);
					if (!server) return null;
					const { cpu } = formatNezhaInfo(wsData.now, server);
					return {
						timeStamp: wsData.now.toString(),
						cpu: cpu,
					};
				})
				.filter((item): item is cpuChartData => item !== null)
				.reverse();

			setCpuChartData(historyData);
			hasInitialized.current = true;
			setHistoryLoaded(true);
		}
	}, [messageHistory, data.id, period]);

	// Reset when switching to realtime
	useEffect(() => {
		if (period === "realtime") {
			hasInitialized.current = false;
			setHistoryLoaded(false);
		}
	}, [period]);

	// 更新实时数据
	useEffect(() => {
		if (data && historyLoaded && period === "realtime") {
			const timestamp = Date.now().toString();
			setCpuChartData((prevData) => {
				let newData = [] as cpuChartData[];
				if (prevData.length === 0) {
					newData = [
						{ timeStamp: timestamp, cpu: cpu },
						{ timeStamp: timestamp, cpu: cpu },
					];
				} else {
					newData = [...prevData, { timeStamp: timestamp, cpu: cpu }];
					if (newData.length > 30) {
						newData.shift();
					}
				}
				return newData;
			});
		}
	}, [data, historyLoaded, cpu, period]);

	const chartConfig = {
		cpu: {
			label: "CPU",
		},
	} satisfies ChartConfig;

	const displayData = period === "realtime" ? cpuChartData : cpuHistoricalData;

	return (
		<Card
			className={cn({
				"bg-card/70": customBackgroundImage,
			})}
		>
			<CardContent className="relative flex h-full flex-col px-6 py-3">
				<section className="flex flex-1 flex-col gap-1">
					<div className="flex items-center justify-between">
						<p className="text-md font-medium">CPU</p>
						<section className="flex items-center gap-2">
							<p className="text-xs text-end w-10 font-medium">
								{cpu.toFixed(2)}%
							</p>
							<AnimatedCircularProgressBar
								className="size-3 text-[0px]"
								max={100}
								min={0}
								value={cpu}
								primaryColor="hsl(var(--chart-1))"
							/>
						</section>
					</div>
					<ChartContainer deferMount
						config={chartConfig}
						className="mt-auto aspect-auto h-[130px] w-full shrink-0"
					>
						{error ? <HistoryError retry={retry} /> : isLoading ? (
							<ChartSkeleton />
						) : (
							<AreaChart
								syncId="serverDetailCharts"
								accessibilityLayer
								data={displayData}
								margin={{
									top: 12,
									left: 12,
									right: 12,
								}}
							>
								<CartesianGrid vertical={false} />
								<XAxis tick={<MetricTimeTick />}
									dataKey="timeStamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={200}
									interval="preserveStartEnd"
									tickFormatter={(value) => formatRelativeTime(value)}
                                {...metricTimeAxis(period,now)}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									mirror={true}
									tickMargin={-15}
									domain={[0, 100]}
									tickFormatter={(value) => `${value}%`}
								/>
								<ChartTooltip
									isAnimationActive={false}
									content={
										<ChartTooltipContent
											indicator="dot"
											labelFormatter={(_, payload) => {
												return formatTime(
													Number(payload[0]?.payload?.timeStamp),
												);
											}}
											formatter={(value) => (
												<div className="flex flex-1 items-center justify-between leading-none">
													<span className="text-muted-foreground">CPU</span>
													<span className="ml-2 font-medium text-foreground tabular-nums">
														{Number(value).toFixed(1)}%
													</span>
												</div>
											)}
										/>
									}
								/>
								<Area
									isAnimationActive={false}
									dataKey="cpu"
									type="step"
									fill="hsl(var(--chart-1))"
									fillOpacity={0.3}
									stroke="hsl(var(--chart-1))"
								/>
							</AreaChart>
						)}
					</ChartContainer>
					<ChartDetailButton history={{serverId:data.id,metrics:[{metric:"cpu",key:"cpu"}]}} timeWindow={metricTimeWindow(period,now)} scopeKey={data.id+":"+period+":cpu"} title="CPU 使用率" data={displayData} period={period}
						series={[{key:"cpu",label:"CPU",color:"hsl(var(--chart-1))"}]} formatValue={value => value.toFixed(1)+"%"} disabled={isLoading || !!error}/>
				</section>
			</CardContent>
		</Card>
	);
}

function ProcessChart({
	now,
	data,
	messageHistory,
	period,
}: {
	now: number;
	data: NezhaServer;
	messageHistory: NezhaWebsocketResponse[];
	period: ChartPeriod;
}) {
	const { t } = useTranslation();
	const [processChartData, setProcessChartData] = useState(
		[] as processChartData[],
	);
	const hasInitialized = useRef(false);
	const [historyLoaded, setHistoryLoaded] = useState(false);

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	const { process } = formatNezhaInfo(now, data);

	const transformProcessData = useMemo(
		() => (timestamp: number, value: number) => ({
			timeStamp: timestamp.toString(),
			process: value,
		}),
		[],
	);

	const { displayData: processHistoricalData, isLoading, error, retry } =
		useHistoricalData<processChartData>(
			data.id,
			"process_count",
			period,
			transformProcessData,
		);

	// 初始化历史数据
	useEffect(() => {
		if (
			period === "realtime" &&
			!hasInitialized.current &&
			messageHistory.length > 0
		) {
			const historyData = messageHistory
				.map((wsData) => {
					const server = wsData.servers.find((s) => s.id === data.id);
					if (!server) return null;
					const { process } = formatNezhaInfo(wsData.now, server);
					return {
						timeStamp: wsData.now.toString(),
						process,
					};
				})
				.filter((item): item is processChartData => item !== null)
				.reverse();

			setProcessChartData(historyData);
			hasInitialized.current = true;
			setHistoryLoaded(true);
		}
	}, [messageHistory, data.id, period]);

	// Reset when switching to realtime
	useEffect(() => {
		if (period === "realtime") {
			hasInitialized.current = false;
			setHistoryLoaded(false);
		}
	}, [period]);

	// 修改实时数据更新逻辑
	useEffect(() => {
		if (data && historyLoaded && period === "realtime") {
			const timestamp = Date.now().toString();
			setProcessChartData((prevData) => {
				let newData = [] as processChartData[];
				if (prevData.length === 0) {
					newData = [
						{ timeStamp: timestamp, process },
						{ timeStamp: timestamp, process },
					];
				} else {
					newData = [...prevData, { timeStamp: timestamp, process }];
					if (newData.length > 30) {
						newData.shift();
					}
				}
				return newData;
			});
		}
	}, [data, historyLoaded, process, period]);

	const chartConfig = {
		process: {
			label: "Process",
		},
	} satisfies ChartConfig;

	const displayData =
		period === "realtime" ? processChartData : processHistoricalData;

	return (
		<Card
			className={cn({
				"bg-card/70": customBackgroundImage,
			})}
		>
			<CardContent className="relative flex h-full flex-col px-6 py-3">
				<section className="flex flex-1 flex-col gap-1">
					<div className="flex items-center justify-between">
						<p className="text-md font-medium">
							{t("serverDetailChart.process")}
						</p>
						<section className="flex items-center gap-2">
							<p className="text-xs text-end w-10 font-medium">{process}</p>
						</section>
					</div>
					<ChartContainer deferMount
						config={chartConfig}
						className="mt-auto aspect-auto h-[130px] w-full shrink-0"
					>
						{error ? <HistoryError retry={retry} /> : isLoading ? (
							<ChartSkeleton />
						) : (
							<AreaChart
								syncId="serverDetailCharts"
								accessibilityLayer
								data={displayData}
								margin={{
									top: 12,
									left: 12,
									right: 12,
								}}
							>
								<CartesianGrid vertical={false} />
								<XAxis tick={<MetricTimeTick />}
									dataKey="timeStamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={200}
									interval="preserveStartEnd"
									tickFormatter={(value) => formatRelativeTime(value)}
                                {...metricTimeAxis(period,now)}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									mirror={true}
									tickMargin={-15}
								/>
								<ChartTooltip
									isAnimationActive={false}
									content={
										<ChartTooltipContent
											indicator={"dot"}
											labelFormatter={(_, payload) => {
												return formatTime(
													Number(payload[0]?.payload?.timeStamp),
												);
											}}
											formatter={(value) => (
												<div className="flex flex-1 items-center justify-between leading-none">
													<span className="text-muted-foreground">
														{t("serverDetailChart.process")}
													</span>
													<span className="ml-2 font-medium text-foreground tabular-nums">
														{Number(value).toFixed(0)}
													</span>
												</div>
											)}
										/>
									}
								/>
								<Area
									isAnimationActive={false}
									dataKey="process"
									type="step"
									fill="hsl(var(--chart-2))"
									fillOpacity={0.3}
									stroke="hsl(var(--chart-2))"
								/>
							</AreaChart>
						)}
					</ChartContainer>
					<ChartDetailButton history={{serverId:data.id,metrics:[{metric:"process_count",key:"process"}]}} timeWindow={metricTimeWindow(period,now)} scopeKey={data.id+":"+period+":process"} title="进程数" data={displayData} period={period}
						series={[{key:"process",label:"进程数",color:"hsl(var(--chart-2))"}]} formatValue={value => value.toFixed(0)} disabled={isLoading || !!error}/>
				</section>
			</CardContent>
		</Card>
	);
}

function MemChart({
	now,
	data,
	messageHistory,
	period,
}: {
	now: number;
	data: NezhaServer;
	messageHistory: NezhaWebsocketResponse[];
	period: ChartPeriod;
}) {
	const { t } = useTranslation();
	const [memChartData, setMemChartData] = useState([] as memChartData[]);
	const hasInitialized = useRef(false);
	const [historyLoaded, setHistoryLoaded] = useState(false);

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	const { mem, swap } = formatNezhaInfo(now, data);

	const history = useMetricHistory(data.id, ["memory", "swap"], period);
 const swapMap = new Map((history.series?.[1] ?? []).map(point => [point.ts, data.host.swap_total > 0 ? point.value / data.host.swap_total * 100 : 0]));
 const memHistoricalData: memChartData[] = (history.series?.[0] ?? []).map(point => ({timeStamp: String(point.ts), mem: data.host.mem_total > 0 ? point.value / data.host.mem_total * 100 : 0, swap: swapMap.get(point.ts) ?? 0}));


	// 初始化历史数据
	useEffect(() => {
		if (
			period === "realtime" &&
			!hasInitialized.current &&
			messageHistory.length > 0
		) {
			const historyData = messageHistory
				.map((wsData) => {
					const server = wsData.servers.find((s) => s.id === data.id);
					if (!server) return null;
					const { mem, swap } = formatNezhaInfo(wsData.now, server);
					return {
						timeStamp: wsData.now.toString(),
						mem,
						swap,
					};
				})
				.filter((item): item is memChartData => item !== null)
				.reverse();

			setMemChartData(historyData);
			hasInitialized.current = true;
			setHistoryLoaded(true);
		}
	}, [messageHistory, data.id, period]);

	// Reset when switching to realtime
	useEffect(() => {
		if (period === "realtime") {
			hasInitialized.current = false;
			setHistoryLoaded(false);
		}
	}, [period]);

	// 修改实时数据更新逻辑
	useEffect(() => {
		if (data && historyLoaded && period === "realtime") {
			const timestamp = Date.now().toString();
			setMemChartData((prevData) => {
				let newData = [] as memChartData[];
				if (prevData.length === 0) {
					newData = [
						{ timeStamp: timestamp, mem, swap },
						{ timeStamp: timestamp, mem, swap },
					];
				} else {
					newData = [...prevData, { timeStamp: timestamp, mem, swap }];
					if (newData.length > 30) {
						newData.shift();
					}
				}
				return newData;
			});
		}
	}, [data, historyLoaded, mem, swap, period]);

	const chartConfig = {
		mem: {
			label: "Mem",
		},
		swap: {
			label: "Swap",
		},
	} satisfies ChartConfig;

	const displayData = period === "realtime" ? memChartData : memHistoricalData;
	const isMemLoading = history.isLoading;

	return (
		<Card
			className={cn({
				"bg-card/70": customBackgroundImage,
			})}
		>
			<CardContent className="relative flex h-full flex-col px-6 py-3">
				<section className="flex flex-1 flex-col gap-1">
					<div className="flex items-center justify-between">
						<section className="flex items-center gap-4">
							<div className="flex flex-col">
								<p className=" text-xs text-muted-foreground">
									{t("serverDetailChart.mem")}
								</p>
								<div className="flex items-center gap-2">
									<AnimatedCircularProgressBar
										className="size-3 text-[0px]"
										max={100}
										min={0}
										value={mem}
										primaryColor="hsl(var(--chart-8))"
									/>
									<p className="text-xs font-medium">{mem.toFixed(0)}%</p>
								</div>
							</div>
							<div className="flex flex-col">
								<p className=" text-xs text-muted-foreground">
									{t("serverDetailChart.swap")}
								</p>
								<div className="flex items-center gap-2">
									<AnimatedCircularProgressBar
										className="size-3 text-[0px]"
										max={100}
										min={0}
										value={swap}
										primaryColor="hsl(var(--chart-10))"
									/>
									<p className="text-xs font-medium">{swap.toFixed(0)}%</p>
								</div>
							</div>
						</section>
						<section className="flex flex-col items-end gap-0.5">
							<div className="flex text-[11px] font-medium items-center gap-2">
								{formatBytes(data.state.mem_used)} /{" "}
								{formatBytes(data.host.mem_total)}
							</div>
							<div className="flex text-[11px] font-medium items-center gap-2">
								{data.host.swap_total ? (
									<>
										swap: {formatBytes(data.state.swap_used)} /{" "}
										{formatBytes(data.host.swap_total)}
									</>
								) : (
									<>no swap</>
								)}
							</div>
						</section>
					</div>
					<ChartContainer deferMount
						config={chartConfig}
						className="mt-auto aspect-auto h-[130px] w-full shrink-0"
					>
						{history.error ? <HistoryError retry={history.retry} /> : isMemLoading ? (
							<ChartSkeleton />
						) : (
							<AreaChart
								syncId="serverDetailCharts"
								accessibilityLayer
								data={displayData}
								margin={{
									top: 12,
									left: 12,
									right: 12,
								}}
							>
								<CartesianGrid vertical={false} />
								<XAxis tick={<MetricTimeTick />}
									dataKey="timeStamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={200}
									interval="preserveStartEnd"
									tickFormatter={(value) => formatRelativeTime(value)}
                                {...metricTimeAxis(period,now)}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									mirror={true}
									tickMargin={-15}
									domain={[0, 100]}
									tickFormatter={(value) => `${value}%`}
								/>
								<ChartTooltip
									isAnimationActive={false}
									content={
										<ChartTooltipContent
											indicator="dot"
											labelFormatter={(_, payload) => {
												return formatTime(
													Number(payload[0]?.payload?.timeStamp),
												);
											}}
											formatter={(value, name) => {
												const label =
													name === "mem"
														? t("serverDetailChart.mem")
														: t("serverDetailChart.swap");
												return (
													<div className="flex flex-1 items-center justify-between leading-none">
														<span className="text-muted-foreground">
															{label}
														</span>
														<span className="ml-2 font-medium text-foreground tabular-nums">
															{Number(value).toFixed(1)}%
														</span>
													</div>
												);
											}}
										/>
									}
								/>
								<Area
									isAnimationActive={false}
									dataKey="mem"
									type="step"
									fill="hsl(var(--chart-8))"
									fillOpacity={0.3}
									stroke="hsl(var(--chart-8))"
								/>
								<Area
									isAnimationActive={false}
									dataKey="swap"
									type="step"
									fill="hsl(var(--chart-10))"
									fillOpacity={0.3}
									stroke="hsl(var(--chart-10))"
								/>
							</AreaChart>
						)}
					</ChartContainer>
					<ChartDetailButton history={{serverId:data.id,metrics:[{metric:"memory",key:"mem",scale:data.host.mem_total>0?100/data.host.mem_total:0},{metric:"swap",key:"swap",scale:data.host.swap_total>0?100/data.host.swap_total:0}]}} timeWindow={metricTimeWindow(period,now)} scopeKey={data.id+":"+period+":memory"} title="内存" data={displayData} period={period}
						series={[{key:"mem",label:"内存",color:"hsl(var(--chart-8))"},{key:"swap",label:"虚拟内存",color:"hsl(var(--chart-10))"}]} formatValue={value => value.toFixed(1)+"%"} disabled={isMemLoading || !!history.error}/>
				</section>
			</CardContent>
		</Card>
	);
}

function NetworkChart({
	now,
	data,
	messageHistory,
	period,
}: {
	now: number;
	data: NezhaServer;
	messageHistory: NezhaWebsocketResponse[];
	period: ChartPeriod;
}) {
	const { t } = useTranslation();
	const themeRateFormatter = useContext(NetworkRateContext);
	const speed = useFeature("speed");
	const rateFormatter = themeRateFormatter ?? (speed.enabled && speed.cardEnabled && speed.bits ? formatCardBits : null);
 const {isAdmin}=useLoginUser();
 const [chosen,setChosen]=useState("");
 const selected=isAdmin?chosen:"";
 useEffect(()=>setChosen(""),[data.id,isAdmin]);
 const names=(data.state.network_interfaces??[]).map(n=>n.name);
 const metrics=[networkInterfaceMetric(selected,"out"),networkInterfaceMetric(selected,"in")];
 const history=useMetricHistory(data.id,metrics,period);
 const rates=networkRate(data,selected);
 const {up,down}=formatNezhaInfo(now,data);
 const displayData=period==="realtime"
  ?networkRateHistory(messageHistory,data,now,selected)
  :networkHistoricalPoints(history.series,period==="7d"?1800000:period==="30d"?7200000:30000);
 const isNetworkLoading=history.isLoading;
 const selection=isAdmin&&(names.length>0||!!selected)?{
  value:selected,names,pending:history.isLoading,
  message:history.error?"记录读取失败，请重新选择网卡重试。":undefined,
  onChange:(name:string)=>{if(name===selected)history.retry();else setChosen(name);}
 }:undefined;
 const formatCurrent=(value:number|null,fallback:number)=>{
  if(value===null)return "—";
  if(rateFormatter)return rateFormatter(value);
  const speed=selected?value/1024**2:fallback;
  return speed>=1024?(speed/1024).toFixed(2)+"G/s":speed>=1?speed.toFixed(2)+"M/s":(speed*1024).toFixed(2)+"K/s";
 };
 const customBackgroundImage=(window.CustomBackgroundImage as string)!==""?window.CustomBackgroundImage:undefined;
 const values=displayData.flatMap(p=>[p.upload,p.download]).filter((v):v is number=>v!==null&&Number.isFinite(v));
 const maxDownload=Math.max(1,Math.ceil(Math.max(0,...values)));

	const chartConfig = {
		upload: {
			label: "Upload",
		},
		download: {
			label: "Download",
		},
	} satisfies ChartConfig;

	return (
		<Card
			className={cn({
				"bg-card/70": customBackgroundImage,
			})}
		>
			<CardContent className="relative flex h-full flex-col px-6 py-3">
				<section className="flex flex-1 flex-col gap-1">
					<div className="flex min-w-0 items-center gap-1">
						<section className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-4">
							<div className="flex min-w-[4.25rem] flex-col sm:min-w-20">
								<p className="text-xs text-muted-foreground">
									{t("serverDetailChart.upload")}
								</p>
								<div className="flex items-center gap-1">
									<span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-1))]" />
									<p data-network-rate className="whitespace-nowrap text-xs font-medium tabular-nums">
										{formatCurrent(rates.upload,up)}
</p>
								</div>
							</div>
							<div className="flex min-w-[4.25rem] flex-col sm:min-w-20">
								<p className=" text-xs text-muted-foreground">
									{t("serverDetailChart.download")}
								</p>
								<div className="flex items-center gap-1">
									<span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-4))]" />
									<p data-network-rate className="whitespace-nowrap text-xs font-medium tabular-nums">
										{formatCurrent(rates.download,down)}
</p>
								</div>
							</div>
						</section>
 {selection&&<NetworkInterfaceSelect selection={selection}/>}
					</div>
					<ChartContainer deferMount
						config={chartConfig}
						className="mt-auto aspect-auto h-[130px] w-full shrink-0"
					>
						{history.error ? <HistoryError retry={history.retry} /> : isNetworkLoading ? (
							<ChartSkeleton />
						) : (
							<LineChart
								syncId="serverDetailCharts"
								accessibilityLayer
								data={displayData}
								margin={{
									top: 12,
									left: 12,
									right: 12,
								}}
							>
								<CartesianGrid vertical={false} />
								<XAxis tick={<MetricTimeTick />}
									dataKey="timeStamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={200}
									interval="preserveStartEnd"
									tickFormatter={(value) => formatRelativeTime(value)}
                                {...metricTimeAxis(period,now)}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									mirror={true}
									tickMargin={-15}
									type="number"
									minTickGap={50}
									interval="preserveStartEnd"
									width={rateFormatter ? 100 : undefined}
                                    tick={rateFormatter ? {fontSize: 11} : undefined}
                                    domain={[0, maxDownload]}
									tickFormatter={(value) => rateFormatter ? rateFormatter(Number(value) * 1024 ** 2) : `${value.toFixed(0)}M/s`}
								/>
								<ChartTooltip
									isAnimationActive={false}
									content={
										<ChartTooltipContent
											indicator="dot"
											labelFormatter={(_, payload) => {
												return formatTime(
													Number(payload[0]?.payload?.timeStamp),
												);
											}}
											formatter={(value, name) => {
												const label =
													name === "upload"
														? t("serverDetailChart.upload")
														: t("serverDetailChart.download");
												return (
													<div className="flex flex-1 items-center justify-between leading-none">
														<span className="text-muted-foreground">
															{label}
														</span>
														<span className="ml-2 font-medium text-foreground tabular-nums">
															{rateFormatter ? rateFormatter(Number(value) * 1024 ** 2) : `${Number(value).toFixed(2)} MB/s`}
														</span>
													</div>
												);
											}}
										/>
									}
								/>
								<Line
									isAnimationActive={false}
									dataKey="upload"
									type="linear"
									stroke="hsl(var(--chart-1))"
									strokeWidth={1}
									dot={false}
								/>
								<Line
									isAnimationActive={false}
									dataKey="download"
									type="linear"
									stroke="hsl(var(--chart-4))"
									strokeWidth={1}
									dot={false}
								/>
							</LineChart>
						)}
					</ChartContainer>
					<ChartDetailButton selection={selection} history={{serverId:data.id,metrics:[{metric:metrics[0],key:"upload",scale:1/1024**2},{metric:metrics[1],key:"download",scale:1/1024**2}]}} timeWindow={metricTimeWindow(period,now)} scopeKey={data.id+":"+period+":network:"+isAdmin} title="网络速率" data={displayData} period={period}
						series={[{key:"upload",label:"上传",color:"hsl(var(--chart-1))"},{key:"download",label:"下载",color:"hsl(var(--chart-4))"}]} formatValue={value => rateFormatter ? rateFormatter(value * 1024 ** 2) : value.toFixed(2)+" MB/s"} disabled={isNetworkLoading || !!history.error}/>
				</section>
			</CardContent>
		</Card>
	);
}

function ConnectChart({
	now,
	data,
	messageHistory,
	period,
}: {
	now: number;
	data: NezhaServer;
	messageHistory: NezhaWebsocketResponse[];
	period: ChartPeriod;
}) {
	const [connectChartData, setConnectChartData] = useState(
		[] as connectChartData[],
	);
	const hasInitialized = useRef(false);
	const [historyLoaded, setHistoryLoaded] = useState(false);

	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	const { tcp, udp } = formatNezhaInfo(now, data);

	const history = useMetricHistory(data.id, ["tcp_conn", "udp_conn"], period);
 const udpMap = new Map((history.series?.[1] ?? []).map(point => [point.ts, point.value]));
 const connectHistoricalData: connectChartData[] = (history.series?.[0] ?? []).map(point => ({timeStamp: String(point.ts), tcp: point.value, udp: udpMap.get(point.ts) ?? 0}));


	// 初始化历史数据
	useEffect(() => {
		if (
			period === "realtime" &&
			!hasInitialized.current &&
			messageHistory.length > 0
		) {
			const historyData = messageHistory
				.map((wsData) => {
					const server = wsData.servers.find((s) => s.id === data.id);
					if (!server) return null;
					const { tcp, udp } = formatNezhaInfo(wsData.now, server);
					return {
						timeStamp: wsData.now.toString(),
						tcp,
						udp,
					};
				})
				.filter((item): item is connectChartData => item !== null)
				.reverse();

			setConnectChartData(historyData);
			hasInitialized.current = true;
			setHistoryLoaded(true);
		}
	}, [messageHistory, data.id, period]);

	// Reset when switching to realtime
	useEffect(() => {
		if (period === "realtime") {
			hasInitialized.current = false;
			setHistoryLoaded(false);
		}
	}, [period]);

	// 修改实时数据更新逻辑
	useEffect(() => {
		if (data && historyLoaded && period === "realtime") {
			const timestamp = Date.now().toString();
			setConnectChartData((prevData) => {
				let newData = [] as connectChartData[];
				if (prevData.length === 0) {
					newData = [
						{ timeStamp: timestamp, tcp, udp },
						{ timeStamp: timestamp, tcp, udp },
					];
				} else {
					newData = [...prevData, { timeStamp: timestamp, tcp, udp }];
					if (newData.length > 30) {
						newData.shift();
					}
				}
				return newData;
			});
		}
	}, [data, historyLoaded, tcp, udp, period]);

	const chartConfig = {
		tcp: {
			label: "TCP",
		},
		udp: {
			label: "UDP",
		},
	} satisfies ChartConfig;

	const displayData =
		period === "realtime" ? connectChartData : connectHistoricalData;
	const isConnectLoading = history.isLoading;

	return (
		<Card
			className={cn({
				"bg-card/70": customBackgroundImage,
			})}
		>
			<CardContent className="relative flex h-full flex-col px-6 py-3">
				<section className="flex flex-1 flex-col gap-1">
					<div className="flex items-center">
						<section className="flex items-center gap-4">
							<div className="flex flex-col w-12">
								<p className="text-xs text-muted-foreground">TCP</p>
								<div className="flex items-center gap-1">
									<span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-1))]" />
									<p className="text-xs font-medium">{tcp}</p>
								</div>
							</div>
							<div className="flex flex-col w-12">
								<p className=" text-xs text-muted-foreground">UDP</p>
								<div className="flex items-center gap-1">
									<span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-4))]" />
									<p className="text-xs font-medium">{udp}</p>
								</div>
							</div>
						</section>
					</div>
					<ChartContainer deferMount
						config={chartConfig}
						className="mt-auto aspect-auto h-[130px] w-full shrink-0"
					>
						{history.error ? <HistoryError retry={history.retry} /> : isConnectLoading ? (
							<ChartSkeleton />
						) : (
							<LineChart
								syncId="serverDetailCharts"
								accessibilityLayer
								data={displayData}
								margin={{
									top: 12,
									left: 12,
									right: 12,
								}}
							>
								<CartesianGrid vertical={false} />
								<XAxis tick={<MetricTimeTick />}
									dataKey="timeStamp"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={200}
									interval="preserveStartEnd"
									tickFormatter={(value) => formatRelativeTime(value)}
                                {...metricTimeAxis(period,now)}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									mirror={true}
									tickMargin={-15}
									type="number"
									interval="preserveStartEnd"
								/>
								<ChartTooltip
									isAnimationActive={false}
									content={
										<ChartTooltipContent
											indicator="dot"
											labelFormatter={(_, payload) => {
												return formatTime(
													Number(payload[0]?.payload?.timeStamp),
												);
											}}
											formatter={(value, name) => {
												const label = name === "tcp" ? "TCP" : "UDP";
												return (
													<div className="flex flex-1 items-center justify-between leading-none">
														<span className="text-muted-foreground">
															{label}
														</span>
														<span className="ml-2 font-medium text-foreground tabular-nums">
															{Number(value).toFixed(0)}
														</span>
													</div>
												);
											}}
										/>
									}
								/>
								<Line
									isAnimationActive={false}
									dataKey="tcp"
									type="linear"
									stroke="hsl(var(--chart-1))"
									strokeWidth={1}
									dot={false}
								/>
								<Line
									isAnimationActive={false}
									dataKey="udp"
									type="linear"
									stroke="hsl(var(--chart-4))"
									strokeWidth={1}
									dot={false}
								/>
							</LineChart>
						)}
					</ChartContainer>
					<ChartDetailButton history={{serverId:data.id,metrics:[{metric:"tcp_conn",key:"tcp"},{metric:"udp_conn",key:"udp"}]}} timeWindow={metricTimeWindow(period,now)} scopeKey={data.id+":"+period+":connections"} title="连接数" data={displayData} period={period}
						series={[{key:"tcp",label:"TCP",color:"hsl(var(--chart-1))"},{key:"udp",label:"UDP",color:"hsl(var(--chart-4))"}]} formatValue={value => value.toFixed(0)} disabled={isConnectLoading || !!history.error}/>
				</section>
			</CardContent>
		</Card>
	);
}
