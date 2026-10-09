import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowRight,
	ChevronDown,
	LoaderCircle,
	RefreshCw,
	Route,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { insightQueryOptions } from "@/lib/detail-result-query";
import { formatDetectionTime } from "@/lib/detection-time";
import {
	insightRequest,
	type ReturnResult,
	type ReturnSelection,
} from "@/lib/network-insight-api";
import { fetchLoginUser } from "@/lib/nezha-api";
import {
	finalReturnRTT,
	returnHopRows,
	returnQuality,
	returnQualityHelp,
	returnStages,
	returnStatusText,
} from "@/lib/return-route-view";
import { cn } from "@/lib/utils";
import ReturnRouteCompare from "./ReturnRouteCompare";
import SnapshotTimeline from "./SnapshotTimeline";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog";

const ReturnRouteMap = lazy(() => import("./ReturnRouteMap"));
const statuses = returnStatusText;
function RouteCard({
	result: r,
	onRetest,
	busy,
	online,
	error,
	mixed,
}: {
	result: ReturnResult;
	onRetest?: (selection: ReturnSelection) => void;
	busy: boolean;
	online: boolean;
	error?: string;
	mixed?: boolean;
}) {
	const [compact, setCompact] = useState(true);
	const [mapView, setMapView] = useState(false);
	const hops = r.hops || [],
		labels = r.route || [],
		finalRTT = finalReturnRTT(r);
	return (
		<article
			className="min-w-0 rounded-xl border bg-background/50"
			data-return-route={r.id + "-" + r.family}
		>
			<Dialog
				onOpenChange={(open) => {
					if (!open) setMapView(false);
				}}
			>
				<DialogTrigger asChild>
					<button
						type="button"
						className="w-full rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-primary"
						aria-label={"查看" + r.name + r.carrier + "逐跳路由"}
					>
						<span className="flex items-center justify-between gap-2">
							<span className="min-w-0 break-words font-medium">
								{r.name} · {r.carrier}
							</span>
							<span className="flex shrink-0 items-center gap-1.5 text-xs">
								<span
									className={cn(
										r.status === "reached"
											? "text-emerald-700 dark:text-emerald-400"
											: r.status === "partial"
												? "text-amber-700 dark:text-amber-400"
												: "text-muted-foreground",
									)}
								>
									{statuses[r.status] || "暂无结果"}
								</span>
								<ChevronDown className="size-4" />
							</span>
						</span>
						{(r.line || finalRTT !== undefined) && (
							<span className="mt-2 flex items-start justify-between gap-2 text-xs">
								<span className="min-w-0 font-medium" data-route-line>
									{r.line}
								</span>
								{finalRTT !== undefined && (
									<span
										className="shrink-0 tabular-nums"
										data-final-rtt
										title={"最终回程延迟 " + finalRTT.toFixed(1) + " 毫秒"}
									>
										{finalRTT.toFixed(1)} ms
									</span>
								)}
							</span>
						)}
						<span
							className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-muted-foreground"
							data-return-summary
						>
							{labels.length ? (
								labels.map((label, i) => (
									<span
										key={i + label}
										className="inline-flex items-center gap-1.5"
									>
										{i > 0 && (
											<ArrowRight className="size-3 shrink-0 opacity-60" />
										)}
										<span>{label}</span>
									</span>
								))
							) : (
								<span>
									{r.status === "pending"
										? "等待路由信息"
										: hops.some((h) => h.samples > 0)
											? "线路暂无法识别"
											: "暂无路由信息"}
								</span>
							)}
						</span>
						<span className="mt-2 block text-[11px] text-muted-foreground">
							{r.protocol.toUpperCase()} ·{" "}
							{hops.length ? Math.max(...hops.map((h) => h.ttl)) + " 跳" : "—"}{" "}
							· 查看逐跳详情
						</span>
						{mixed && r.tested_at && (
							<span className="mt-1 block text-[10px] text-muted-foreground">
								本项：{formatDetectionTime(r.tested_at, true)}
							</span>
						)}
					</button>
				</DialogTrigger>
				<DialogContent
					className="z-[10001] grid max-h-[85dvh] w-[calc(100%_-_1.5rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-2xl bg-card/95 p-4 text-card-foreground backdrop-blur-xl sm:p-5"
					overlayClassName="z-[10000] bg-black/45 backdrop-blur-sm"
				>
					<DialogHeader className="pr-6 text-left">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 flex-1 space-y-1.5">
								<DialogTitle className="text-base">
									{r.name} · {r.carrier} 回程详情
								</DialogTitle>
								<DialogDescription className="text-xs">
									{r.family} · {r.protocol.toUpperCase()} ·{" "}
									{statuses[r.status] || "暂无结果"}
									{r.line ? " · " + r.line : ""}
								</DialogDescription>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<div
									className="inline-flex rounded-full border bg-muted/40 p-0.5"
									aria-label="回程查看方式"
								>
									{[false, true].map((map) => (
										<button
											key={String(map)}
											type="button"
											aria-pressed={mapView === map}
											className={cn(
												"min-h-9 rounded-full px-3 text-xs transition-colors",
												mapView === map && "bg-background shadow-sm",
											)}
											onClick={() => setMapView(map)}
										>
											{map ? "地图" : "逐跳"}
										</button>
									))}
								</div>
								{onRetest && (
									<Button
										variant="outline"
										size="sm"
										className="shrink-0 gap-1.5"
										disabled={busy || !online}
										onClick={() => onRetest({ id: r.id, family: r.family })}
										aria-label={"单独检测" + r.name + r.carrier}
									>
										<RefreshCw
											className={cn("size-3.5", busy && "animate-spin")}
										/>
										{busy ? "检测中…" : "单独检测"}
									</Button>
								)}
							</div>
						</div>
						{onRetest && (
							<p className="text-[11px] text-muted-foreground">
								{!online
									? "节点离线，暂不能检测"
									: busy
										? "该节点已有检测任务，完成后可再次单独检测。"
										: "仅重测当前目标与协议族；使用后台当前配置，其他线路保持不变。"}
							</p>
						)}
						{!!r.tested_at && (
							<p className="text-[11px] text-muted-foreground">
								本项检测时间：{formatDetectionTime(r.tested_at, true)}
								（北京时间）
							</p>
						)}
						{error && (
							<p role="alert" className="text-xs text-destructive">
								{error}
							</p>
						)}
					</DialogHeader>
					<section
						className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
						data-return-hop-scroll
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus and scroll the bounded hop region.
						tabIndex={0}
						aria-label={mapView ? "回程地图滚动区域" : "逐跳详情滚动区域"}
					>
						<div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-xs">
							<span className="min-w-0 break-all text-muted-foreground">
								{r.target ? "目标：" + r.target : "节点及接入商地址已隐藏"}
							</span>
							{!mapView && (
								<button
									type="button"
									className="shrink-0 rounded-md border px-2 py-1.5"
									aria-pressed={!compact}
									onClick={() => setCompact(!compact)}
								>
									{compact ? "逐跳显示未响应" : "合并未响应跳"}
								</button>
							)}
						</div>
						{!!r.evidence?.length && (
							<details className="mb-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
								<summary className="cursor-pointer">线路判断依据</summary>
								<ul className="mt-2 space-y-1 text-muted-foreground">
									{r.evidence.map((e) => (
										<li key={e}>{e}</li>
									))}
								</ul>
							</details>
						)}
						{mapView ? (
							<Suspense
								fallback={
									<p
										role="status"
										className="py-8 text-center text-sm text-muted-foreground"
									>
										正在加载地图…
									</p>
								}
							>
								<ReturnRouteMap hops={hops} />
							</Suspense>
						) : hops.length ? (
							<ol
								aria-label={r.name + r.carrier + "逐跳路由"}
								className="space-y-0.5"
							>
								{returnHopRows(hops, compact).map(({ hop, end }, i) => {
									const stage = returnStages[hop.stage || ""],
										quality = returnQuality(hop);
									return (
										<li
											key={hop.ttl + ":" + i}
											className="grid grid-cols-[2rem_minmax(0,1fr)_4.2rem] items-start gap-2 rounded-lg px-1 py-2 text-xs even:bg-muted/30"
										>
											<span className="pt-0.5 text-center tabular-nums text-muted-foreground">
												{end === hop.ttl ? hop.ttl : hop.ttl + "–" + end}
											</span>
											<div className="min-w-0 space-y-1 break-words">
												{!hop.samples ? (
													<span className="text-muted-foreground">
														{end === hop.ttl
															? "未响应"
															: end - hop.ttl + 1 + " 跳未响应"}
													</span>
												) : (
													<>
														<div className="flex flex-wrap items-center gap-1.5">
															<span className="font-medium">
																{hop.asn ? "AS" + hop.asn : "未识别 ASN"}
															</span>
															{stage && (
																<span
																	className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px]"
																	title={stage.help}
																>
																	{stage.text}
																</span>
															)}
															{quality && (
																<span
																	data-route-quality
																	className={cn(
																		"rounded px-1.5 py-0.5 text-[10px]",
																		quality === "优质线路"
																			? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
																			: "bg-muted text-muted-foreground",
																	)}
																	title={returnQualityHelp}
																>
																	{quality}
																</span>
															)}
														</div>
														{hop.network && (
															<p className="text-muted-foreground">
																{hop.network}
															</p>
														)}
														{hop.ip ? (
															<p className="break-all font-mono text-muted-foreground">
																{hop.ip}
															</p>
														) : hop.ip_hidden ? (
															<p className="text-muted-foreground">
																地址已隐藏
															</p>
														) : null}
														{(hop.location || hop.organization) && (
															<p className="text-muted-foreground">
																{[hop.location, hop.organization]
																	.filter(Boolean)
																	.join(" · ")}
															</p>
														)}
													</>
												)}
											</div>
											<span className="pt-0.5 text-right tabular-nums whitespace-nowrap">
												{hop.rtt_ms === undefined
													? "—"
													: hop.rtt_ms.toFixed(1) + " ms"}
											</span>
										</li>
									);
								})}
							</ol>
						) : (
							<p className="py-4 text-sm text-muted-foreground">
								暂无逐跳数据，可稍后重新检测。
							</p>
						)}
						{!mapView && (
							<p
								className="mt-3 text-[11px] leading-5 text-muted-foreground"
								data-return-location-note
							>
								“首个大陆响应”仅按 IP
								定位推测，不代表实际入境点或物理登陆站。各跳延迟为独立往返时间，不是逐跳累加，后续跳点可能更低。
							</p>
						)}
					</section>
				</DialogContent>
			</Dialog>
		</article>
	);
}
export default function ServerReturnRoute({ serverId }: { serverId: number }) {
	const client = useQueryClient(),
		[family, setFamily] = useState("IPv4"),
		[historyAt, setHistoryAt] = useState(0),
		[mobileControls, setMobileControls] = useState<HTMLDivElement | null>(null);
	const member = useQuery({
		queryKey: ["login-user"],
		queryFn: fetchLoginUser,
		retry: 0,
		staleTime: 30000,
	});
	const viewer = member.isError ? 0 : member.data?.data?.id || 0,
		key = ["network-insight", serverId, "return-route", viewer];
	const query = useQuery({
		...insightQueryOptions(serverId, "return-route", viewer),
		enabled: !member.isPending,
		refetchInterval: (q) =>
			["running", "queued"].includes(q.state.data?.state || "") ? 2500 : 30000,
	});
	const run = useMutation({
		mutationFn: (selection: ReturnSelection | undefined) =>
			insightRequest(
				serverId,
				"return-route",
				"POST",
				undefined,
				undefined,
				selection,
			),
		onSuccess: async (data) => {
			await client.cancelQueries({ queryKey: key });
			client.setQueryData(key, data);
			setHistoryAt(0);
		},
	});
	const data = query.data,
		running = data?.state === "running" || run.isPending,
		queued = data?.state === "queued",
		busy = running || queued;
	const selected = data?.history?.find((h) => h.finished_at === historyAt),
		snapshot = selected || data;
	const families = data?.available_families?.length
			? data.available_families
			: ["IPv4"],
		activeFamily = families.includes(family) ? family : families[0];
	const results = (snapshot?.routes || []).filter(
			(r) => r.family === activeFamily,
		),
		all = (data?.routes || []).filter(
			(r) =>
				!data?.retest ||
				(r.id === data.retest.id && r.family === data.retest.family),
		),
		done = all.filter((r) => r.status !== "pending").length;
	return (
		<section
			className="rounded-2xl border bg-card/80 backdrop-blur-sm p-4 sm:p-5 text-card-foreground min-w-0"
			data-network-insight="return-route"
		>
			<header className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:flex sm:flex-wrap">
				<h2 className="flex items-center gap-2 font-semibold text-base">
					<Route className="size-4" />
					回程路由
				</h2>
				{data && (
					<div
						className="order-3 col-span-2 flex min-w-0 flex-wrap items-center gap-2 sm:order-none"
						data-return-family
					>
						<div className="inline-flex shrink-0 rounded-full bg-muted p-1">
							{families.map((f) => (
								<button
									key={f}
									onClick={() => setFamily(f)}
									aria-pressed={activeFamily === f}
									className={cn(
										"rounded-full px-3 py-1.5 text-xs",
										activeFamily === f && "bg-background shadow-sm",
									)}
								>
									{f}
								</button>
							))}
						</div>
						<span className="text-xs text-muted-foreground">
							NextTrace · {data.online ? "节点回程" : "节点离线"}
						</span>
						<div className="ml-auto sm:hidden" ref={setMobileControls} />
					</div>
				)}
				<div
					className={cn(
						"col-start-2 justify-self-end sm:order-none sm:ml-auto",
						data?.can_run ? "order-4" : "order-2",
					)}
				>
					<ReturnRouteCompare
						key={`${serverId}:${viewer}:${!!data?.can_view_ip}`}
						history={data?.history}
						selectedAt={snapshot?.finished_at || 0}
						family={activeFamily}
					/>
				</div>
				{data?.can_run && (
					<Button
						variant="outline"
						size="sm"
						className="order-2 col-start-2 shrink-0 sm:order-last"
						disabled={
							running ||
							run.isPending ||
							!data.online ||
							(queued && !!data.retest)
						}
						onClick={() => run.mutate(undefined)}
						aria-label="重新检测回程"
					>
						<RefreshCw
							className={cn("size-4 mr-1.5", running && "animate-spin")}
						/>
						{queued ? "优先检测" : running ? "检测中…" : "重新检测"}
					</Button>
				)}
			</header>
			{(query.isError || run.isError) && (
				<p role="alert" className="mt-3 text-sm text-destructive">
					{query.isError
						? "读取回程结果失败，请重试"
						: String(run.error?.message || "未能启动检测")}
					<button
						className="ml-2 underline"
						onClick={() => void query.refetch()}
					>
						刷新
					</button>
				</p>
			)}
			{query.isPending ? (
				<p
					role="status"
					className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
				>
					<LoaderCircle className="size-4 animate-spin" />
					正在读取回程记录…
				</p>
			) : (
				data && (
					<>
						{!!data.history?.length && (
							<SnapshotTimeline
								label="回程历史快照"
								mobileControls={mobileControls}
							>
								{data.history.map((h, i) => (
									<button
										type="button"
										key={h.finished_at}
										onClick={() =>
											setHistoryAt(
												busy
													? h.finished_at || 0
													: i === 0
														? 0
														: h.finished_at || 0,
											)
										}
										aria-pressed={
											selected ? historyAt === h.finished_at : !busy && i === 0
										}
										className={cn(
											"shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-xs",
											((selected && historyAt === h.finished_at) ||
												(!selected && !busy && i === 0)) &&
												"border-blue-500 bg-blue-50 dark:bg-blue-950",
										)}
									>
										<span
											title={
												"实际完成：" + formatDetectionTime(h.finished_at, true)
											}
										>
											{formatDetectionTime(
												h.scheduled_at || h.finished_at,
												true,
											)}
										</span>
										<span className="mt-1 block text-muted-foreground">
											{i === 0 ? "最新快照" : "历史快照"} ·{" "}
											{h.scheduled_at
												? "北京时间"
												: h.retest
													? "单项重测"
													: "手动检测"}
										</span>
									</button>
								))}
								{busy && (
									<button
										type="button"
										onClick={() => setHistoryAt(0)}
										aria-pressed={!selected}
										className={cn(
											"shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-xs",
											!selected &&
												"border-blue-500 bg-blue-50 dark:bg-blue-950",
										)}
									>
										{queued ? "等待检测" : "本次检测"}
										<span className="mt-1 block text-muted-foreground">
											实时进度
										</span>
									</button>
								)}
							</SnapshotTimeline>
						)}

						{busy && (
							<div className="mb-3 space-y-1.5" role="status">
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>
										{queued
											? "等待检测" +
												(data.queue_position
													? " · 排队第 " + data.queue_position + " 位"
													: "")
											: "正在检测回程"}
									</span>
									<span>
										{done} / {all.length || "—"}
									</span>
								</div>
								<div className="h-1 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full bg-primary transition-[width] motion-reduce:transition-none"
										style={{
											width: (all.length ? (done / all.length) * 100 : 0) + "%",
										}}
									/>
								</div>
							</div>
						)}
						{results.length ? (
							<div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
								{results.map((r) => (
									<RouteCard
										key={
											serverId +
											":" +
											viewer +
											":" +
											!!data.can_view_ip +
											":" +
											r.id +
											r.family
										}
										result={r}
										onRetest={
											data.can_run
												? (selection) => run.mutate(selection)
												: undefined
										}
										busy={!!busy}
										online={data.online}
										mixed={!!snapshot?.retest}
										error={
											run.isError &&
											run.variables?.id === r.id &&
											run.variables?.family === r.family
												? run.error.message
												: undefined
										}
									/>
								))}
							</div>
						) : (
							<p role="status" className="py-6 text-sm text-muted-foreground">
								{busy ? "正在准备检测…" : "暂无回程记录"}
							</p>
						)}
						{snapshot?.retest && (
							<p className="mt-3 text-xs text-muted-foreground">
								本次为单项重测，其余线路保留原检测结果与时间。
							</p>
						)}
						{!!snapshot?.finished_at && (
							<p className="mt-3 text-xs text-muted-foreground">
								检测时间：
								{formatDetectionTime(
									snapshot.scheduled_at || snapshot.finished_at,
									!!snapshot.scheduled_at,
								)}
								{snapshot.scheduled_at ? "（北京时间）" : ""}
							</p>
						)}
						{results.some((r) => r.hops?.length) && (
							<p className="mt-2 text-xs text-muted-foreground">
								最终延迟仅取目标响应的平均值；优质／普通为网络类别，不代表全程质量或
								GIA 认证。登陆点及线路类型为推测，未响应不代表故障。
							</p>
						)}
					</>
				)
			)}
		</section>
	);
}
