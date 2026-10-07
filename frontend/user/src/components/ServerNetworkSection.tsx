import { lazy, memo, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchSetting } from "@/lib/nezha-api";
import NetworkChartLoading from "./NetworkChartLoading";
import { Separator } from "./ui/separator";

import { loadNetworkChart } from "@/lib/detail-modules";

const NetworkChart = lazy(loadNetworkChart);

// Both views use one chart instance, so changing tabs preserves its filters
// and never creates a second polling request.
function ServerNetworkSection({
	server_id, standalone,
}: { server_id: number; standalone: boolean }) {
	const { t } = useTranslation();
	const { data } = useQuery({
		queryKey: ["setting"],
		queryFn: fetchSetting,
		// The detail shell already observes settings; tab mounts must not start a duplicate refresh.
		refetchOnMount: false,
		refetchOnWindowFocus: true,
		refetchInterval: 30000,
	});
	// No optimistic default: a disabled or not-yet-loaded setting must not flash.
	if (!standalone && data?.data?.config?.show_network_in_detail !== true) return null;
	return (
		<section data-server-network aria-label={t("tabSwitch.Network")} className="min-w-0 w-full">
			{!standalone && (
				<div className="mb-8 flex items-center gap-3">
					<h2 className="shrink-0 text-sm font-semibold">{t("tabSwitch.Network")}</h2>
					<Separator className="flex-1" />
				</div>
			)}
			<Suspense fallback={<NetworkChartLoading />}>
				<NetworkChart key={server_id} server_id={server_id} show />
			</Suspense>
		</section>
	);
}

export default memo(ServerNetworkSection);
