import { ArrowLeftRight, GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { formatDetectionTime } from "@/lib/detection-time";
import type {
	InsightSnapshot,
	ReturnHop,
	ReturnResult,
} from "@/lib/network-insight-api";
import {
	compareReturnSnapshots,
	completedReturnSnapshots,
	finalReturnRTT,
	returnQuality,
	returnQualityHelp,
	returnStatusText,
} from "@/lib/return-route-view";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog";

const stamp = (s: InsightSnapshot) =>
	formatDetectionTime(s.scheduled_at || s.finished_at, !!s.scheduled_at) +
	(s.scheduled_at ? " · 北京时间" : s.retest ? " · 单项重测" : " · 手动");
const latency = (r?: ReturnResult) => {
	const n = finalReturnRTT(r);
	return n === undefined ? "—" : n.toFixed(1) + " ms";
};
function RouteSummary({ r, label }: { r?: ReturnResult; label: string }) {
	return (
		<div
			className="min-w-0 rounded-lg bg-muted/40 p-3 text-xs"
			data-compare-summary
		>
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<span className="text-muted-foreground">{label}</span>
				<span>{r ? returnStatusText[r.status] || "暂无结果" : "无此目标"}</span>
			</div>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<span className="min-w-0 break-words font-medium">
					{r?.line || "线路未识别"}
				</span>
				<span className="shrink-0 tabular-nums">{latency(r)}</span>
			</div>
			<p className="mt-2 break-words leading-5 text-muted-foreground">
				{r?.route?.join(" → ") || "暂无路由信息"}
			</p>
			{!!r?.tested_at && (
				<p className="mt-2 text-muted-foreground">
					本项：{formatDetectionTime(r.tested_at, true)}（北京时间）
				</p>
			)}
			{r && (
				<p className="mt-1 text-muted-foreground">
					{r.protocol.toUpperCase()} ·{" "}
					{r.hops?.length ? Math.max(...r.hops.map((h) => h.ttl)) + " 跳" : "—"}
				</p>
			)}
		</div>
	);
}
function HopGroup({ hops, label }: { hops: ReturnHop[]; label: string }) {
	return (
		<div className="min-w-0 break-words">
			<span className="mb-1 block text-[10px] text-muted-foreground sm:hidden">
				{label}
			</span>
			{!hops.length ? (
				<span className="text-muted-foreground">无记录</span>
			) : (
				hops.map((h, i) => (
					<div key={i} className="mb-1.5 space-y-1 last:mb-0">
						{h.samples ? (
							<>
								<div className="flex flex-wrap gap-x-2 gap-y-1">
									<span>
										{h.asn ? "AS" + h.asn : "未识别 ASN"}
										{h.network ? " · " + h.network : ""}
									</span>
									{returnQuality(h) && (
										<span
											className={cn(
												"rounded px-1 text-[10px]",
												returnQuality(h) === "优质线路"
													? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
													: "bg-muted text-muted-foreground",
											)}
											title={returnQualityHelp}
										>
											{returnQuality(h)}
										</span>
									)}
									<span className="tabular-nums text-muted-foreground">
										{typeof h.rtt_ms === "number" && Number.isFinite(h.rtt_ms)
											? h.rtt_ms.toFixed(1) + " ms"
											: "—"}
									</span>
								</div>
								<p className="break-all font-mono text-muted-foreground">
									{h.ip || (h.ip_hidden ? "地址已隐藏" : "地址不可用")}
								</p>
								{h.location && (
									<p className="text-muted-foreground">{h.location}</p>
								)}
							</>
						) : (
							<span className="text-muted-foreground">未响应</span>
						)}
					</div>
				))
			)}
		</div>
	);
}

function ComparisonBody({
	snapshots,
	selectedAt,
	initialFamily,
}: {
	snapshots: InsightSnapshot[];
	selectedAt: number;
	initialFamily: string;
}) {
	const selectedIndex = Math.max(
		0,
		snapshots.findIndex((s) => s.finished_at === selectedAt),
	);
	const [beforeAt, setBeforeAt] = useState(
		snapshots[selectedIndex + 1]?.finished_at ||
			snapshots[selectedIndex === 0 ? 1 : 0].finished_at,
	);
	const [afterAt, setAfterAt] = useState(snapshots[selectedIndex].finished_at);
	const [family, setFamily] = useState(initialFamily);
	const [onlyChanged, setOnlyChanged] = useState(false);
	const before = snapshots.find((s) => s.finished_at === beforeAt)!;
	const after = snapshots.find((s) => s.finished_at === afterAt)!;
	const families = [
		...new Set(
			[...(before.routes || []), ...(after.routes || [])].map((r) => r.family),
		),
	].sort();
	const activeFamily = families.includes(family)
		? family
		: families[0] || "IPv4";
	const rows = compareReturnSnapshots(before, after, activeFamily);
	const filtered = onlyChanged ? rows.filter((r) => r.changed) : rows;
	const selectClass =
		"mt-1.5 w-full min-w-0 rounded-lg border bg-background px-2 py-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary";
	return (
		<>
			<div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
				<label className="min-w-0 text-xs font-medium">
					基准快照
					<select
						aria-label="基准快照"
						className={selectClass}
						value={beforeAt}
						onChange={(e) => setBeforeAt(Number(e.target.value))}
					>
						{snapshots.map((s) => (
							<option
								key={s.finished_at}
								value={s.finished_at}
								disabled={s.finished_at === afterAt}
							>
								{stamp(s)}
							</option>
						))}
					</select>
				</label>
				<Button
					variant="outline"
					size="sm"
					className="hidden sm:inline-flex"
					aria-label="交换快照"
					onClick={() => {
						setBeforeAt(afterAt);
						setAfterAt(beforeAt);
					}}
				>
					<ArrowLeftRight className="size-4" />
				</Button>
				<label className="min-w-0 text-xs font-medium">
					对比快照
					<select
						aria-label="对比快照"
						className={selectClass}
						value={afterAt}
						onChange={(e) => setAfterAt(Number(e.target.value))}
					>
						{snapshots.map((s) => (
							<option
								key={s.finished_at}
								value={s.finished_at}
								disabled={s.finished_at === beforeAt}
							>
								{stamp(s)}
							</option>
						))}
					</select>
				</label>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<fieldset
					className="inline-flex min-w-0 rounded-full bg-muted p-1"
					aria-label="对比协议族"
				>
					{families.map((f) => (
						<button
							type="button"
							key={f}
							aria-pressed={activeFamily === f}
							onClick={() => setFamily(f)}
							className={cn(
								"rounded-full px-3 py-1.5 text-xs",
								activeFamily === f && "bg-background shadow-sm",
							)}
						>
							{f}
						</button>
					))}
				</fieldset>
				<label className="flex items-center gap-2 text-xs">
					<input
						type="checkbox"
						checked={onlyChanged}
						onChange={(e) => setOnlyChanged(e.target.checked)}
					/>
					只看路由或状态变化
				</label>
			</div>
			<p className="text-xs leading-5 text-muted-foreground">
				延迟差 = 对比 − 基准，仅使用目标响应的平均值。逐跳按 TTL
				对照可见信息，多路径完整保留；地址隐藏或未响应时不能证明实际路径相同。
			</p>
			<p role="status" className="text-xs text-muted-foreground">
				{rows.length} 项 · {rows.filter((r) => r.changed).length}{" "}
				项路由、状态或目标变化
			</p>
			{filtered.length ? (
				filtered.map((row) => {
					const r = (row.after || row.before)!;
					const reason = !row.before
						? "新增目标"
						: !row.after
							? "本次无此目标"
							: !row.comparable
								? "目标或协议不同／无法确认一致"
								: row.changed
									? "可见信息有变化"
									: "可见路由与状态无变化";
					return (
						<article
							key={row.key}
							className="min-w-0 rounded-xl border p-3"
							data-return-comparison
						>
							<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-sm font-medium">
									{r.name} · {r.carrier}
								</h3>
								<span
									className={cn(
										"rounded-full px-2 py-1 text-[11px]",
										row.changed
											? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
											: "bg-muted text-muted-foreground",
									)}
								>
									{reason}
								</span>
							</div>
							<div className="grid min-w-0 gap-2 sm:grid-cols-2">
								<RouteSummary r={row.before} label="基准" />
								<RouteSummary r={row.after} label="对比" />
							</div>
							{row.delta !== undefined && (
								<p
									className="mt-2 text-right text-xs tabular-nums"
									data-latency-delta
								>
									延迟差{" "}
									{Math.abs(row.delta) < 0.05
										? "0.0"
										: (row.delta > 0 ? "+" : "") + row.delta.toFixed(1)}{" "}
									ms
								</p>
							)}
							{!row.comparable && row.before && row.after && (
								<p className="mt-2 text-xs text-muted-foreground">
									不计算延迟差，不将不同检测目标当作线路切换。
								</p>
							)}
							<details className="mt-3 rounded-lg border">
								<summary className="cursor-pointer px-3 py-2 text-xs">
									逐跳对照 · {row.hops.length} 个 TTL
								</summary>
								<div className="px-2 pb-2">
									<div className="hidden grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b px-1 pb-2 text-xs text-muted-foreground sm:grid">
										<span>TTL</span>
										<span>基准</span>
										<span>对比</span>
									</div>
									{row.hops.length ? (
										row.hops.map((h) => (
											<div
												key={h.ttl}
												className={cn(
													"grid min-w-0 grid-cols-[1.8rem_minmax(0,1fr)] gap-x-2 gap-y-2 rounded-lg px-1 py-2 text-xs sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)]",
													h.changed && "bg-amber-500/10",
												)}
												data-hop-difference={h.changed ? "changed" : "same"}
											>
												<span className="row-span-2 pt-0.5 text-center tabular-nums text-muted-foreground sm:row-span-1">
													{h.ttl}
												</span>
												<HopGroup hops={h.before} label="基准" />
												<HopGroup hops={h.after} label="对比" />
											</div>
										))
									) : (
										<p className="p-2 text-xs text-muted-foreground">
											暂无逐跳数据
										</p>
									)}
								</div>
							</details>
						</article>
					);
				})
			) : (
				<p className="py-6 text-center text-sm text-muted-foreground">
					{onlyChanged ? "没有路由或状态变化" : "所选快照没有此协议族的记录"}
				</p>
			)}
		</>
	);
}
export default function ReturnRouteCompare({
	history,
	selectedAt,
	family,
}: {
	history?: InsightSnapshot[];
	selectedAt: number;
	family: string;
}) {
	const available = completedReturnSnapshots(history);
	const [session, setSession] = useState<{
		snapshots: InsightSnapshot[];
		selectedAt: number;
		family: string;
	} | null>(null);
	return (
		<Dialog
			open={!!session}
			onOpenChange={(open) =>
				setSession(
					open
						? { snapshots: structuredClone(available), selectedAt, family }
						: null,
				)
			}
		>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					disabled={available.length < 2}
					title={
						available.length < 2
							? "至少需要两次已完成的快照"
							: "比较两次已完成的快照"
					}
					className="shrink-0 gap-1.5"
				>
					<GitCompareArrows className="size-4" />
					快照对比
				</Button>
			</DialogTrigger>
			<DialogContent
				className="z-[10001] grid max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-2xl bg-card/95 p-4 text-card-foreground backdrop-blur-xl sm:p-5"
				overlayClassName="z-[10000] bg-black/45 backdrop-blur-sm"
			>
				<DialogHeader className="pr-6 text-left">
					<DialogTitle className="text-base">回程快照对比</DialogTitle>
					<DialogDescription className="text-xs">
						只读对比已保留的历史记录，不触发重新检测。当前对比期间保持快照不变。
					</DialogDescription>
				</DialogHeader>
				<section
					className="min-h-0 space-y-3 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
					data-return-compare-scroll
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus and scroll the bounded comparison region.
					tabIndex={0}
					aria-label="快照对比滚动区域"
				>
					{session && session.snapshots.length >= 2 && (
						<ComparisonBody {...session} initialFamily={session.family} />
					)}
				</section>
			</DialogContent>
		</Dialog>
	);
}
