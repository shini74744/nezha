import { lazy, Suspense, useState } from "react";
import dayjs from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import AnimatedCircularProgressBar from "@/components/ui/animated-circular-progress-bar";
import { Separator } from "@/components/ui/separator";
import ServerDetailOverview from "@/components/ServerDetailOverview";
import { PeriodSelector } from "@/components/ServerDetailChart";
import TabSwitch from "@/components/TabSwitch";
import NetworkChartLoading from "@/components/NetworkChartLoading";
import { fetchLoginUser, fetchServerMetrics } from "@/lib/nezha-api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { snapshotInterval } from "@/lib/snapshot-interval";
import type { MetricDataPoint, MetricPeriod, MetricType, NezhaServer } from "@/types/nezha-api";
const NetworkChart=lazy(()=>import("@/components/NetworkChart").then(m=>({default:m.NetworkChart})));
export interface LastReport {
 snapshot?: {at:number;host?:Partial<NezhaServer["host"]>;state:Partial<NezhaServer["state"]>;country_code?:string}; snapshot_seconds?:number;
 server_id:number; tsdb_enabled:boolean; history_days:number; last_report_at?:number;
 metrics:Record<string,number>; recent:Record<string,MetricDataPoint[]>;
}
export function elapsedText(ms:number) {
 const seconds=Math.max(0,Math.floor(ms/1000)), days=Math.floor(seconds/86400);
 return (days?days+" 天 ":"")+Math.floor(seconds%86400/3600)+" 小时 "+Math.floor(seconds%3600/60)+" 分 "+seconds%60+" 秒";
}
function dateText(ms:number) {return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");}
const groups=[
 {title:"CPU",keys:["cpu"],labels:["CPU"],unit:"percent",colors:[1]},
 {title:"内存",keys:["memory","swap"],labels:["内存","虚拟内存"],unit:"bytes",colors:[8,10]},
 {title:"磁盘",keys:["disk"],labels:["磁盘"],unit:"bytes",colors:[5]},
 {title:"进程数",keys:["process_count"],labels:["进程"],unit:"number",colors:[2]},
 {title:"网络速率",keys:["net_out_speed","net_in_speed"],labels:["上传","下载"],unit:"speed",colors:[1,10]},
 {title:"连接数",keys:["tcp_conn","udp_conn"],labels:["TCP","UDP"],unit:"number",colors:[1,10]},
];
function valueText(value:number|undefined,unit:string) {
 if(value===undefined||!Number.isFinite(value))return "无记录";
 if(unit==="bytes")return formatBytes(value);
 if(unit==="speed")return formatBytes(value)+"/s";
 if(unit==="percent")return value.toFixed(2)+"%";
 return Number.isInteger(value)?String(value):value.toFixed(2);
}
export function OfflineServerDetail({server,now}:{server:NezhaServer;now:number}) {
 const [tab,setTab]=useState("Detail"),[period,setPeriod]=useState<"last"|MetricPeriod>("last");
 const member=useQuery({queryKey:["login-user"],queryFn:fetchLoginUser,retry:0,staleTime:30000});
 const viewer=member.isError?0:member.data?.data?.id||0;
 const query=useQuery({
  queryKey:["server-last-report",server.id,viewer],
  queryFn:async({signal})=>{
   const response=await fetch("/api/v1/server/"+server.id+"/last-report",{signal});
   const body=await response.json();
   if(!response.ok||!body.success)throw new Error(body.error||"读取失败");
   return body.data as LastReport;
  },refetchInterval:30000,staleTime:10000,retry:1,
 });
 const report=query.data,last=report?.last_report_at;
 const saved=report?.snapshot;
 const snapshotServer:NezhaServer|undefined=saved?{...server,last_active:new Date(saved.at).toISOString(),country_code:saved.country_code||"",host:{platform:"",platform_version:"",cpu:[],gpu:[],mem_total:0,disk_total:0,swap_total:0,arch:"",boot_time:0,version:"",...saved.host},state:{cpu:0,mem_used:0,swap_used:0,disk_used:0,net_in_transfer:0,net_out_transfer:0,net_in_speed:0,net_out_speed:0,uptime:0,load_1:0,load_5:0,load_15:0,tcp_conn_count:0,udp_conn_count:0,process_count:0,temperatures:[],gpu:[],...saved.state}}:undefined;
 const chartGroups=[...groups,...(period==="last"||!report?.tsdb_enabled?saved?.state.gpu||[]:[]).map((_,i)=>({title:saved?.host?.gpu?.[i]||"GPU #"+(i+1),keys:["gpu_"+i],labels:["GPU"],unit:"percent",colors:[5]}))];
 const activePeriod=!report?.tsdb_enabled?"last":!viewer&&(period==="7d"||period==="30d")?"1d":period;
 return <div className="mx-auto w-full max-w-5xl px-0 flex flex-col gap-4 server-info" data-offline-detail>
  <ServerDetailOverview server_id={String(server.id)} recorded={{at:last,metrics:report?.metrics||{},elapsed:last?elapsedText(now-last):"未知",server:snapshotServer}}/>
  {query.isPending?<p className="text-xs text-muted-foreground" role="status">正在读取最后上报记录…</p>:query.isError?
   <p className="text-xs" role="alert">最后上报记录读取失败。<button className="underline ml-2" onClick={()=>query.refetch()}>重试</button></p>:
   !last?<div className="text-xs text-muted-foreground" data-offline-empty>
    <p>暂无可用的最后上报记录，无法确定掉线时间和掉线前状态。</p>
    <p>{!report?.tsdb_enabled?"历史存储未启用。":report.history_days===1?"游客仅可查看最近 1 天的历史；登录后可查询最近 30 天。":"最近 30 天内未找到记录，或记录已超过配置的保留期限。"}未保存的数据不能补回。</p>
   </div>:null}
  <section className="flex items-center my-2 w-full">
   <Separator className="flex-1"/><div className="flex justify-center w-full max-w-50"><TabSwitch tabs={["Detail","Network"]} currentTab={tab} setCurrentTab={setTab}/></div><Separator className="flex-1"/>
  </section>
  {tab==="Network"?<Suspense fallback={<NetworkChartLoading/>}><NetworkChart server_id={server.id} show/></Suspense>:
   (report?.tsdb_enabled||saved)?<section>
    <PeriodSelector selectedPeriod={activePeriod==="last"?"realtime":activePeriod} onPeriodChange={p=>setPeriod(p==="realtime"?"last":p)} isLogin={!!viewer} isTsdbEnabled={!!report?.tsdb_enabled} offline/>
    <p className="text-xs text-muted-foreground mb-3">{saved?"离线前最后 1 分钟的完整记录；已冻结保存，非实时数据。":"旧历史记录未保存完整主机信息和总容量；该机器重新上线后会自动补齐快照。"}</p>
    <div className="grid md:grid-cols-2 lg:grid-cols-3 grid-cols-1 gap-3 server-charts">
     {chartGroups.map(group=><OfflineMetricCard key={group.title} group={group} report={report!} period={activePeriod}/>)}
    </div>
   </section>:null}
 </div>;
}
function MetricHeader({group,report}:{group:typeof groups[number];report:LastReport}) {
 const metrics=report.metrics,host=report.snapshot?.host;
 const value=metrics[group.keys[0]];
 const capacities:Record<string,number|undefined>={memory:host?.mem_total,swap:host?.swap_total,disk:host?.disk_total};
 const percent=(key:string,i:number)=>{const value=metrics[key+"_percent"];return <span className="flex items-center gap-2 text-xs font-medium">{value!==undefined?<><AnimatedCircularProgressBar className="size-3 text-[0px]" max={100} min={0} value={value} primaryColor={"hsl(var(--chart-"+group.colors[i]+"))"}/><span data-recorded-percent={key}>{value.toFixed(0)}%</span></>:"—"}</span>};
 if(group.unit==="bytes")return <div className="flex items-center justify-between gap-2">
  {group.keys.length===1?<p className="text-md font-medium">{group.title}</p>:<section className="flex items-center gap-4">{group.labels.map((label,i)=><div key={label}><p className="text-xs text-muted-foreground">{label}</p>{percent(group.keys[i],i)}</div>)}</section>}
  <section className="flex flex-col items-end gap-0.5">{group.keys.length===1&&percent(group.keys[0],0)}{group.keys.map(key=><p key={key} className="text-[11px] font-medium" title="已用容量 / 总容量">{key==="swap"&&host&&!(host.swap_total||0)&&metrics.swap===0?"no swap":valueText(metrics[key],"bytes")+" / "+(capacities[key]?formatBytes(capacities[key]!):"未知")}</p>)}</section>
 </div>;
 if(group.keys.length>1)return <section className="flex items-center gap-4">{group.keys.map((key,i)=><div key={key}>
  <p className="text-xs text-muted-foreground">{group.labels[i]}</p><p className="flex items-center gap-1 text-xs font-medium"><span className="size-1.5 rounded-full" style={{backgroundColor:"hsl(var(--chart-"+group.colors[i]+"))"}}/>{valueText(metrics[key],group.unit)}</p>
 </div>)}</section>;
 return <div className="flex items-center justify-between"><p className="text-md font-medium">{group.title}</p><section className="flex items-center gap-2"><p className="text-xs text-end font-medium">{valueText(value,group.unit)}</p>
  {group.unit==="percent"&&value!==undefined&&<AnimatedCircularProgressBar className="size-3 text-[0px]" max={100} min={0} value={value} primaryColor="hsl(var(--chart-1))"/>}
 </section></div>;
}
function OfflineMetricCard({group,report,period}:{group:typeof groups[number];report:LastReport;period:"last"|MetricPeriod}) {
 const history=useQuery({
  queryKey:["offline-history",report.server_id,period,group.keys],
  enabled:period!=="last",
  queryFn:async()=>{
   const entries=await Promise.all(group.keys.map(async key=>{
    const response=await fetchServerMetrics(report.server_id,key as MetricType,period as MetricPeriod);
    if(!response.success)throw new Error("历史记录读取失败");
    return [key,response.data.data_points||[]] as const;
   }));
   return Object.fromEntries(entries);
  },retry:1,staleTime:30000,
 });
 const percentChart=period==="last"&&group.unit==="bytes"&&!!report.recent[group.keys[0]+"_percent"]?.length;
 const unit=percentChart?"percent":group.unit;
 const keys=group.keys.map(key=>percentChart?key+"_percent":key);
 const series=period==="last"?report.recent:history.data||{};
 const merged=new Map<number,Record<string,number|null>>();
 for(const key of keys)for(const point of series[key]||[]) {
  const row=merged.get(point.ts)||{ts:point.ts};row[key]=point.value;merged.set(point.ts,row);
 }
 const sorted=[...merged.values()].sort((a,b)=>Number(a.ts)-Number(b.ts));
 const data:Record<string,number|null>[]=[];
 const interval=period==="last"&&report.snapshot?snapshotInterval(sorted.map(row=>Number(row.ts))):period==="7d"?1800000:period==="30d"?7200000:30000;
 for(const row of sorted) {
  const prev=data[data.length-1];
  if(prev&&Number(row.ts)-Number(prev.ts)>interval*2)data.push({ts:Number(prev.ts)+interval,...Object.fromEntries(keys.map(k=>[k,null]))});
  data.push(row);
 }
 const config=Object.fromEntries(keys.map((key,i)=>[key,{label:group.labels[i],color:"hsl(var(--chart-"+group.colors[i]+"))"}]));
 return <Card className={cn({"bg-card/70":!!window.CustomBackgroundImage})}><CardContent className="px-6 py-3"><section className="flex flex-col gap-1">
  <MetricHeader group={group} report={report}/>
  {period!=="last"&&history.isPending?<p className="h-[130px] flex items-center justify-center text-xs">正在读取历史记录…</p>:
   history.isError&&period!=="last"?<p className="h-[130px] flex items-center justify-center text-xs" role="alert">历史记录读取失败</p>:
   !data.length?<p className="h-[130px] flex items-center justify-center text-xs text-muted-foreground">该时间范围没有记录</p>:
   <ChartContainer config={config} className="aspect-auto h-[130px] w-full" data-recorded-chart>
    <AreaChart syncId="offlineDetailCharts" accessibilityLayer data={data} margin={{top:12,left:12,right:12}}>
     <CartesianGrid vertical={false}/>
     <XAxis dataKey="ts" type="number" domain={["dataMin","dataMax"]} tickLine={false} axisLine={false} tickMargin={8} minTickGap={200} interval="preserveStartEnd" tickFormatter={v=>dayjs(Number(v)).format(period==="last"?"HH:mm":"MM-DD HH:mm")}/>
     <YAxis tickLine={false} axisLine={false} mirror tickMargin={-15} domain={unit==="percent"?[0,100]:[0,"auto"]} tickFormatter={v=>unit==="percent"?v+"%":valueText(v,unit).replace(/\s/g,"")}/>
     <ChartTooltip isAnimationActive={false} content={<ChartTooltipContent indicator="dot" labelFormatter={(_,payload)=>dateText(Number(payload[0]?.payload?.ts))} formatter={(value,name)=><div className="flex flex-1 items-center justify-between leading-none"><span className="text-muted-foreground">{config[String(name)]?.label}</span><span className="ml-2 font-medium text-foreground tabular-nums">{valueText(Number(value),unit)}</span></div>}/>}/>
     {keys.map((key,i)=><Area key={key} dataKey={key} type="step" stroke={"hsl(var(--chart-"+group.colors[i]+"))"} fill={"hsl(var(--chart-"+group.colors[i]+"))"} fillOpacity={0.3} dot={data.length===1} connectNulls={false} isAnimationActive={false}/>)}
    </AreaChart>
   </ChartContainer>}
 </section></CardContent></Card>;
}
