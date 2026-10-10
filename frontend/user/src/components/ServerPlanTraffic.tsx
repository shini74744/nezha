import { XMarkIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/lib/format";
import type { NezhaServer } from "@/types/nezha-api";
import { Loader } from "./loading/Loader";
import "./ServerPlanTraffic.css";

export type ServerPlanTrafficStat = {
	quota_type: "limited" | "unlimited" | "unset";
	from: string; to: string; max: number; used: number;
	in: number; out: number; direction: string; reset_day: number;
	partial?: boolean; estimated?: boolean; last_report_at?: number; error?: string;
};
export async function fetchServerPlanTraffic(signal?: AbortSignal) {
	const response = await fetch("/api/v1/server-traffic", { signal, credentials: "same-origin", cache: "no-store" });
	if (!response.ok) throw new Error("Traffic unavailable");
	const body = await response.json();
	if (!body.success || !body.data || typeof body.data !== "object" || Array.isArray(body.data))
		throw new Error("Traffic unavailable");
	return body.data as Record<string, ServerPlanTrafficStat>;
}
export function validPlanTraffic(stat: ServerPlanTrafficStat) {
	return [stat.max, stat.used, stat.in, stat.out].every(n => Number.isFinite(n) && n >= 0)
		&& ["1", "2", "3"].includes(stat.direction)
		&& ["limited", "unlimited", "unset"].includes(stat.quota_type)
		&& (stat.quota_type === "limited" ? stat.max > 0 : stat.max === 0)
		&& Number.isFinite(Date.parse(stat.from)) && Date.parse(stat.to) > Date.parse(stat.from);
}
export function ServerPlanTrafficCard({ server, stat }: { server: NezhaServer; stat?: ServerPlanTrafficStat }) {
	const { t, i18n } = useTranslation();
	const valid = stat && typeof stat === "object" && !stat.error && validPlanTraffic(stat);
	const date = (value: string) => new Date(value).toLocaleDateString(i18n.language, {
		year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai",
	});
	const limited = valid && stat.quota_type === "limited";
	const percent = limited ? Math.max(0, stat.used / stat.max * 100) : 0;
	const color = "hsl(" + (120 - Math.min(100, percent) * 1.2) + " 65% 40%)";
	return <article data-statistics-card="cycle" data-server-id={server.id}
		className="w-full min-w-0 rounded-lg border bg-card px-3 py-2.5 text-card-foreground">
		<div className="flex items-start justify-between gap-2">
			<h3 className="min-w-0 break-words [overflow-wrap:anywhere] text-sm font-medium">{server.name}</h3>
			{valid && <span className="shrink-0 rounded bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
				{t("statistics.cycleDirection" + stat.direction)}
			</span>}
		</div>
		{!valid ? <p role="status" className="mt-2 text-xs text-muted-foreground">
			{t(stat?.error ? "statistics.cycleConfigError" : "statistics.cycleUnavailable")}
		</p> : <>
			<p className="mt-1 break-words text-[11px] text-muted-foreground">
				{date(stat.from)} — {date(stat.to)} · {t("statistics.cycleTimezone")}
			</p>
			<div className="cycle-traffic-summary mt-1.5">
				<p className="cycle-traffic-usage text-sm font-medium">
					<span className="mr-1 text-xs font-normal text-muted-foreground">{t("statistics.cycleUsed")}</span>
					{stat.partial || stat.estimated ? "≈ " : ""}{formatBytes(stat.used)}
					<span className="ml-1 text-xs font-normal text-muted-foreground">/ {limited ? formatBytes(stat.max)
						: t(stat.quota_type === "unlimited" ? "statistics.cycleUnlimited" : "statistics.cycleUnset")}</span>
				</p>
				{(stat.partial || stat.estimated) && <p className="cycle-traffic-note text-[11px] leading-4 text-muted-foreground">
					{[stat.partial && t("statistics.cyclePartial"), stat.estimated && t("statistics.cycleEstimated")].filter(Boolean).join(" · ")}
				</p>}
				{limited && <span className="cycle-traffic-percent text-xs tabular-nums">{percent.toFixed(1)}%</span>}
			</div>
			{limited ? <div data-cycle-flow-bar="limited" className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
				role="progressbar" aria-label={server.name} aria-valuemin={0} aria-valuemax={100}
				aria-valuenow={Math.min(100, percent)} aria-valuetext={percent.toFixed(1) + "%"}>
				<div className="h-full rounded-full transition-[width,background-color] duration-300"
					style={{ width: Math.min(100, percent) + "%", backgroundColor: color }} />
			</div> : <div data-cycle-flow-bar={stat.quota_type} role="img"
				aria-label={`${t("statistics.cycleUsed")} ${formatBytes(stat.used)} / ${t(stat.quota_type === "unlimited" ? "statistics.cycleUnlimited" : "statistics.cycleUnset")}`}
				className={"mt-1 h-1.5 rounded-full " + (stat.quota_type === "unlimited"
					? "bg-sky-500/70 dark:bg-sky-400/70" : "bg-slate-400/60 dark:bg-slate-500/70")} />}
			<dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"><dt className="text-muted-foreground">{t("statistics.cycleUpload")}</dt><dd className="font-medium tabular-nums">{formatBytes(stat.out)}</dd></div>
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"><dt className="text-muted-foreground">{t("statistics.cycleDownload")}</dt><dd className="font-medium tabular-nums">{formatBytes(stat.in)}</dd></div>
			</dl>
		</>}
	</article>;
}
export default function ServerPlanTraffic({ serverList, onClose }: { serverList: NezhaServer[]; onClose?: () => void }) {
	const { t } = useTranslation();
	const { data, isPending, isError, isFetching, refetch } = useQuery({
		queryKey: ["server-plan-statistics"], queryFn: ({ signal }) => fetchServerPlanTraffic(signal),
		refetchInterval: 30_000, refetchOnMount: "always", refetchOnWindowFocus: true, retry: false,
	});
	return <section data-statistics-view="cycle" className="mt-4 w-full min-w-0" aria-label={t("statistics.cycle")}>
		<div className="mb-2 flex items-center justify-between gap-3">
			<div className="min-w-0"><h2 className="text-sm font-semibold">{t("statistics.cycle")}</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">{t("statistics.cycleHint")}</p></div>
			{onClose && <button type="button" onClick={onClose} aria-label={t("statistics.close")}
				className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-card text-card-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2">
				<XMarkIcon className="size-4" aria-hidden="true" /></button>}
		</div>
		{isPending ? <div role="status" className="flex items-center gap-2 rounded-xl border bg-card p-5 text-sm"><Loader visible />{t("serviceTracker.loading")}</div>
			: isError ? <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-5 text-sm">
				<span>{t("statistics.error")}</span><button type="button" disabled={isFetching} onClick={() => void refetch()}
					className="min-h-10 rounded-lg border px-3 hover:bg-accent">{t("statistics.retry")}</button></div>
			: !serverList.length ? <p role="status" className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">{t("statistics.cycleEmpty")}</p>
			: <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">{serverList.map(server =>
				<ServerPlanTrafficCard key={server.id} server={server} stat={data?.[String(server.id)]} />)}</div>}
	</section>;
}
