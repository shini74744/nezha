import { useQuery } from "@tanstack/react-query";
import { fetchServerMetrics } from "@/lib/nezha-api";
import type { MetricPeriod, MetricType } from "@/types/nezha-api";

export type HistoryPoint = { ts: number; value: number };
export function useMetricHistory(serverId: number, metrics: MetricType[], period: MetricPeriod | "realtime") {
 const enabled = period !== "realtime";
 const query = useQuery({
  queryKey: ["metric-history", serverId, metrics, period],
  enabled,
  queryFn: async ({ signal }) => {
   const responses = await Promise.all(metrics.map(metric => fetchServerMetrics(serverId, metric, period as MetricPeriod, signal)));
   // Validate every series; never display half a successful request as a complete chart.
   return responses.map(response => {
    if (!response.success || !Array.isArray(response.data?.data_points)) throw new Error("Invalid metric history");
    return response.data.data_points;
   });
  },
  staleTime: 30000,
  refetchInterval: enabled ? 30000 : false,
  retry: 1,
  retryDelay: 300,
 });
 return {
  series: enabled && query.isSuccess ? query.data : undefined,
  isLoading: enabled && query.isPending,
  error: enabled && query.isError,
  retry: () => { void query.refetch(); },
 };
}
