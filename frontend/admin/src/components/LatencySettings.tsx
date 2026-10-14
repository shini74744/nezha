import { useEffect, useState } from "react"
import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
type Target={id:string;region:string;province:string;carrier:string;host:string;ipv6_host?:string;port:number;enabled:boolean}
type Settings={enabled:boolean;interval_hours:number;retention_days:number;targets:Target[];revision:string}
const endpoint="/api/v1/setting/latency"
const normalize=(s:Settings):Settings=>({...s,targets:s.targets.map(t=>({...t,ipv6_host:t.ipv6_host??(t.host===t.id+"-v4.ip.zstaticcdn.com"?t.id+"-v6.ip.zstaticcdn.com":t.host.includes(":")?t.host:"")}))})
export default function LatencySettings(){
 const [saved,setSaved]=useState<Settings>(),[draft,setDraft]=useState<Settings>()
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[search,setSearch]=useState("")
 const load=async()=>{setBusy(true);setError("");try{const s=await fetcher<Settings>(FetcherMethod.GET,endpoint);if(!s||!Array.isArray(s.targets)||typeof s.revision!=="string")throw new Error("设置响应无效");const next=normalize(s);setSaved(next);setDraft(next)}catch(e){setError("读取失败："+String(e))}finally{setBusy(false)}}
 useEffect(()=>{void load()},[])
 const dirty=JSON.stringify(saved)!==JSON.stringify(draft)
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn)},[dirty])
 const patch=(id:string,value:Partial<Target>)=>setDraft(s=>s?{...s,targets:s.targets.map(t=>t.id===id?{...t,...value}:t)}:s)
 const invalid=!draft||!Number.isInteger(draft.interval_hours)||draft.interval_hours<1||draft.interval_hours>24||!Number.isInteger(draft.retention_days)||draft.retention_days<1||draft.retention_days>30||draft.targets.some(t=>!t.host.trim()||!t.region.trim()||!t.province.trim()||!t.carrier.trim()||!Number.isInteger(t.port)||t.port<1||t.port>65535)
 const save=async()=>{if(!draft||invalid)return;setBusy(true);setError("");try{const s=await fetcher<Settings>(FetcherMethod.PUT,endpoint,draft);const next=normalize(s);setSaved(next);setDraft(next)}catch(e){setError("保存失败："+String(e))}finally{setBusy(false)}}
 return <div className="max-w-5xl space-y-4" data-latency-settings>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {!draft?<Button disabled={busy} onClick={()=>void load()}>{busy?"正在读取…":"重新读取"}</Button>:<>
   <section className="rounded-lg border bg-card px-4 py-3 space-y-3">
    <h2 className="font-semibold">自动检测与记录</h2>
    <div className="grid grid-cols-2 items-center gap-3 sm:flex sm:flex-wrap sm:gap-4">
     <label className="col-span-2 flex items-center justify-between gap-3 text-sm sm:justify-start">自动检测<Switch aria-label="延迟自动检测" disabled={busy} checked={draft.enabled} onCheckedChange={enabled=>setDraft({...draft,enabled})}/></label>
     <label className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">检测间隔（小时）<Input aria-label="延迟检测间隔（小时）" type="number" min={1} max={24} className="h-9 w-full sm:w-20" disabled={busy} value={draft.interval_hours} onChange={e=>setDraft({...draft,interval_hours:Number(e.target.value)})}/></label>
     <label className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">记录保留（天）<Input aria-label="延迟记录保留（天）" type="number" min={1} max={30} className="h-9 w-full sm:w-20" disabled={busy} value={draft.retention_days} onChange={e=>setDraft({...draft,retention_days:Number(e.target.value)})}/></label>
    </div>
   </section>
   <section className="rounded-lg border bg-card px-4 py-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">检测地址 · {draft.targets.length}</h2><Button size="sm" variant="outline" disabled={busy||draft.targets.length>=128} onClick={()=>setDraft({...draft,targets:[...draft.targets,{id:crypto.randomUUID(),region:"其他",province:"新地区",carrier:"其他",host:"",port:80,enabled:true}]})}>添加地址</Button></div>
    <p className="text-xs text-muted-foreground">默认地址来自 <a className="underline" href="https://www.zstaticcdn.com/" target="_blank" rel="noreferrer">Zstatic</a>，检测 TCP 连接延迟。关闭或删除地址后不再检测。</p>
    <Input aria-label="筛选检测地址" placeholder="地区、运营商或地址" value={search} onChange={e=>setSearch(e.target.value)}/>
    <div className="max-h-[55vh] overflow-y-auto space-y-2">
     {draft.targets.filter(t=>[t.region,t.province,t.carrier,t.host,t.ipv6_host||""].join(" ").toLowerCase().includes(search.toLowerCase())).map(t=><details key={t.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm break-words">{t.province} · {t.carrier}<span className="ml-2 text-xs text-muted-foreground">{t.enabled?"已启用":"已停用"}</span><span className="block mt-1 break-all text-xs text-muted-foreground">{t.host||"待填写"}:{t.port}</span></summary>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
       {(["region","province","carrier","host"] as const).map((key,i)=><label key={key} className={"text-xs space-y-1 "+(key==="host"?"col-span-2":"")}>{["区域","地区","运营商","IPv4 地址"][i]}<Input aria-label={t.id+" "+key} disabled={busy} value={t[key]} maxLength={key==="host"?253:32} onChange={e=>patch(t.id,{[key]:e.target.value})}/></label>)}
       <label className="col-span-2 text-xs space-y-1">IPv6 地址<Input aria-label={t.id+" ipv6_host"} disabled={busy} value={t.ipv6_host??(t.host===t.id+"-v4.ip.zstaticcdn.com"?t.id+"-v6.ip.zstaticcdn.com":"")} maxLength={253} placeholder="留空则不检测 IPv6" onChange={e=>patch(t.id,{ipv6_host:e.target.value})}/></label>
       <label className="text-xs space-y-1">端口<Input aria-label={t.id+" 端口"} disabled={busy} type="number" min={1} max={65535} value={t.port} onChange={e=>patch(t.id,{port:Number(e.target.value)})}/></label>
      </div>
      <div className="mt-3 flex items-center justify-between"><label className="inline-flex items-center gap-2 text-xs">启用<Switch aria-label={t.id+" 启用"} disabled={busy} checked={t.enabled} onCheckedChange={enabled=>patch(t.id,{enabled})}/></label><Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={()=>{if(window.confirm("删除这个检测地址？保存后生效。"))setDraft({...draft,targets:draft.targets.filter(v=>v.id!==t.id)})}}>删除地址</Button></div>
     </details>)}
    </div>
   </section>
   <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>{if(!dirty||window.confirm("放弃未保存的修改？"))void load()}}>重新加载</Button><Button disabled={busy||!dirty||invalid} onClick={()=>void save()}>{busy?"保存中…":"保存延迟设置"}</Button></div>
  </>}
 </div>
}
