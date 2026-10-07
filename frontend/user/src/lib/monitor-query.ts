import { queryOptions } from "@tanstack/react-query";
import { fetchMonitor, type MonitorPeriod } from "./nezha-api";

export const MONITOR_REFRESH_INTERVAL = 10000;

// Entry preloading and the visible chart share one cache/in-flight request.
// Fresh prefetched data must not immediately trigger a second identical read.
export function monitorQueryOptions(serverId: number, period: MonitorPeriod) {
	return queryOptions({
		queryKey: ["monitor", serverId, period],
		queryFn: () => fetchMonitor(serverId, period),
		staleTime: MONITOR_REFRESH_INTERVAL,
		retry: 1,
	});
}
