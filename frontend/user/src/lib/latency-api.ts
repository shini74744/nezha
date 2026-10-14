import type { ConnectivityData, ConnectivitySnapshot } from "./connectivity-api";
export type LatencyPoint={at:number;delay_ms?:number;status:string};
export type LatencySummary={finished_at:number;scheduled_at?:number};
export interface LatencyData extends ConnectivityData {available_families?:string[];history?:LatencySummary[]}
export async function latencyRequest<T=LatencyData>(serverId:number,method="GET",target?:string,signal?:AbortSignal,snapshotAt?:number):Promise<T>{
 const raw=document.cookie.split("; ").find(c=>c.startsWith("nz-csrf="))?.slice(8)||"";
 let csrf="";try{csrf=decodeURIComponent(raw)}catch{}
 const suffix=snapshotAt?"/snapshots/"+snapshotAt:target?"/history/"+encodeURIComponent(target):"";
 const response=await fetch("/api/v1/server/"+serverId+"/latency"+suffix,{method,signal,cache:"no-store",headers:method==="POST"?{"X-CSRF-Token":csrf}:undefined});
 const body=await response.json();if(!response.ok||!body.success)throw new Error(body.error||"读取延迟失败");
 // Empty target history is omitted by the API envelope; React Query cannot accept undefined.
 if(target&&body.data==null)return [] as T;
 if(body.data==null)throw new Error("读取延迟失败");
 return body.data;
}
export const fetchLatencySnapshot=(serverId:number,at:number,signal?:AbortSignal)=>latencyRequest<ConnectivitySnapshot>(serverId,"GET",undefined,signal,at);
