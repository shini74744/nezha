import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useEffect, useState } from "react"
type Policy={enabled:boolean;interval_hours:number;retention_days:number;revision:string}
const endpoint="/api/v1/setting/connectivity/automation"
export default function ConnectivityAutomationSettings(){
 const [saved,setSaved]=useState<Policy>(),[draft,setDraft]=useState<Policy>()
 const [busy,setBusy]=useState(false),[error,setError]=useState("")
 const load=async()=>{setError("");try{const p=await fetcher<Policy>(FetcherMethod.GET,endpoint);setSaved(p);setDraft(p)}catch{setError("读取自动检测设置失败")}}
 useEffect(()=>{void load()},[])
 const invalid=!draft||!Number.isInteger(draft.interval_hours)||draft.interval_hours<1||draft.interval_hours>24||!Number.isInteger(draft.retention_days)||draft.retention_days<1||draft.retention_days>30
 const save=async()=>{
  if(!draft||invalid||busy)return
  setBusy(true);setError("")
  try{const p=await fetcher<Policy>(FetcherMethod.PUT,endpoint,draft);setSaved(p);setDraft(p)}
  catch(e){setError("保存自动检测设置失败："+String(e))}
  finally{setBusy(false)}
 }
 return <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="自动检测设置">
  <h2 className="font-semibold">自动检测与记录</h2>
  <p className="text-xs text-muted-foreground">连通性、BGP、流媒体共用此间隔与保留时间，各自遵循服务器编辑中的开关。只自动检测在线节点并分批错开；连通性与流媒体由节点 Agent 发起，BGP 查询节点公网 IP 的 RIPE 路由观测。访客只读，重启后记录仍保留。</p>
  {error&&<div role="alert" className="text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={()=>void load()} disabled={busy}>重新读取设置</Button></div>}
  {draft?<><div className="grid gap-4 sm:grid-cols-3">
   <label className="flex items-center justify-between gap-3 text-sm">自动检测<Switch aria-label="自动检测" checked={draft.enabled} disabled={busy} onCheckedChange={enabled=>setDraft({...draft,enabled})}/></label>
   <label className="text-sm space-y-1"><span>检测间隔（小时）</span><Input aria-label="检测间隔（小时）" type="number" min={1} max={24} value={draft.interval_hours} disabled={busy} onChange={e=>setDraft({...draft,interval_hours:Number(e.target.value)})}/></label>
   <label className="text-sm space-y-1"><span>记录保留（天）</span><Input aria-label="记录保留（天）" type="number" min={1} max={30} value={draft.retention_days} disabled={busy} onChange={e=>setDraft({...draft,retention_days:Number(e.target.value)})}/></label>
  </div><div className="flex flex-wrap items-center justify-between gap-3">
   <p className="text-xs text-muted-foreground">默认每 2 小时检测、保留 1 天；连通性每项 3 次，流媒体按协议各检测一次。缩短保留时间后，超期记录将被清理。</p>
   <Button disabled={busy||invalid||JSON.stringify(saved)===JSON.stringify(draft)} onClick={()=>void save()}>{busy?"保存中…":"保存自动检测设置"}</Button>
  </div></>:!error&&<p role="status">正在读取自动检测设置…</p>}
 </section>
}
