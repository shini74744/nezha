import { formatDetectionTime } from "@/lib/detection-time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CN, JP, US, KR, SG, MY, ID, GB, DE, FR, CA, AU, IN, BR, RU } from "country-flag-icons/react/3x2";
import {
	CircleHelp,
	Globe2,
	LoaderCircle,
	RefreshCw,
	WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	type ConnectivityResult,
	fetchConnectivity,
	startConnectivity,
} from "@/lib/connectivity-api";
import { resolveConnectivityIcon } from "@/lib/connectivity-icons";
import { cn } from "@/lib/utils";
import ConnectivityMarquee from "./ConnectivityMarquee";
import { orderedConnectivityRegions, connectivityRegionName } from "../../../shared/connectivity-regions";

const flagIcons: Record<string, typeof CN> = { CN, JP, US, KR, SG, MY, ID, GB, DE, FR, CA, AU, IN, BR, RU };

export default function ServerConnectivity({ serverId, countryCode }: { serverId: number; countryCode?: string }) {
	const regions = orderedConnectivityRegions(countryCode).map(region => ({...region, Icon: flagIcons[region.country] || Globe2}));
	const { t, i18n } = useTranslation();
	const client = useQueryClient();
	const key = ["server-connectivity", serverId];
	const [now, setNow] = useState(Date.now());
	const [help, setHelp] = useState(false);
	const [manualRun, setManualRun] = useState<string>();
	const query = useQuery({
		queryKey: key,
		queryFn: ({ signal }) => fetchConnectivity(serverId, signal),
		staleTime: 0,
		retry: 1,
		refetchInterval: (state) =>
			state.state.data?.state === "running" ? 1500 : 15000,
		refetchIntervalInBackground: false,
	});
	const mutation = useMutation({
		mutationFn: (targetId?: string) => startConnectivity(serverId, targetId),
		onSuccess: async (data) => {
			await client.cancelQueries({ queryKey: key });
			setManualRun(`${serverId}:${data.started_at}`);
			client.setQueryData(key, data);
		},
		onError: () => {
			void query.refetch();
		},
	});
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const live = query.data;
	const running = live?.state === "running";
	const showingLatest = running && !!live.latest && manualRun !== `${serverId}:${live.started_at}`;
	const data = live && showingLatest ? { ...live, ...live.latest, retry_at: live.retry_at } : live;
	const showingProgress = running && !showingLatest;
	const cooldown = Math.max(0, Math.ceil(((data?.retry_at || 0) - now) / 1000));
	const completed =
		data?.results.filter((result) =>
			result.phase
				? result.phase === "complete"
				: !["pending", "running"].includes(result.status),
		).length || 0;
	const formatDate = (value?: number) =>
		value ? new Date(value).toLocaleString(i18n.language) : "—";
	const error =
		mutation.error?.message === "connectivity_busy"
			? t("connectivity.busy")
			: mutation.error?.message === "connectivity_offline"
				? t("connectivity.offline")
				: t("connectivity.startFailed");

	return (
		<section
			data-server-connectivity
			className="w-full min-w-0 space-y-4"
			aria-label={t("tabSwitch.Connectivity")}
		>
			{!data?.can_run && query.isPending && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("connectivity.loading")}
				</p>
			)}
			{!data?.can_run && query.isError && (
				<p role="alert" className="text-sm">
					{t("connectivity.readFailed")}{" "}
					<button
						type="button"
						className="underline underline-offset-4"
						onClick={() => query.refetch()}
					>
						{t("connectivity.reload")}
					</button>
				</p>
			)}
			{data?.can_run && (
				<Card data-connectivity-controls className="min-w-0">
					<CardContent className="px-4 py-3 sm:px-5 sm:py-3 space-y-2">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="min-w-0">
								<h2 className="flex items-center gap-2 text-base font-semibold">
									<Globe2 className="size-4 shrink-0" aria-hidden />
									<span>{t("connectivity.title")}</span>
									<button
										type="button"
										aria-label={t("connectivity.helpTitle")}
										aria-expanded={help}
										onClick={() => setHelp((value) => !value)}
										className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
									>
										<CircleHelp className="size-4" aria-hidden />
									</button>
								</h2>
							</div>
							{data?.can_run && (
								<Button
									size="sm"
									variant="outline"
									type="button"
									disabled={
										!data.online ||
										data.results.length === 0 ||
										running ||
										mutation.isPending ||
										cooldown > 0 ||
										query.isError
									}
									onClick={() => mutation.mutate(undefined)}
									className="shrink-0 gap-2"
								>
									{running || mutation.isPending ? (
										<LoaderCircle
											className="size-3.5 animate-spin"
											aria-hidden
										/>
									) : (
										<RefreshCw className="size-3.5" aria-hidden />
									)}
									{running
										? t("connectivity.testing")
										: cooldown > 0
											? t("connectivity.cooldown", { seconds: cooldown })
											: data.state === "idle"
												? t("connectivity.start")
												: t("connectivity.retest")}
								</Button>
							)}
						</div>
						{help && (
							<div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
								{t("connectivity.help")}
							</div>
						)}
						{query.isPending ? (
							<p role="status" className="text-sm text-muted-foreground">
								{t("connectivity.loading")}
							</p>
						) : query.isError ? (
							<p role="alert" className="text-sm">
								{t("connectivity.readFailed")}{" "}
								<button
									type="button"
									className="underline underline-offset-4"
									onClick={() => query.refetch()}
								>
									{t("connectivity.reload")}
								</button>
							</p>
						) : (
							data && (
								<>
									{!data.online && (
										<p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
											<WifiOff className="size-4 shrink-0" aria-hidden />
											{t("connectivity.offline")}
										</p>
									)}
									<div
										className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
										role="status"
										aria-live="polite"
									>
										<span>
											{showingProgress
												? t("connectivity.progress", {
														done: completed,
														total: data.results.length,
													})
												: data.state === "complete"
													? t("connectivity.finished")
													: t("connectivity.empty")}
										</span>
										{data.started_at && (
											<span>
												{t(data.scheduled_at ? "connectivity.scheduledTime" : "connectivity.time")}:{" "}
												<span title={formatDate(data.finished_at || data.started_at)}>{data.scheduled_at ? formatDetectionTime(data.scheduled_at, true) : formatDate(data.finished_at || data.started_at)}</span>
											</span>
										)}
										<span>
											{t("connectivity.rounds", { count: data.rounds })}
										</span>
									</div>
									{showingProgress && (
										<div
											role="progressbar"
											aria-label={t("connectivity.testing")}
											aria-valuemin={0}
											aria-valuemax={data.results.length}
											aria-valuenow={completed}
											className="h-1.5 overflow-hidden rounded-full bg-muted"
										>
											<div
												className="h-full rounded-full bg-primary transition-[width]"
												style={{
													width: `${data.results.length ? (completed / data.results.length) * 100 : 0}%`,
												}}
											/>
										</div>
									)}
								</>
							)
						)}
						{mutation.isError && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
					</CardContent>
				</Card>
			)}
			{!query.isError && data?.results.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("connectivity.noTargets")}
				</p>
			)}
			{!query.isError &&
				data &&
				regions
					.filter(({ id }) =>
						data.results.some((result) => result.group === id),
					)
					.map(({ id: group, Icon, ...region }) => (
						<div
							key={group}
							data-connectivity-group={group}
							className="space-y-2"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h3 className="flex items-center gap-2 text-sm font-semibold">
									<Icon className="h-4 w-6 shrink-0" aria-hidden />
									{connectivityRegionName({id: group, ...region}, i18n.language)}
								</h3>
								<span className="text-xs text-muted-foreground">
									{t("connectivity.reachableCount", {
										count: data.results.filter(
											(r) =>
												r.group === group &&
												r.samples.some(
													(s) => s.status === "ok" || s.status === "http_error",
												),
										).length,
										total: data.results.filter((r) => r.group === group).length,
									})}
								</span>
							</div>
							<div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{data.results
									.filter((result) => result.group === group)
									.map((result) => (
										<ConnectivityCard
											key={result.id}
											result={result}
											rounds={data.rounds}
                                            onRetest={data.can_run ? () => mutation.mutate(result.id) : undefined}
                                            disabled={!data.online || running || mutation.isPending || cooldown > 0}
										/>
									))}
							</div>
						</div>
					))}
		</section>
	);
}
function ConnectivityCard({
	result,
	rounds,
    onRetest,
    disabled,
}: {
	result: ConnectivityResult;
	rounds: number;
    onRetest?: () => void;
    disabled?: boolean;
}) {
	const { t } = useTranslation();
	const [failedIcon, setFailedIcon] = useState<string>();
	const icon = resolveConnectivityIcon(
		result.icon === undefined ? result.id : result.icon,
	);
	const status =
		result.status === "pending" && result.phase
			? result.phase === "running"
				? "running"
				: result.phase === "queued"
					? "queued"
					: "batch_timeout"
			: result.status;
	const positive = status === "ok";
	const reached = status === "http_error";
	const waiting =
		status === "pending" || status === "queued" || status === "running";
	const codes = [
		...new Set(
			result.samples.map((sample) => sample.http_status).filter(Boolean),
		),
	];
	const delay = result.delay_ms;
	const hasDelay = delay !== undefined && Number.isFinite(delay);
	const stateColor = positive
		? "text-emerald-700 dark:text-emerald-300"
		: reached || status === "unstable"
			? "text-amber-700 dark:text-amber-300"
			: waiting
				? "text-muted-foreground"
				: "text-red-700 dark:text-red-300";
	const detail = [
		!waiting ? t(`connectivity.status.${status}`) : "",
		codes.length ? `HTTP ${codes.join("/")}` : "",
		result.phase === "complete" && result.samples.length < rounds
			? t("connectivity.endedEarly") : "",
	].filter(Boolean).join(" · ");
	return (
		<Card
			data-connectivity-target={result.id}
			data-connectivity-phase={result.phase}
			className={cn("min-w-0 rounded-xl shadow-none", onRetest && !disabled && "cursor-pointer hover:ring-1 hover:ring-primary focus-visible:outline focus-visible:outline-2")}
            role={onRetest ? "button" : undefined}
            tabIndex={onRetest ? 0 : undefined}
            aria-disabled={onRetest ? disabled : undefined}
            aria-label={onRetest ? `${result.name} · ${t("connectivity.retestOne", {defaultValue:"重新检测此项"})}` : undefined}
            onClick={() => {if (!disabled) onRetest?.()}}
            onKeyDown={event=>{if(event.target===event.currentTarget && (event.key==="Enter"||event.key===" ")){event.preventDefault();if(!disabled)onRetest?.()}}}
		>
			<CardContent className="grid min-h-[54px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/95 p-0.5">
					{icon && failedIcon !== icon ? (
						<img
							data-connectivity-icon
							src={icon}
							alt=""
							aria-hidden
							className="size-6 object-contain"
							onError={() => setFailedIcon(icon)}
						/>
					) : (
						<Globe2
							data-connectivity-icon-fallback
							className="size-5 text-slate-500"
							aria-hidden
						/>
					)}
				</span>
				<div className="min-w-0 space-y-1">
					<h4
						className="truncate text-sm font-medium leading-5"
						title={result.name}
					>
						{result.name}
					</h4>
					<div
						className="flex min-w-0 items-center gap-1.5 text-[10px] leading-3"
						title={detail}
					>
						<div
							className="flex shrink-0 items-center gap-1"
							role="img"
							aria-label={t("connectivity.samples", {
								done: result.samples.length,
								total: rounds,
							})}
						>
							{Array.from({ length: rounds }, (_, index) => {
								const sample = result.samples[index];
								const responded =
									sample?.status === "ok" || sample?.status === "http_error";
								return (
									<span
										key={index}
										data-connectivity-sample
										title={
											t("connectivity.sample", { index: index + 1 }) +
											": " +
											t(`connectivity.status.${sample?.status || "pending"}`)
										}
										className={cn(
											"size-1.5 rounded-full",
											!sample
												? "bg-muted-foreground/30"
												: responded
													? "bg-emerald-600 dark:bg-emerald-400"
													: "bg-red-600 dark:bg-red-400",
										)}
									/>
								);
							})}
						</div>
						<ConnectivityMarquee className={stateColor} text={detail}>
							{!positive && !waiting ? t(`connectivity.status.${status}`) : null}
							{codes.length > 0 && (
								<span className="ml-1">(HTTP {codes.join("/")})</span>
							)}
						</ConnectivityMarquee>
						<span className="sr-only">
							{result.samples.length}/{rounds}
							{positive && <span>{t("connectivity.status.ok")}</span>}
							{result.phase === "complete" &&
								result.samples.length < rounds && (
									<span>{t("connectivity.endedEarly")}</span>
								)}
						</span>
					</div>
				</div>
				<p
					data-connectivity-delay
					className={cn(
						"shrink-0 whitespace-nowrap text-base font-semibold leading-5 tabular-nums",
						stateColor,
					)}
				>
					{hasDelay ? (
						<>
							{delay.toFixed(delay < 10 ? 1 : 0)}
							<span className="text-xs">ms</span>
						</>
					) : (
						"—"
					)}
				</p>
			</CardContent>
		</Card>
	);
}