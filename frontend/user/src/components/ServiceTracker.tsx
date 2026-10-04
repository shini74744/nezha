import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { fetchService } from "@/lib/nezha-api";
import type { NezhaServer, ServiceData } from "@/types/nezha-api";
import { CycleTransferStatsCard, getCycleTransferRows } from "./CycleTransferStats";
import { Loader } from "./loading/Loader";
import ServiceTrackerClient from "./ServiceTrackerClient";

function processServiceData(serviceData: ServiceData) {
	const days = serviceData.up.map((up, index) => {
		const totalChecks = up + serviceData.down[index];
		const dailyUptime = totalChecks > 0 ? (up / totalChecks) * 100 : 0;
		return {
			completed: up > serviceData.down[index],
			date: new Date(Date.now() - (29 - index) * 24 * 60 * 60 * 1000),
			uptime: dailyUptime,
			delay: serviceData.delay[index] || 0,
		};
	});

	const totalUp = serviceData.up.reduce((a, b) => a + b, 0);
	const totalChecks =
		serviceData.up.reduce((a, b) => a + b, 0) +
		serviceData.down.reduce((a, b) => a + b, 0);
	const uptime = totalChecks > 0 ? (totalUp / totalChecks) * 100 : 0;

	const avgDelay =
		serviceData.delay.length > 0
			? serviceData.delay.reduce((a, b) => a + b, 0) / serviceData.delay.length
			: 0;

	return { days, uptime, avgDelay };
}


export function ServiceTracker({ serverList, view = "uptime", onClose }: {
	serverList: NezhaServer[]; view?: "traffic" | "uptime" | "both"; onClose?: () => void;
}) {
	const { t } = useTranslation();
	const { data: serviceData, isLoading, isError, refetch, isFetching } = useQuery({
		queryKey: ["service"], queryFn: fetchService,
		refetchOnMount: true, refetchOnWindowFocus: true, refetchInterval: 10000, retry: false,
	});
	const serviceSummaries = useMemo(() =>
		Object.entries(serviceData?.data?.services ?? {}).map(([name, data]) => ({
			...processServiceData(data), name, title: data.service_name,
		})), [serviceData?.data?.services]);
	const cycleStats = serviceData?.data?.cycle_transfer_stats ?? {};
	const hasTraffic = getCycleTransferRows(serverList, cycleStats).length > 0;
	const views = view === "both" ? ["traffic", "uptime"] as const : [view];
	return <>{views.map((sectionView, index) => {
		const empty = sectionView === "traffic" ? !hasTraffic : serviceSummaries.length === 0;
		return (
		<section key={sectionView} className="mt-4 w-full min-w-0" data-statistics-view={sectionView}
			aria-label={t("statistics." + sectionView)}>
			<div className="mb-3 flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-sm font-semibold">{t("statistics." + sectionView)}</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">{t("statistics." + sectionView + "Hint")}</p>
				</div>
				{onClose && index === 0 && <button type="button" onClick={onClose} aria-label={t("statistics.close")}
					className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-card text-card-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2">
					<XMarkIcon className="size-4" aria-hidden="true" />
				</button>}
			</div>
			{isLoading ? (
				<div role="status" className="rounded-xl border bg-card p-5 text-sm flex items-center gap-2">
					<Loader visible />{t("serviceTracker.loading")}
				</div>
			) : isError && !serviceData ? (
				<div role="status" className="rounded-xl border bg-card p-5 text-sm flex flex-wrap items-center gap-3">
					<ExclamationTriangleIcon className="size-4 shrink-0" />
					<span>{t("statistics.error")}</span>
					<button type="button" disabled={isFetching} onClick={() => void refetch()}
						className="min-h-10 rounded-lg border px-3 hover:bg-accent">{t("statistics.retry")}</button>
				</div>
			) : empty ? (
				<p role="status" className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
					{t(sectionView === "traffic" ? "statistics.emptyTraffic" : "statistics.emptyUptime")}
				</p>
			) : sectionView === "traffic" ? (
				<CycleTransferStatsCard serverList={serverList} cycleStats={cycleStats} />
			) : (
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
					{serviceSummaries.map(({name, ...summary}) => <ServiceTrackerClient key={name} {...summary} />)}
				</div>
			)}
		</section>
	);
	})}</>;
}
export default ServiceTracker;
