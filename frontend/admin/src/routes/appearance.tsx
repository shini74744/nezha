import {fetcher, FetcherMethod} from "@/api/api"
import {SettingsTab} from "@/components/settings-tab"
import {BackgroundSettings} from "@/components/background-settings"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Switch} from "@/components/ui/switch"
import {Textarea} from "@/components/ui/textarea"
import {useAuth} from "@/hooks/useAuth"
import {useEffect,useState} from "react"
import {Navigate} from "react-router-dom"
import {toast} from "sonner"
import {definitions,normalize,validate,AppearanceConfig,Feature} from "@/lib/appearance-config"
import {readAppearance} from "@/lib/appearance"
import {legacyFingerprint} from "@/lib/appearance-migration"
type State={config:AppearanceConfig;custom_code:string;revision:string;current_template:string}
export default function AppearancePage(){
 const {profile,loading}=useAuth()
 const [saved,setSaved]=useState<State>()
 const [config,setConfig]=useState<AppearanceConfig>(normalize())
 const [migrate,setMigrate]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState("")
 const adopt=(value:State)=>{setSaved(value);setConfig(normalize(value.config));setMigrate(false);setError("")}
 const load=()=>fetcher<State>(FetcherMethod.GET,"/api/v1/setting/appearance").then(adopt).catch(e=>setError(String(e)))
 useEffect(()=>{if(profile?.role===0)void load()},[profile?.role])
 const dirty=!!saved&&(migrate||JSON.stringify(config)!==JSON.stringify(normalize(saved.config)))
 const validation=validate(config)
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn)},[dirty])
 if(loading)return null
 if(profile?.role!==0)return <Navigate to="/dashboard/settings/api-tokens" replace/>
 const patch=(key:string,value:Feature)=>setConfig(c=>({...c,features:{...c.features,[key]:value}}))
 const update=(group:string,key:string,value:unknown)=>patch(group,{...config.features[group],[key]:value})
 const exportCode=()=>{if(!saved)return;const u=URL.createObjectURL(new Blob([saved.custom_code],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=u;a.download="nezha-original-custom-code.html";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
 const importLegacy=async()=>{
  if(!saved)return
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(saved.custom_code))),b=>b.toString(16).padStart(2,"0")).join("")
  if(hash!==legacyFingerprint){toast.error("当前自定义代码与已核对版本不同，不能安全自动替换。原代码保持不变。");return}
  const old=readAppearance(saved.custom_code).config
  const next=normalize(config);next.enabled=true
  if(old){for(const k of ["sponsor","video","analytics"])if(old[k])next.features[k]={...next.features[k],...old[k]};for(const k of ["heart","sakura","live2d","stars"])next.features[k].enabled=!!old.effects?.[k]}
  setConfig(next);setMigrate(true);toast.info("已读入原有配置。保存时会归档原始代码并启用内置功能，避免重复加载。")
 }
 const save=async()=>{
  if(!saved||validation)return
  if(config.enabled&&saved.custom_code&&!migrate&&!window.confirm("现有自定义代码仍会执行，可能与内置功能重复。确认继续保存？"))return
  setBusy(true)
  try{
   const value=await fetcher<State>(FetcherMethod.PATCH,"/api/v1/setting/appearance",{revision:saved.revision,config,...(migrate?{expected_custom_code:saved.custom_code,remaining_custom_code:""}:{})})
   adopt(value);toast.success("美化设置已保存，请刷新默认主题前台查看")
  }catch(e){toast.error(String(e).includes("changed")?"配置已被其他页面修改，请重新读取后再保存。":"保存失败："+String(e))}
  finally{setBusy(false)}
 }
 const renderField=(group:string,key:string,value:any)=>{
  const d=definitions.find(d=>d.key===group)!,label=d.labels[key]||key
  if(typeof value==="boolean")return <label key={key} className="flex items-center justify-between gap-3"><span>{label}</span><Switch checked={value} onCheckedChange={v=>update(group,key,v)}/></label>
  if(Array.isArray(value)){
   const sample=(d.defaults[key] as any[])[0]
   if(typeof sample==="string")return <label key={key} className="block space-y-1 sm:col-span-2"><span>{label}（每行一项）</span><Textarea value={value.join("\n")} onChange={e=>update(group,key,e.target.value.split("\n").filter(Boolean))}/></label>
   const columns=Object.keys(sample||{})
   return <div key={key} className="sm:col-span-2 space-y-2"><p>{label}</p>{value.map((row:any,i:number)=><div key={i} className="rounded border p-3 space-y-2">
    {columns.map(field=><label key={field} className="block space-y-1"><span>{({name:"名称",url:"链接",link:"链接",logo:"Logo 图片",src:"资源地址",type:"类型"} as Record<string,string>)[field]||field}</span>
      {field==="type"?<select className="w-full rounded border bg-background p-2" value={row[field]} onChange={e=>update(group,key,value.map((r:any,j:number)=>i===j?{...r,[field]:e.target.value}:r))}><option value="image">图片</option><option value="video">视频</option></select>:
      <Input value={row[field]??""} onChange={e=>update(group,key,value.map((r:any,j:number)=>i===j?{...r,[field]:e.target.value}:r))}/>}</label>)}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={i===0} onClick={()=>{const n=[...value];[n[i-1],n[i]]=[n[i],n[i-1]];update(group,key,n)}}>上移</Button><Button type="button" variant="outline" size="sm" onClick={()=>update(group,key,value.filter((_:any,j:number)=>j!==i))}>移除</Button></div>
   </div>)}<Button type="button" variant="outline" onClick={()=>update(group,key,[...value,Object.fromEntries(columns.map(c=>[c,c==="type"?"image":""]))])}>添加</Button></div>
  }
  return <label key={key} className="block min-w-0 space-y-1"><span>{label}</span><Input type={typeof value==="number"?"number":"text"} step="any" min={d.constraints[key]?.[0]} max={d.constraints[key]?.[1]} value={value??""} onChange={e=>update(group,key,typeof value==="number"?Number(e.target.value):e.target.value)}/></label>
 }
 return <div className="space-y-6"><SettingsTab/><h1 className="text-2xl font-semibold">美化设置</h1>
 <div className="rounded-lg border p-4 space-y-3"><p>仅默认主题生效。切换其他主题不会加载这些功能，配置会保留；切回默认主题恢复生效。</p>
 <p className="text-sm text-muted-foreground">功能代码随面板内置，不依赖 jm/xjs 外链，也没有域名授权限制。图片、视频、字体及统计/IP 服务仍可能需要联网。</p>
 {saved?.current_template&&saved.current_template!=="user-dist"&&<p className="text-amber-600">当前不是默认主题，保存配置不会影响当前前台。</p>}
 <label className="flex items-center gap-3"><Switch aria-label="启用内置美化" checked={config.enabled} onCheckedChange={enabled=>setConfig(c=>({...c,enabled}))}/>启用内置美化</label>
 {saved?.custom_code&&<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={importLegacy}>迁移已核对的原有美化</Button><Button variant="outline" onClick={exportCode}>导出原始代码备份</Button></div>}
 {migrate&&<p className="text-amber-600">本次保存将归档原始美化代码并停止旧脚本执行，避免与内置功能重复。</p>}
 </div>
 {error&&<p role="alert" className="text-red-500">{error}</p>}
 {saved&&definitions.filter(d=>d.key!=="video").map(d=><section key={d.key} className="rounded-lg border p-4 space-y-4"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{d.title}</h2><p className="text-sm text-muted-foreground">{d.description}</p></div><Switch aria-label={d.title} checked={config.features[d.key].enabled} onCheckedChange={v=>update(d.key,"enabled",v)}/></div>
 {d.key==="background"?<BackgroundSettings value={config.features.background} sound={config.features.video} onChange={value=>patch("background",value)} onSoundChange={value=>patch("video",value)}/>:Object.keys(d.defaults).length>1&&<div className="grid gap-4 sm:grid-cols-2">{Object.entries(config.features[d.key]).filter(([key])=>key!=="enabled").map(([key,v])=>renderField(d.key,key,v))}</div>}</section>)}
 <div className="sticky bottom-0 bg-background border-t py-3 flex flex-wrap items-center gap-3"><Button disabled={!saved||busy||!dirty||!!validation} onClick={save}>{busy?"保存中…":"保存美化设置"}</Button><Button variant="outline" disabled={busy} onClick={()=>{if(!dirty||window.confirm("放弃未保存修改并重新读取？"))void load()}}>重新读取</Button>{validation&&<p role="alert" className="text-sm text-red-500">{validation}</p>}</div>
 </div>
}
