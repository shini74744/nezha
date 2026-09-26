import {useEffect,useState} from "react";
import {Navigate} from "react-router-dom";
import useSetting from "@/hooks/useSetting";
import {toast} from "sonner";
import {fetcher,FetcherMethod} from "@/api/api";
import {useAuth} from "@/hooks/useAuth";
import {SettingsTab} from "@/components/settings-tab";
import {AppearanceSection} from "@/components/appearance-section";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Switch} from "@/components/ui/switch";
import {Button} from "@/components/ui/button";
import {dashboardDefinitions,normalizeDashboard,validateDashboard,importDashboardCode,type DashboardAppearance} from "@/lib/dashboard-appearance";
type State={config:DashboardAppearance;revision:string;custom_code:string;archived_code:string};
export default function DashboardAppearancePage(){
 const {mutate}=useSetting();
 const {profile,loading}=useAuth(),[saved,setSaved]=useState<State>(),[config,setConfig]=useState(()=>normalizeDashboard());
 const [source,setSource]=useState(""),[imported,setImported]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const adopt=(s:State)=>{setSaved(s);setConfig(normalizeDashboard(s.config));setSource(s.custom_code||s.archived_code||"");setImported("");setError("")};
 const load=()=>fetcher<State>(FetcherMethod.GET,"/api/v1/setting/dashboard-appearance").then(adopt).catch(e=>setError(String(e)));
 useEffect(()=>{if(profile?.role===0)void load()},[profile?.role]);
 const dirty=!!saved&&(!!imported||JSON.stringify(config)!==JSON.stringify(normalizeDashboard(saved.config))),validation=validateDashboard(config);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};addEventListener("beforeunload",warn);return()=>removeEventListener("beforeunload",warn)},[dirty]);
 if(loading)return null;if(profile?.role!==0)return <Navigate to="/dashboard/settings/api-tokens" replace/>;
 const update=(group:string,key:string,value:unknown)=>setConfig(c=>({...c,features:{...c.features,[group]:{...c.features[group],[key]:value}}}));
 const readSource=()=>{try{if(saved?.custom_code&&source!==saved.custom_code)throw Error("当前仍有仪表板自定义代码，请先读取现有代码，避免覆盖");const next=importDashboardCode(source);setConfig(next);setImported(source);toast.info("配置已读取，保存时备份原代码并停用旧脚本。")}catch(e){toast.error(String(e))}};
 const exportSource=()=>{const value=saved?.archived_code||saved?.custom_code||source;if(!value)return;const url=URL.createObjectURL(new Blob([value],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="nezha-dashboard-custom-code-backup.html";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 const save=async()=>{
  if(!saved||validation)return;
  if(config.enabled&&saved.custom_code&&!imported&&!confirm("原仪表板自定义代码仍在运行，可能重复生效。建议先读取迁移。继续保存？"))return;
  setBusy(true);try{
   const next=await fetcher<State>(FetcherMethod.PATCH,"/api/v1/setting/dashboard-appearance",{revision:saved.revision,config,...(imported?{expected_custom_code:saved.custom_code,remaining_custom_code:"",source_code:imported}:{})});
   adopt(next);await mutate();toast.success("后台美化设置已保存");
  }catch(e){toast.error(String(e).includes("changed")?"配置已变化，请重新读取后再保存。":"保存失败："+String(e))}finally{setBusy(false)}
 };
 return <div className="space-y-6 p-4"><SettingsTab/><h1 className="text-2xl font-semibold">后台美化设置</h1>
  <div className="rounded-lg border bg-card p-4 space-y-3"><p>仅作用于后台，与前台美化独立保存。字体、背景、品牌、点击特效、Ping/TCPing/Ping0 和时间转换均由面板内置。</p>
   <label className="flex items-center gap-3"><Switch aria-label="启用后台美化" checked={config.enabled} onCheckedChange={enabled=>setConfig(c=>({...c,enabled}))}/>启用后台美化</label>
   <details><summary className="cursor-pointer">读取以前的仪表板自定义代码</summary><div className="space-y-3 pt-3">
    <p className="text-sm text-muted-foreground">只读取 NZ_DASHBOARD_CONFIG 中的静态配置，不执行粘贴的脚本；未知扩展不会自动丢弃。保存迁移时归档原代码。</p>
    <Textarea aria-label="原仪表板自定义代码" rows={8} value={source} onChange={e=>setSource(e.target.value)}/>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!source.trim()} onClick={readSource}>读取旧代码配置</Button><Button type="button" variant="outline" disabled={!source&&!saved?.archived_code} onClick={exportSource}>导出旧代码备份</Button></div>
   </div></details>{imported&&<p className="text-amber-600">待保存：已读取原参数，旧代码将备份并停止执行。</p>}
  </div>
  {error&&<p role="alert" className="text-red-500">{error}</p>}
  {saved&&dashboardDefinitions.map(d=><AppearanceSection key={d.key} title={d.title} description="点击展开设置；右侧开关独立控制此功能。" enabled={config.features[d.key].enabled} onEnabledChange={v=>update(d.key,"enabled",v)}>
   <div className="grid gap-4 sm:grid-cols-2">{Object.entries(d.defaults).filter(([key])=>key!=="enabled").map(([key,sample])=>{
    const label=(d.labels as unknown as Record<string,string>)[key],value=config.features[d.key][key];
    if(typeof sample==="boolean")return <label key={key} className="flex items-center justify-between gap-3"><span>{label}</span><Switch aria-label={label} checked={value} onCheckedChange={v=>update(d.key,key,v)}/></label>;
    const choices=d.key==="background"?({size:["cover","contain","auto"],repeat:["no-repeat","repeat","repeat-x","repeat-y","space","round"],attachment:["fixed","scroll","local"]} as Record<string,string[]>)[key]:undefined;
    return <label key={key} className="block space-y-1"><span>{label}</span>{choices?<select aria-label={label} className="w-full rounded border bg-background p-2" value={value} onChange={e=>update(d.key,key,e.target.value)}>{choices.map(v=><option key={v}>{v}</option>)}</select>:<Input aria-label={label} type={typeof sample==="number"?"number":"text"} step={key==="shatterCount"?1:0.01} value={value} onChange={e=>update(d.key,key,typeof sample==="number"?Number(e.target.value):e.target.value)}/>}</label>;
   })}</div>
  </AppearanceSection>)}
  <div className="sticky bottom-0 bg-background border-t py-3 flex flex-wrap items-center gap-3"><Button disabled={!saved||busy||!dirty||!!validation} onClick={()=>void save()}>{busy?"保存中…":"保存后台美化设置"}</Button><Button variant="outline" disabled={busy} onClick={()=>{if(!dirty||confirm("放弃未保存修改？"))void load()}}>重新读取</Button>{validation&&<p role="alert" className="text-red-500 text-sm">{validation}</p>}</div>
 </div>;
}
