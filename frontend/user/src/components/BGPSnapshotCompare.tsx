import { ArrowLeftRight, GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { compareBGP, completedBGPSnapshots } from "@/lib/bgp-compare";
import { formatDetectionTime } from "@/lib/detection-time";
import type { BGPTopology, InsightSnapshot } from "@/lib/network-insight-api";
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
	formatDetectionTime(s.scheduled_at || s.finished_at, true) +
	(s.scheduled_at ? " · 自动" : " · 手动");
const statuses: Record<string, string> = {
	ok: "观测成功",
	no_address: "无可用地址",
	error: "观测失败",
	timeout: "超时",
	no_route: "暂无路由",
};
function Summary({ t, label }: { t?: BGPTopology; label: string }) {
	return (
		<div
			className="min-w-0 space-y-1.5 rounded-xl bg-muted/40 p-3 text-xs"
			data-bgp-compare-summary
		>
			<p className="text-muted-foreground">{label}</p>
			<p className="break-all font-medium">{t?.prefix || "前缀不可见"}</p>
			<p>
				{t ? statuses[t.status] || t.status : "无此协议族记录"} ·{" "}
				{t?.total ?? "—"} 条观测路径
			</p>
			<p className="text-muted-foreground">
				{t?.graph
					? t.graph.collector_count +
						" 个采集器 · " +
						t.graph.included_path_count +
						" 条纳入图中"
					: "旧版路径摘要"}
			</p>
			{t?.observed_at && (
				<p className="break-words text-muted-foreground">
					观测时间：{t.observed_at.replace("T", " ")} UTC
				</p>
			)}
		</div>
	);
}
function Body({
	snapshots,
	selectedAt,
	initialFamily,
}: {
	snapshots: InsightSnapshot[];
	selectedAt: number;
	initialFamily: string;
}) {
	const index = Math.max(
		0,
		snapshots.findIndex((s) => s.finished_at === selectedAt),
	);
	const [beforeAt, setBeforeAt] = useState(
		snapshots[index + 1]?.finished_at ||
			snapshots[index === 0 ? 1 : 0].finished_at,
	);
	const [afterAt, setAfterAt] = useState(snapshots[index].finished_at);
	const [family, setFamily] = useState(initialFamily);
	const [onlyChanged, setOnlyChanged] = useState(true);
	const before = snapshots.find((s) => s.finished_at === beforeAt)!,
		after = snapshots.find((s) => s.finished_at === afterAt)!;
	const families = [
		...new Set(
			[...(before.topologies || []), ...(after.topologies || [])].map(
				(t) => t.family,
			),
		),
	].sort();
	const active = families.includes(family) ? family : families[0];
	const a = before.topologies?.find((t) => t.family === active),
		b = after.topologies?.find((t) => t.family === active);
	const diff = compareBGP(a, b),
		rows = diff.rows.filter((r) => !onlyChanged || r.kind !== "same");
	const selectClass =
		"mt-1.5 w-full min-w-0 rounded-lg border bg-background px-2 py-2 text-xs text-foreground";
	const select = (
		label: string,
		value: number | undefined,
		other: number | undefined,
		change: (v: number) => void,
	) => (
		<label className="min-w-0 text-xs font-medium">
			{label}
			<select
				aria-label={label}
				className={selectClass}
				value={value}
				onChange={(e) => change(Number(e.target.value))}
			>
				{snapshots.map((s) => (
					<option
						key={s.finished_at}
						value={s.finished_at}
						disabled={s.finished_at === other}
					>
						{stamp(s)}
					</option>
				))}
			</select>
		</label>
	);
	return (
		<>
			<div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
				{select("基准快照", beforeAt, afterAt, setBeforeAt)}
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
				{select("对比快照", afterAt, beforeAt, setAfterAt)}
			</div>
			<fieldset className="flex flex-wrap gap-1" aria-label="对比协议族">
				{families.map((f) => (
					<button
						type="button"
						key={f}
						aria-pressed={active === f}
						onClick={() => setFamily(f)}
						className={cn(
							"rounded-full px-3 py-1.5 text-xs",
							active === f ? "bg-primary text-primary-foreground" : "bg-muted",
						)}
					>
						{f}
					</button>
				))}
			</fieldset>
			<div className="grid min-w-0 gap-2 sm:grid-cols-2">
				<Summary t={a} label="基准" />
				<Summary t={b} label="对比" />
			</div>
			<p className="text-xs leading-5 text-muted-foreground">
				比较已保存的观测路径，不包含补充连线；采集器与样本变化可能导致差异，不代表节点故障或实际转发路径一定改变。快照时间为北京时间，数据源观测时间为
				UTC。
			</p>
			{diff.prefixChanged && (
				<p className="rounded-lg bg-amber-500/10 p-2 text-xs">
					两次前缀不同：以下仅为不同前缀的观测差异，不视为同一前缀的路由切换。
				</p>
			)}
			{diff.prefixUnknown && (
				<p className="text-xs text-muted-foreground">
					当前权限或记录未提供前缀，不能确认两次前缀是否一致。
				</p>
			)}
			{diff.legacy && (
				<p className="text-xs text-muted-foreground">
					至少一份是旧版记录，仅对比起源与上游两级摘要，不推断完整 AS 路径。
				</p>
			)}
			{diff.truncated && (
				<p className="text-xs text-muted-foreground">
					存在截断记录：新增／减少仅指已保存的路径集合，不代表全网新增或撤销。
				</p>
			)}
			{!diff.comparable ? (
				<p
					role="status"
					className="py-5 text-center text-sm text-muted-foreground"
				>
					所选协议族缺少两份成功观测，不计算路径增减。
				</p>
			) : (
				<>
					<div
						className="grid grid-cols-2 gap-2 sm:grid-cols-4"
						data-bgp-diff-stats
					>
						{[
							["新增路径", diff.rows.filter((r) => r.kind === "added").length],
							[
								"减少路径",
								diff.rows.filter((r) => r.kind === "removed").length,
							],
							[
								"样本数变化",
								diff.rows.filter((r) => r.kind === "samples").length,
							],
							[
								"观测数量差",
								(b!.total - a!.total > 0 ? "+" : "") + (b!.total - a!.total),
							],
						].map(([label, value]) => (
							<div key={label} className="rounded-lg border p-2 text-xs">
								<p className="text-muted-foreground">{label}</p>
								<p className="mt-1 text-base tabular-nums">{value}</p>
							</div>
						))}
					</div>
					<div
						className="space-y-2 rounded-lg border p-3 text-xs"
						data-bgp-as-diff
					>
						<p className="break-words">
							新增 ASN：{diff.addedAS.map((n) => "AS" + n).join("、") || "无"}
						</p>
						<p className="break-words">
							减少 ASN：{diff.removedAS.map((n) => "AS" + n).join("、") || "无"}
						</p>
					</div>
					<label className="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={onlyChanged}
							onChange={(e) => setOnlyChanged(e.target.checked)}
						/>
						只看变化
					</label>
					<div className="space-y-2">
						{rows.length ? (
							rows.map((row) => (
								<article
									key={row.path}
									className="min-w-0 rounded-xl border p-3 text-xs"
									data-bgp-path-change={row.kind}
								>
									<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
										<span
											className={cn(
												"rounded-full px-2 py-0.5",
												row.kind === "added"
													? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
													: row.kind === "removed"
														? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
														: "bg-muted",
											)}
										>
											{
												{
													added: "新增",
													removed: "减少",
													samples: "样本数变化",
													same: "未变化",
												}[row.kind]
											}
										</span>
										<span className="tabular-nums text-muted-foreground">
											样本 {row.before ?? "—"} → {row.after ?? "—"}
										</span>
									</div>
									<p className="break-words leading-5">
										{row.path
											.split(" → ")
											.map((n) => "AS" + n)
											.join(" → ")}
									</p>
								</article>
							))
						) : (
							<p
								role="status"
								className="py-5 text-center text-sm text-muted-foreground"
							>
								{onlyChanged ? "已保存的路径与样本数无变化" : "暂无已保存路径"}
							</p>
						)}
					</div>
				</>
			)}
		</>
	);
}
export default function BGPSnapshotCompare({
	history,
	selectedAt,
	family,
}: {
	history?: InsightSnapshot[];
	selectedAt: number;
	family: string;
}) {
	const available = completedBGPSnapshots(history);
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
					className="shrink-0 gap-1.5"
					disabled={available.length < 2}
					title={
						available.length < 2
							? "至少需要两次已完成的快照"
							: "比较两次 BGP 快照"
					}
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
					<DialogTitle className="text-base">BGP 快照对比</DialogTitle>
					<DialogDescription className="text-xs">
						只读对比已保留的记录，不触发检测。打开期间快照保持不变。
					</DialogDescription>
				</DialogHeader>
				<section
					className="min-h-0 space-y-3 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
					data-bgp-compare-scroll
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus and scroll the bounded comparison region.
					tabIndex={0}
					aria-label="BGP 快照对比滚动区域"
				>
					{session && session.snapshots.length >= 2 && (
						<Body {...session} initialFamily={session.family} />
					)}
				</section>
			</DialogContent>
		</Dialog>
	);
}
