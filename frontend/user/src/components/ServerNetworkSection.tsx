import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchSetting } from "@/lib/nezha-api";
import NetworkChartLoading from "./NetworkChartLoading";
import { Separator } from "./ui/separator";

const NetworkChart = lazy(() =>
	import("./NetworkChart").then((module) => ({ default: module.NetworkChart })),
);

// Both views use one chart instance, so changing tabs preserves its filters
// and never creates a second polling request.
export default function ServerNetworkSection({
	server_id, standalone,
}: { server_id: number; standalone: boolean }) {
	const { t } = useTranslation();
	const { data } = useQuery({
		queryKey: ["setting"],
		queryFn: fetchSetting,
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
