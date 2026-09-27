import {useEffect, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useFeature} from "./context";
import "./traffic.css";

type Traffic = {quota_type?:"limited"|"unlimited"|"unset"; name:string; max:number; from:string; to:string; used:number;
 direction:string; partial?:boolean; estimated?:boolean; recorded_from?:number; error?:string};
// The legacy script used binary divisors with GB/TB labels, not decimal SI.
export function formatTraffic(bytes:number) {
 const units=["B","KB","MB","GB","TB","PB"];
 let value=Math.max(0,Number.isFinite(bytes)?bytes:0), index=0;
 if(value===0)return {value:"0",unit:"B"};
 while(value>=1024&&index<units.length-1){value/=1024;index++;}
 return {value:value.toFixed(index===0?0:2),unit:units[index]};
}
export function trafficColor(percent:number) {
 return "hsl("+(120-Math.min(100,Math.max(0,percent))*1.2).toFixed(0)+", 65%, 40%)";
}
function dateLabel(value:string) {
 const date=new Date(value);
 return Number.isNaN(date.getTime())?"":date.toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Asia/Shanghai"});
}
function TrafficRow({serverId,stat,interval}:{serverId:number;stat:Traffic;interval:number}) {
 const [phase,setPhase]=useState(0),[fading,setFading]=useState(false);
 useEffect(()=>{
  setPhase(0);setFading(false);
  if(interval<=0)return;
  let fade:ReturnType<typeof setTimeout>|undefined;
  const timer=setInterval(()=>{
   setFading(true);
   fade=setTimeout(()=>{setPhase(p=>(p+1)%3);setFading(false);},250);
  },interval);
  return ()=>{clearInterval(timer);clearTimeout(fade);};
 },[interval]);
 const limited=stat.max>0,quotaLabel=stat.quota_type==="unlimited"?"无限流量":"未设置配额";
 const used=stat.used,percent=limited?used/stat.max*100:0;
 const color=limited?trafficColor(percent):"#60a5fa",current=formatTraffic(used),total=formatTraffic(stat.max);
 const next=new Date(stat.to);
 const direction=stat.direction==="1"?"仅下载（入站）":stat.direction==="3"?"仅上传（出站）":"上传＋下载";
 const note=(stat.partial?"；历史记录不完整，仅统计已保存数据":"")+(stat.estimated?"；包含小时历史或断线间隔估算":"");
 return <div data-native-traffic={serverId} data-quota-type={limited?"limited":stat.quota_type==="unlimited"?"unlimited":"unset"} className="nz-traffic"
  title={stat.name+"；"+direction+note+"；下次重置："+(Number.isNaN(next.getTime())?"":next.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}))}>
  <div className="nz-traffic-labels">
   <div className="nz-traffic-values">
    <span className="nz-traffic-used" style={{color}}>{stat.partial||stat.estimated?"≈":""}{current.value}</span>
    <span className="nz-traffic-used" style={{color}}>{current.unit}</span>
    <span>/</span>{limited?<><span>{total.value}</span><span>{total.unit}</span></>:<span>{quotaLabel}</span>}
   </div>
   <div className="nz-traffic-info" style={{opacity:fading?0:1}}>
    {phase===0?dateLabel(stat.from)+" - "+dateLabel(stat.to):phase===1?(stat.direction==="3"?"本月上传流量统计":stat.direction==="1"?"本月下载流量统计":"本月双向流量统计"):
     limited?<span style={{color,fontWeight:500}}>{percent.toFixed(2)}%</span>:<span>{quotaLabel}</span>}
   </div>
  </div>
  <div className={"nz-traffic-track"+(limited?"":" nz-traffic-unbounded")} role={limited?"progressbar":"img"} aria-label={limited?stat.name:quotaLabel+"，已用 "+current.value+" "+current.unit}
   aria-valuenow={limited?Math.min(100,Math.max(0,percent)):undefined} aria-valuemin={limited?0:undefined} aria-valuemax={limited?100:undefined}>
   {limited&&<div className="nz-traffic-fill" style={{width:Math.min(100,Math.max(0,percent))+"%",backgroundColor:color}}/>}
  </div>
 </div>;
}
export function NativeTraffic({serverId}:{serverId:number}) {
 const f=useFeature("traffic");
 const {data}=useQuery({
  queryKey:["plan-traffic"],enabled:f.enabled,
  queryFn:async()=>{
   const r=await fetch("/api/v1/server-traffic");
   if(!r.ok)throw Error("Traffic unavailable");
   const body=await r.json();
   if(!body.success)throw Error("Traffic unavailable");
   return (body.data??{}) as Record<string,Traffic>;
  },refetchInterval:30000,retry:1
 });
 if(!f.enabled||!data)return null;
 const stat=data[String(serverId)];
 if(stat?.error)return <div className="text-xs opacity-70" title={stat.error}>套餐流量设置需检查</div>;
 if(!stat||stat.max<0||!Number.isFinite(stat.max)||!Number.isFinite(stat.used))return null;
 return <TrafficRow key={serverId+":"+stat.from} serverId={serverId} stat={stat} interval={f.toggleInterval}/>;
}
