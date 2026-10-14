import {useState} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {Button} from "@/components/ui/button";
import {Card,CardContent} from "@/components/ui/card";
import {latencyRequest,fetchLatencySnapshot,type LatencyPoint,type LatencySummary} from "@/lib/latency-api";
import SnapshotTimeline from "./SnapshotTimeline";
import {fetchLoginUser} from "@/lib/nezha-api";
import type {ConnectivityResult} from "@/lib/connectivity-api";
import {formatDetectionTime} from "@/lib/detection-time";
export function latencyColor(value?:number){
 if(value===undefined||!Number.isFinite(value))return "bg-muted text-muted-foreground";
 if(value<=40)return "bg-emerald-700 text-white";
 if(value<=80)return "bg-emerald-500 text-black";
 if(value<=120)return "bg-green-500 text-black";
 if(value<=180)return "bg-green-300 text-black";
 if(value<=240)return "bg-yellow-300 text-black";
 if(value<=320)return "bg-orange-400 text-black";
 return "bg-red-400 text-black";
}
function delay(value?:number){return value===undefined||!Number.isFinite(value)?"—":Math.round(value)+" ms"}
function state(value:string){return ({pending:"未检测",running:"检测中",ok:"正常",timeout:"超时",agent_timeout:"超时",batch_timeout:"超时",dns_error:"解析失败",query_disabled:"检测已关闭",offline:"节点离线",refused:"连接被拒绝",unreachable:"无法连接",unstable:"不稳定"} as Record<string,string>)[value]||"失败"}
function date(value?:number){return value?formatDetectionTime(value):"暂无记录"}
export default function ServerLatency({serverId}:{serverId:number}){
 const [carrier,setCarrier]=useState("最速"),[selected,setSelected]=useState<string>(),[page,setPage]=useState(0);
 const [family,setFamily]=useState("IPv4"),[snapshotAt,setSnapshotAt]=useState(0);
 const member=useQuery({queryKey:["login-user"],queryFn:fetchLoginUser,retry:0,staleTime:30000});
 const viewer=member.isError?0:member.data?.data?.id||0;
 const client=useQueryClient(),key=["server-latency",serverId,viewer];
 const query=useQuery({queryKey:key,queryFn:({signal})=>latencyRequest(serverId,"GET",undefined,signal),refetchInterval:q=>q.state.data?.state==="running"?2000:15000,refetchIntervalInBackground:false,retry:1});
 const mutation=useMutation({mutationFn:()=>latencyRequest(serverId,"POST"),onSuccess:async data=>{await client.cancelQueries({queryKey:key});client.setQueryData(key,data)},onError:()=>{void query.refetch()}});
 const live=query.data,running=live?.state==="running";
 const snapshot=useQuery({queryKey:["latency-snapshot",serverId,viewer,snapshotAt],queryFn:({signal})=>fetchLatencySnapshot(serverId,snapshotAt,signal),enabled:snapshotAt>0&&!query.isError,retry:1});
 const data=snapshotAt?snapshot.data:running&&live?.latest?live.latest:live;
 const liveFamilies=live?.available_families?.length?live.available_families:["IPv4"];
 // Historical families remain viewable even when the current node loses a stack.
 const recordedFamilies:string[]=snapshotAt?(snapshot.data?.results||[]).map(r=>r.family||"IPv4"):[];
 const families=["IPv4","IPv6"].filter(f=>liveFamilies.includes(f)||recordedFamilies.includes(f));
 const activeFamily=families.includes(family)?family:families[0];
 const history=useQuery({queryKey:["latency-history",serverId,viewer,selected,data?.finished_at],queryFn:({signal})=>latencyRequest<LatencyPoint[]>(serverId,"GET",selected,signal),enabled:!!selected&&!snapshotAt&&!query.isError,retry:1});
 if(query.isError)return <Card><CardContent className="p-4"><p role="alert">无法读取延迟记录</p><Button variant="outline" onClick={()=>void query.refetch()}>重试</Button></CardContent></Card>;
 if(!live)return <p role="status" className="p-4 text-sm">正在读取延迟…</p>;
 const results=(data?.results||[]).filter(r=>(r.family||"IPv4")===activeFamily),groups=[...new Set(results.map(r=>r.group))],carriers=["最速",...new Set(results.map(r=>r.icon||"其他"))];
 const provinces=new Set(results.map(r=>r.group+":"+r.name)),available=new Set(results.filter(r=>r.delay_ms!==undefined).map(r=>r.group+":"+r.name));
 const choose=(items:ConnectivityResult[])=>{
  const filtered=carrier==="最速"?items:items.filter(r=>r.icon===carrier);
  return [...filtered].sort((a,b)=>(a.delay_ms??Infinity)-(b.delay_ms??Infinity))[0];
 };
 const chosen=results.find(r=>r.id===selected);
 const summaries:LatencySummary[]=(live.history||[]).filter(s=>(s.scheduled_at||0)>0);
 const latest=running&&live.latest?live.latest:live;
 if((latest.scheduled_at||0)>0&&latest.finished_at&&!summaries.some(s=>s.finished_at===latest.finished_at))summaries.push({finished_at:latest.finished_at,scheduled_at:latest.scheduled_at});
 summaries.sort((a,b)=>b.finished_at-a.finished_at);
 const switchSnapshot=(at:number)=>{setSnapshotAt(at);setSelected(undefined);setPage(0)};
 return <Card data-server-latency><CardContent className="p-4 sm:p-5 space-y-4">
  <div className="grid min-w-0 grid-cols-2 items-center gap-x-3 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]" data-latency-header>
   <div className="col-start-1 col-span-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pr-24 sm:col-span-1 sm:pr-0">
    <h2 className="text-base font-semibold whitespace-nowrap">地区延迟</h2>
    <div className="inline-flex rounded-full bg-muted/60 p-1" aria-label="IP 版本">{families.map(f=><button type="button" key={f} aria-pressed={activeFamily===f} onClick={()=>{setFamily(f);setSelected(undefined);setPage(0)}} className={"min-h-8 rounded-full px-2.5 text-xs "+(activeFamily===f?"bg-background shadow-sm":"text-muted-foreground")}>{f}</button>)}</div>
   </div>
   <div className={"col-start-1 row-start-2 flex min-w-0 max-w-full flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground sm:col-span-1 sm:row-start-1 sm:col-start-2 sm:justify-self-center "+(summaries.length?"col-span-1":"col-span-2")} data-latency-summary>
    <p className="whitespace-nowrap">TCP · {available.size}/{provinces.size} 地区可用</p>
    <p>{snapshotAt?"检测时间":"最近检测"}：<span className="sm:whitespace-nowrap">{date(data?.finished_at||Math.max(0,...results.map(r=>r.checked_at||0)))}</span></p>
   </div>
   {live.can_run&&<Button className="col-start-2 row-start-1 justify-self-end self-start sm:col-start-3" size="sm" variant="outline" disabled={!live.online||running||mutation.isPending||(live.retry_at||0)>Date.now()} onClick={()=>{switchSnapshot(0);mutation.mutate()}}>{!live.online?"节点离线":running?"检测中…":mutation.isPending?"正在开始…":"立即检测"}</Button>}

   <div className="col-start-1 col-span-2 row-start-3 flex min-w-0 flex-wrap gap-1 rounded-2xl bg-muted/60 p-1 w-fit sm:col-span-1 sm:row-start-2" aria-label="运营商筛选">{carriers.map(c=><button key={c} type="button" aria-pressed={carrier===c} onClick={()=>{setCarrier(c);setSelected(undefined);setPage(0)}} className={"min-h-9 rounded-xl px-3 text-sm "+(carrier===c?"bg-background shadow-sm":"text-muted-foreground")}>{c}</button>)}</div>
   {!!summaries.length&&<div className="col-start-2 row-start-2 min-w-0 w-full sm:col-span-2" data-latency-snapshots>
    <SnapshotTimeline inlineControls label="延迟历史快照">{summaries.map((item,i)=><button key={item.finished_at} type="button" onClick={()=>switchSnapshot(item.finished_at)} aria-pressed={snapshotAt===item.finished_at||(!snapshotAt&&(latest.scheduled_at||0)>0&&latest.finished_at===item.finished_at)} className={"shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-xs max-sm:w-full max-sm:whitespace-normal max-sm:px-2 "+((snapshotAt===item.finished_at||(!snapshotAt&&(latest.scheduled_at||0)>0&&latest.finished_at===item.finished_at))?"border-blue-500 bg-blue-50 dark:bg-blue-950":"")}>
     <span title={"实际完成："+date(item.finished_at)}>{formatDetectionTime(item.scheduled_at||item.finished_at,!!item.scheduled_at)}</span>
     <span className="mt-1 block text-[10px] text-muted-foreground sm:text-xs">{i===0?"最新快照":"历史快照"} · 北京时间</span>
    </button>)}</SnapshotTimeline>
   </div>}
  </div>
  {snapshotAt>0&&snapshot.isPending&&<p role="status" className="text-sm">正在读取快照…</p>}
  {snapshotAt>0&&snapshot.isError&&<p role="alert" className="text-sm text-destructive">快照不存在、已过期或暂时无法读取。<button className="ml-2 underline" onClick={()=>void snapshot.refetch()}>重试</button><button className="ml-2 underline" onClick={()=>switchSnapshot(0)}>返回最新</button></p>}
  {mutation.isError&&<p role="alert" className="text-sm text-destructive">未能开始检测，请稍后重试。</p>}
  {running&&<p role="status" className="text-xs text-muted-foreground">检测中 · {live.results.filter(r=>r.phase==="complete").length}/{live.results.length}{snapshotAt?" · 正在查看历史快照":live.latest?" · 下方为上次结果":""}</p>}
  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" aria-label="延迟颜色标尺">{[40,80,120,180,240,320].map(v=><div key={v} className="text-center text-[11px] text-muted-foreground"><div className={"mb-1 h-2 rounded-full "+latencyColor(v)}/>{v} ms</div>)}</div>
  {data&&!results.length&&<p className="text-sm text-muted-foreground">{snapshotAt?"本次快照没有该 IP 版本的检测记录":"暂无该 IP 版本的检测地址"}</p>}
  <div className="space-y-4">{groups.map(group=>{
   const names=[...new Set(results.filter(r=>r.group===group).map(r=>r.name))];
   return <section key={group}><h3 className="mb-2 text-sm font-semibold">{group}</h3><div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">{names.map(name=>{
    const r=choose(results.filter(r=>r.group===group&&r.name===name));if(!r)return null;
    return <button key={name} type="button" onClick={()=>{setSelected(r.id);setPage(0)}} aria-pressed={selected===r.id} className={"min-w-0 min-h-16 rounded-2xl p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring "+latencyColor(r.delay_ms)+(selected===r.id?" ring-2 ring-ring ring-offset-2 ring-offset-background":"")}><span className="block truncate text-sm font-semibold">{name}</span>{(carrier!=="最速"||(typeof r.delay_ms==="number"&&Number.isFinite(r.delay_ms)))&&<span data-latency-carrier className="block truncate text-[10px] opacity-80">{r.icon}</span>}<span className="block text-xs font-semibold">{r.delay_ms===undefined?state(r.status):delay(r.delay_ms)}</span></button>
   })}</div></section>
  })}</div>
  {chosen&&<section className="border-t pt-3 space-y-2" aria-label="延迟记录">
   <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{chosen.name} · {chosen.icon}</h3><button type="button" onClick={()=>setSelected(undefined)} className="text-xs underline min-h-8">收起记录</button></div>
   <p className="text-xs text-muted-foreground break-all">{chosen.host}</p>
   <p className="text-xs">最近结果：{delay(chosen.delay_ms)} · {state(chosen.status)} · {chosen.samples.filter(s=>s.delay_ms!==undefined).length}/{chosen.samples.length} 次成功</p>
   {snapshotAt?<p className="text-xs text-muted-foreground">当前为所选快照的检测结果</p>:history.isPending?<p role="status" className="text-xs">正在读取历史…</p>:history.isError?<p role="alert" className="text-xs">历史读取失败 <button onClick={()=>void history.refetch()} className="underline">重试</button></p>:!history.data?.length?<p className="text-xs text-muted-foreground">暂无历史记录</p>:<>
    <div className="space-y-1">{history.data.slice(page*20,page*20+20).map(p=><div key={p.at} className="flex flex-wrap justify-between gap-2 border-b py-2 text-xs"><time dateTime={new Date(p.at).toISOString()}>{date(p.at)}</time><span>{delay(p.delay_ms)} · {state(p.status)}</span></div>)}</div>
    <div className="flex items-center justify-end gap-2 text-xs"><Button size="sm" variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)}>上一页</Button>{page+1}<Button size="sm" variant="outline" disabled={(page+1)*20>=history.data.length} onClick={()=>setPage(p=>p+1)}>下一页</Button></div>
   </>}
  </section>}
 </CardContent></Card>;
}
