import { formatDetectionTime } from "@/lib/detection-time";
import { Suspense, memo, useState } from "react";
import SnapshotTimeline from "./SnapshotTimeline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleHelp, RefreshCw, Tv } from "lucide-react";
import { fetchLoginUser } from "@/lib/nezha-api";
import {
	insightRequest,
	type InsightKind,
	type MediaResult,
} from "@/lib/network-insight-api";
import { resolveConnectivityIcon } from "@/lib/connectivity-icons";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PreloadedBGPTopology as BGPTopology } from "@/lib/detail-modules";
import { insightQueryOptions } from "@/lib/detail-result-query";

export const mediaStatus: Record<string, string> = {
	untested: "暂无记录",
	unlocked: "解锁",
	originals: "仅自制内容",
	restricted: "受限",
	timeout: "超时",
	network_error: "网络不可达",
	challenge: "验证拦截",
	unknown: "无法判断",
	unsupported: "缺少工具或系统不支持",
	disabled: "Agent 禁止执行",
	offline: "节点已离线",
	no_address: "旧记录：未检测 IPv6",
	reachable: "网页可达",
	blocked: "访问被拒绝",
	dns_error: "域名解析失败",
	no_route: "无可用路由",
};
function MediaStatus({ value }: { value: MediaResult }) {
	return (
		<div className="flex min-w-0 items-start justify-between gap-2 text-xs leading-5">
			<span className="text-muted-foreground shrink-0">{value.family}</span>
			<span
				data-media-status={value.status}
				title={
					value.status === "reachable"
						? "仅确认公开网页可达，未获得足以判定解锁的区域信号；不代表账号播放权限"
						: undefined
				}
				className={cn(
					"text-right break-words",
					value.status === "unlocked"
						? "text-emerald-700 dark:text-emerald-400"
						: value.status === "originals"
							? "text-amber-700 dark:text-amber-400"
							: [
										"restricted",
										"network_error",
										"timeout",
										"blocked",
										"dns_error",
										"no_route",
									].includes(value.status)
								? "text-red-700 dark:text-red-400"
								: "text-muted-foreground",
				)}
			>
				{mediaStatus[value.status] || "无法判断"}
				{value.region && (
					<span className="ml-1 text-foreground">· {value.region}</span>
				)}
			</span>
		</div>
	);
}
function ServerNetworkInsight({
	serverId,
	kind,
}: {
	serverId: number;
	kind: InsightKind;
}) {
	const client = useQueryClient(),
		[family, setFamily] = useState("IPv4"),
		[historyAt, setHistoryAt] = useState(0);
	const member = useQuery({
		queryKey: ["login-user"],
		queryFn: fetchLoginUser,
		retry: 0,
		staleTime: 30000,
	});
	const viewer = member.isError ? 0 : member.data?.data?.id || 0;
	const key = ["network-insight", serverId, kind, viewer];
	const query = useQuery({
		...insightQueryOptions(serverId, kind, viewer),
		enabled: !member.isPending,
		refetchInterval: (q) => (q.state.data?.state === "running" ? 2500 : 30000),
	});
	const run = useMutation({
		mutationFn: () => insightRequest(serverId, kind, "POST"),
		onSuccess: async (data) => {
			await client.cancelQueries({ queryKey: key });
			client.setQueryData(key, data);
			setHistoryAt(0);
		},
	});
	const data = query.data,
		active = data?.state === "running" || run.isPending;
	const selectedHistory = data?.history?.find((item) => item.finished_at === historyAt);
	const effectiveHistoryAt = selectedHistory ? historyAt : 0;
	const snapshot = selectedHistory || data;
	const families = data?.available_families?.length
		? data.available_families
		: ["IPv4", "IPv6"];
	const selectedFamily = families.includes(family) ? family : families[0];
	const topology = snapshot?.topologies?.find((t) => t.family === selectedFamily);
	const mediaResults = (data?.results || []).filter((r) => families.includes(r.family));
	const names = [...new Set(mediaResults.map((r) => r.id))];
	const title = kind === "bgp" ? "BGP 路由拓扑" : "流媒体解锁";
	return (
		<section
			className="rounded-2xl border bg-card/80 backdrop-blur-sm p-4 sm:p-5 text-card-foreground min-w-0"
			data-network-insight={kind}
		>
			<header className={cn("flex flex-wrap items-center justify-between gap-3", kind === "bgp" ? "mb-2" : "mb-4")}>
				<div className="flex items-center gap-2 min-w-0">
					<h2 className="font-semibold text-base">{title}</h2>
					<Popover>
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-label={`${title}说明`}
								className="p-1 rounded-full text-muted-foreground hover:text-foreground"
							>
								<CircleHelp className="size-4" />
							</button>
						</PopoverTrigger>
						<PopoverContent className="max-w-[calc(100vw-2rem)] text-xs leading-relaxed">
							{kind === "bgp"
								? "查看节点的 BGP 路由与历史变化，可切换 IPv4 / IPv6。"
								: "查看节点对各平台的访问与解锁情况，实际播放以平台结果为准。"}
						</PopoverContent>
					</Popover>
				</div>
				{data?.can_run && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => run.mutate()}
						disabled={active || (kind === "streaming" && !data.online)}
						aria-label={`重新检测${title}`}
					>
						<RefreshCw
							className={cn("size-4 mr-1.5", active && "animate-spin")}
						/>
						重新检测
					</Button>
				)}
			</header>
			{(query.isError || run.isError) && (
				<p role="alert" className="text-sm text-red-700 dark:text-red-400 mb-3">
					{query.isError
						? "读取结果失败，请稍后重试"
						: String(run.error?.message || "检测未能启动")}
					<button
						className="underline ml-2"
						onClick={() => void query.refetch()}
					>
						刷新
					</button>
				</p>
			)}
			{query.isPending && (
				<div
					role="status"
					className="h-28 rounded-xl bg-muted/40 animate-pulse"
					aria-label="正在加载结果"
				/>
			)}
			{data && kind === "bgp" && (
				<>
					<div data-bgp-family className="flex flex-wrap items-center gap-3 mb-2">
						<div className="inline-flex rounded-full bg-muted p-1">
							{families.map((f) => (
								<button
									key={f}
									onClick={() => setFamily(f)}
									aria-pressed={selectedFamily === f}
									className={cn(
										"rounded-full px-3 py-1.5 text-xs",
										selectedFamily === f && "bg-background shadow-sm",
									)}
								>
									{f}
								</button>
							))}
						</div>
						{topology && topology.total > 0 && (
							<span className="text-sm break-all">
								{data.can_view_ip && topology.prefix
									? `${topology.prefix} · `
									: ""}
								{topology.total} 条观测路径
							</span>
						)}
					</div>
					{!!data.history?.length && (
						<SnapshotTimeline>
							{data.history.map((item, i) => (
								<button
									key={item.finished_at}
									onClick={() =>
										setHistoryAt(i === 0 ? 0 : (item.finished_at ?? 0))
									}
									aria-pressed={
										(effectiveHistoryAt === 0 && i === 0) ||
										effectiveHistoryAt === item.finished_at
									}
									className={cn(
										"shrink-0 whitespace-nowrap border rounded-lg px-3 py-2 text-xs text-left",
										((effectiveHistoryAt === 0 && i === 0) ||
											effectiveHistoryAt === item.finished_at) &&
											"border-blue-500 bg-blue-50 dark:bg-blue-950",
									)}
								>
									<span title={`实际完成：${item.finished_at ? new Date(item.finished_at).toLocaleString() : "—"}`}>
										{formatDetectionTime(item.scheduled_at || item.finished_at, !!item.scheduled_at)}
									</span>
									<span className="block text-muted-foreground mt-1">
										{i === 0 ? "最新快照" : "历史快照"}{item.scheduled_at ? " · 北京时间" : " · 手动检测"}
									</span>
								</button>
							))}
						</SnapshotTimeline>
					)}
					{topology ? (
						<>
							<Suspense fallback={<p role="status" className="py-10 text-center text-sm text-muted-foreground">正在加载路由拓扑…</p>}><BGPTopology topology={topology} /></Suspense>
							{topology.observed_at && (
								<p className="text-[11px] text-muted-foreground mt-2">
									数据源观测时间：{topology.observed_at.replace("T", " ")} UTC
								</p>
							)}
						</>
					) : (
						<p className="py-10 text-center text-sm text-muted-foreground">
							暂无 BGP 记录
						</p>
					)}
				</>
			)}
			{data && kind === "streaming" && (
				<div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-3 gap-3">
					{names.map((id) => {
						const entries = mediaResults.filter((r) => r.id === id);
						const first = entries[0];
						if (!first) return null;
						const icon = resolveConnectivityIcon(first.icon);
						return (
							<article
								className="rounded-xl border bg-background/50 p-3 min-w-0"
								key={id}
								data-media-card={id}
							>
								<div className="flex items-center gap-2 mb-2">
									{icon ? (
										<img
											src={icon}
											alt=""
											className="size-7 rounded-md object-contain shrink-0 bg-white"
											loading="lazy"
										/>
									) : (
										<Tv className="size-7 shrink-0" />
									)}
									<h3 className="font-medium text-sm leading-5">
										{first.name}
									</h3>
								</div>
								{entries.map((value) => (
									<MediaStatus key={value.family} value={value} />
								))}
							</article>
						);
					})}
				</div>
			)}
			{data?.finished_at && (
				<p className="mt-3 text-[11px] text-muted-foreground">
					<span title={`实际完成：${formatDetectionTime(data.finished_at)}`}>
						{data.scheduled_at ? "检测周期（北京时间）：" : "最近完成："}
						{formatDetectionTime(data.scheduled_at || data.finished_at, !!data.scheduled_at)}
					</span>
					{!data.online ? " · 节点离线，显示已保存结果" : ""}
				</p>
			)}
		</section>
	);
}

export default memo(ServerNetworkInsight);