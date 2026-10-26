import { fetchServerMetrics } from "./nezha-api";
import type { MetricType } from "@/types/nezha-api";
import type { DetailPoint } from "./chart-detail";

export type DetailHistorySource = {
 serverId: number;
 metrics: { metric: MetricType; key: string; scale?: number }[];
};

// Fetch all series together. Missing timestamps remain null, not a false zero.
export async function loadDetailHistory(source: DetailHistorySource, signal: AbortSignal): Promise<DetailPoint[]> {
 const responses = await Promise.all(source.metrics.map(({metric}) =>
  fetchServerMetrics(source.serverId, metric, "1d", signal)));
 const rows = new Map<number, DetailPoint>();
 responses.forEach((response, i) => {
  if (!response.success || !Array.isArray(response.data?.data_points)) throw new Error("Invalid metric history");
  const {key,scale=1} = source.metrics[i];
  for (const {ts,value} of response.data.data_points) {
   if (!Number.isFinite(ts) || ts<=0) continue;
   const row=rows.get(ts) ?? {ts,...Object.fromEntries(source.metrics.map(s=>[s.key,null]))};
   row[key]=typeof value==="number" && Number.isFinite(value*scale) ? value*scale : null;
   rows.set(ts,row);
  }
 });
 return [...rows.values()].sort((a,b)=>a.ts-b.ts);
}
