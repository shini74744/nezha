import { fetchServerMetrics } from "./nezha-api";
import type { MetricType } from "@/types/nezha-api";
import type { DetailPoint } from "./chart-detail";
export type DetailHistorySource = {
 serverId: number;
 metrics: { metric: MetricType; key: string; scale?: number }[];
};
export async function loadDetailHistory(source: DetailHistorySource, signal: AbortSignal): Promise<DetailPoint[]> {
 const responses=await Promise.all(source.metrics.map(({metric})=>fetchServerMetrics(source.serverId,metric,"1d",signal)));
 const series=responses.map((response,i)=>{
  if(!response.success||!Array.isArray(response.data?.data_points))throw new Error("Invalid metric history");
  return new Map(response.data.data_points.filter(p=>Number.isFinite(p.ts)&&p.ts>0).map(p=>[p.ts,typeof p.value==="number"?p.value*(source.metrics[i].scale??1):NaN]));
 });
 const times=[...new Set(series.flatMap(m=>[...m.keys()]))].sort((a,b)=>a-b);
 const keys=[...new Set(source.metrics.map(s=>s.key))];
 return times.map(ts=>{
  const row:DetailPoint={ts};
  for(const key of keys){
   const values=source.metrics.flatMap((s,i)=>s.key===key?[series[i].get(ts)]:[]);
   row[key]=values.length&&values.every(v=>typeof v==="number"&&Number.isFinite(v))?values.reduce<number>((s,v)=>s+(v??0),0):null;
  }
  return row;
 });
}
