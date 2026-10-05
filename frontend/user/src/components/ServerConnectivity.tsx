import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
	CheckCircle2,
	CircleHelp,
	Clock3,
	Globe2,
	LoaderCircle,
	RefreshCw,
	ShieldAlert,
	WifiOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
	fetchConnectivity,
	startConnectivity,
	type ConnectivityResult,
} from "@/lib/connectivity-api";
import { cn } from "@/lib/utils";

export default function ServerConnectivity({ serverId }: { serverId: number }) {
	const { t, i18n } = useTranslation();
	const client = useQueryClient();
	const key = ["server-connectivity", serverId];
	const [now, setNow] = useState(Date.now());
	const [help, setHelp] = useState(false);
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
		mutationFn: () => startConnectivity(serverId),
		onSuccess: async (data) => {
			await client.cancelQueries({ queryKey: key });
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
	const data = query.data;
	const running = data?.state === "running";
	const cooldown = Math.max(0, Math.ceil(((data?.retry_at || 0) - now) / 1000));
	const completed =
		data?.results.filter(
			(result) => !["pending", "running"].includes(result.status),
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
			<Card className="min-w-0">
				<CardContent className="p-4 sm:p-5 space-y-3">
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
							<p className="mt-1 text-xs text-muted-foreground">
								{t("connectivity.origin")}
							</p>
						</div>
						{data?.can_run && (
							<Button
								size="sm"
								variant="outline"
								type="button"
								disabled={
									!data.online ||
									running ||
									mutation.isPending ||
									cooldown > 0 ||
									query.isError
								}
								onClick={() => mutation.mutate()}
								className="shrink-0 gap-2"
							>
								{running || mutation.isPending ? (
									<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
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
								{!data.can_run && (
									<p className="text-xs text-muted-foreground">
										{t("connectivity.readOnly")}
									</p>
								)}
								<div
									className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
									role="status"
									aria-live="polite"
								>
									<span>
										{running
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
											{t("connectivity.time")}:{" "}
											{formatDate(data.finished_at || data.started_at)}
										</span>
									)}
									<span>
										{t("connectivity.rounds", { count: data.rounds })}
									</span>
								</div>
								{running && (
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
			{!query.isError &&
				data &&
				["global", "china"].map((group) => (
					<div key={group} className="space-y-2">
						<h3 className="text-xs font-medium text-muted-foreground">
							{t("connectivity." + group)}
						</h3>
						<div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3">
							{data.results
								.filter((result) => result.group === group)
								.map((result) => (
									<ConnectivityCard
										key={result.id}
										result={result}
										rounds={data.rounds}
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
}: {
	result: ConnectivityResult;
	rounds: number;
}) {
	const { t } = useTranslation();
	const status = result.status;
	const positive = status === "ok",
		reached = status === "http_error";
	const waiting = status === "pending" || status === "running";
	const Icon = positive
		? CheckCircle2
		: reached || status === "unstable"
			? ShieldAlert
			: waiting
				? Clock3
				: WifiOff;
	const codes = [
		...new Set(
			result.samples.map((sample) => sample.http_status).filter(Boolean),
		),
	];
	const delay = result.delay_ms;
	return (
		<Card data-connectivity-target={result.id} className="min-w-0">
			<CardContent className="space-y-3 p-4">
				<div className="flex min-w-0 items-start gap-2.5">
					<span
						className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
						aria-hidden
					>
						{result.name.slice(0, 1)}
					</span>
					<div className="min-w-0">
						<h4 className="truncate text-sm font-semibold" title={result.name}>
							{result.name}
						</h4>
						<p
							className="truncate text-[11px] text-muted-foreground"
							title={result.host}
						>
							{result.host}
						</p>
					</div>
				</div>
				<div
					className={cn(
						"flex items-start gap-1.5 text-xs leading-5",
						positive
							? "text-emerald-700 dark:text-emerald-300"
							: reached || status === "unstable"
								? "text-amber-700 dark:text-amber-300"
								: waiting
									? "text-muted-foreground"
									: "text-red-700 dark:text-red-300",
					)}
				>
					<Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
					<span>
						{t("connectivity.status." + status)}
						{codes.length > 0 && (
							<span className="ml-1">(HTTP {codes.join("/")})</span>
						)}
					</span>
				</div>
				<div className="flex items-end justify-between gap-2">
					<p className="font-mono text-xl font-semibold tabular-nums">
						{delay !== undefined && Number.isFinite(delay) ? (
							<>
								{delay.toFixed(delay < 10 ? 1 : 0)}
								<span className="ml-1 text-xs font-normal text-muted-foreground">
									ms
								</span>
							</>
						) : (
							<span className="text-muted-foreground">—</span>
						)}
					</p>
					<span className="text-[11px] text-muted-foreground">
						{result.samples.length}/{rounds}
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
