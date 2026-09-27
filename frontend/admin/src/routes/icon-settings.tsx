import ProviderGroupFilter from "@/components/ProviderGroupFilter";
import useLogoGroups from "@/hooks/useLogoGroups";
import {useMemo,useState} from "react";
import {Navigate} from "react-router-dom";
import {SettingsTab} from "@/components/settings-tab";
import {useAuth} from "@/hooks/useAuth";
import useLogoLibrary from "@/hooks/useLogoLibrary";
import {fetcher,FetcherMethod} from "@/api/api";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import Picker from "@/components/LogoChoicePicker";
import LogoEditor from "@/components/LogoEditor";
import SettingHelp from "@/components/SettingHelp";
import {carrierRegions,regionName} from "../../../shared/carrier-regions";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoLibraryEntry} from "../../../shared/logo-library";
const empty=(kind:"provider"|"carrier"):LogoLibraryEntry=>({id:"",kind,name:"",regions:[],aliases:"",background:"",source:"",builtin:false,version:0,logo:"",logoOriginal:"",logoWebsite:""});
export default function IconSettings(){
 const {profile,loading}=useAuth(),{data,error,mutate,isLoading}=useLogoLibrary();
 const {data:groups}=useLogoGroups();const [group,setGroup]=useState("");
 const [kind,setKind]=useState<"provider"|"carrier">("provider"),[query,setQuery]=useState(""),[region,setRegion]=useState(""),[page,setPage]=useState(0),[edit,setEdit]=useState<LogoLibraryEntry|null>(null),[busy,setBusy]=useState(false),[logoBusy,setLogoBusy]=useState(false),[message,setMessage]=useState(""),[failure,setFailure]=useState("");
 const filtered=useMemo(()=>(data||[]).filter(e=>e.kind===kind&&(kind!=="provider"||!group||(group==="_ungrouped"?!e.groupId:e.groupId===group))&&(!region||e.regions.includes(region))&&[e.name,e.aliases,e.logoWebsite,...e.regions.map(regionName)].join(" ").toLowerCase().includes(query.toLowerCase().trim())),[data,kind,region,query,group]);
 const changeFilter=(fn:()=>void)=>{fn();setPage(0)};const locked=busy||logoBusy;
 const save=async()=>{if(!edit||locked)return;setBusy(true);setFailure("");try{const result=await fetcher<{updated_servers?:number}>(edit.id?FetcherMethod.PUT:FetcherMethod.POST,"/api/v1/logo/library"+(edit.id?"/"+edit.id:""),edit);await mutate();setMessage("已保存"+(result?.updated_servers?"，同步更新 "+result.updated_servers+" 台服务器":""));setEdit(null)}catch(e){setFailure(String(e))}finally{setBusy(false)}};
 const remove=async(e:LogoLibraryEntry)=>{if(locked||!window.confirm("删除“"+e.name+"”？已使用它的服务器会保留最后的图标。"))return;setBusy(true);setFailure("");try{await fetcher(FetcherMethod.DELETE,"/api/v1/logo/library/"+e.id,{version:e.version});await mutate();setMessage("已删除，已有服务器的图标保留");setPage(0)}catch(e){setFailure(String(e))}finally{setBusy(false)}};
 if(loading)return null;if(profile?.role!==0)return <Navigate to="/dashboard/settings/api-tokens" replace/>;
 return <div className="px-3 pb-6"><SettingsTab className="mt-6 mb-4 w-full"/><div className="space-y-4" data-icon-settings>
  <div className="flex flex-wrap gap-2 items-center"><h1 className="font-semibold">图标设置</h1><SettingHelp label="图标设置">图标由本站保存和提供。修改后同步已关联服务器；删除条目时，已有服务器保留最后使用的图标。已有收录已导入，后续可自行添加、修改名称和图片。</SettingHelp></div>
  <div className="flex flex-wrap gap-2"><Button variant={kind==="provider"?"default":"outline"} onClick={()=>changeFilter(()=>setKind("provider"))}>服务器厂商</Button><Button variant={kind==="carrier"?"default":"outline"} onClick={()=>changeFilter(()=>setKind("carrier"))}>网络运营商</Button><Button disabled={locked||isLoading||!!error} variant="outline" onClick={()=>{setFailure("");setEdit({...empty(kind),groupId:kind==="provider"&&group!=="_ungrouped"?group:""})}}>添加{kind==="provider"?"厂商":"运营商"}</Button></div>
  {kind==="provider"&&<ProviderGroupFilter value={group} onChange={g=>changeFilter(()=>setGroup(g))} onUpdated={()=>void mutate()}/>}
  <div className="grid gap-2 sm:grid-cols-2"><Input aria-label="搜索图标" placeholder="搜索名称、别名或网址" value={query} onChange={e=>changeFilter(()=>setQuery(e.target.value))}/><Picker value={region} label="筛选国家地区" choices={[{value:"",label:"所有国家/地区"},...carrierRegions.map(r=>({value:r.code,label:r.label,keywords:r.code}))]} onChange={r=>changeFilter(()=>setRegion(r))}/></div>
  {message&&<p role="status" className="text-sm">{message}</p>}{failure&&<p role="alert" className="text-sm text-destructive">{failure}</p>}{error&&<div role="alert">图标库加载失败<Button variant="outline" onClick={()=>void mutate()}>重试</Button></div>}{isLoading&&<p role="status">正在加载图标库…</p>}
  <div className="grid gap-2 lg:grid-cols-2">{filtered.slice(page*40,page*40+40).map(e=><div key={e.id} className="flex min-w-0 items-center gap-3 rounded-md border p-3" data-library-row>
   <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-muted" style={{backgroundColor:e.background||undefined}}>{safeLogoSource(e.logo)?<img src={safeLogoSource(e.logo)} alt="" className="max-h-10 max-w-14 object-contain"/>:<span className="text-xs text-muted-foreground">暂无图标</span>}</div>
   <div className="min-w-0 flex-1"><p className="font-medium break-words">{e.name}</p><p className="text-xs text-muted-foreground break-words">{e.kind==="provider"?(groups?.find(g=>g.id===e.groupId)?.name||"未分组"):(e.regions.map(regionName).join(" / ")||"未指定地区")}</p></div>
   <div className="flex shrink-0 flex-col gap-1 sm:flex-row"><Button disabled={locked} size="sm" variant="outline" aria-label={"修改 "+e.name} onClick={()=>{setFailure("");setEdit({...e,regions:[...e.regions]})}}>修改</Button><Button disabled={locked} size="sm" variant="outline" aria-label={"删除 "+e.name} onClick={()=>void remove(e)}>删除</Button></div>
  </div>)}</div>
  {!isLoading&&!error&&!filtered.length&&<p>暂无匹配图标，可以添加新的{kind==="provider"?"厂商":"运营商"}。</p>}
  <div className="flex items-center justify-between gap-2 text-sm"><span>共 {filtered.length} 项</span><div className="flex gap-2"><Button variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)}>上一页</Button><span className="self-center">{page+1} / {Math.max(1,Math.ceil(filtered.length/40))}</span><Button variant="outline" disabled={(page+1)*40>=filtered.length} onClick={()=>setPage(p=>p+1)}>下一页</Button></div></div>
 </div>{edit&&<Dialog open={!!edit} onOpenChange={open=>{if(!open&&!locked)setEdit(null)}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl" onPointerDownOutside={e=>{if(locked)e.preventDefault()}} onEscapeKeyDown={e=>{if(locked)e.preventDefault()}}><DialogHeader><DialogTitle>{edit?.id?"修改":"添加"}{edit?.kind==="provider"?"厂商图标":"运营商图标"}</DialogTitle></DialogHeader>
 {edit&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void save()}}>
  <label className="block space-y-1"><span>名称</span><Input required maxLength={120} disabled={locked} aria-label="图标名称" placeholder={edit.kind==="provider"?"例如：StarHub / 我的香港云":"例如：中国电信 / HGC"} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label>
  {edit.kind==="provider"&&<Picker value={edit.groupId||""} label="所属厂商分组" disabled={locked} choices={[{value:"",label:"未分组"},...(groups||[]).map(g=>({value:g.id,label:g.name}))]} onChange={g=>setEdit({...edit,groupId:g})}/>}
  <label className="block space-y-1"><span>搜索别名</span><Input disabled={locked} maxLength={2000} aria-label="图标搜索别名" placeholder="可选，例如中文名、简称" value={edit.aliases} onChange={e=>setEdit({...edit,aliases:e.target.value})}/></label>
  <div className="space-y-2"><span>国家/地区</span><div className="flex flex-wrap gap-1">{edit.regions.map(r=><Button key={r} type="button" disabled={locked} size="sm" variant="secondary" onClick={()=>setEdit({...edit,regions:edit.regions.filter(x=>x!==r)})}>{regionName(r)} ×</Button>)}</div><Picker disabled={locked||edit.regions.length>=32} value="" label="添加国家地区" choices={carrierRegions.filter(r=>!edit.regions.includes(r.code)).map(r=>({value:r.code,label:r.label,keywords:r.code}))} onChange={r=>setEdit({...edit,regions:[...edit.regions,r]})}/></div>
  <LogoEditor label="图标库" value={edit} locked={locked} onBusyChange={setLogoBusy} onChange={v=>setEdit(current=>current?{...current,...v}:current)}/>
  {safeLogoSource(edit.logo)&&<div className="flex h-16 items-center justify-center rounded border" style={{backgroundColor:edit.background||undefined}}><img alt="图标预览" src={safeLogoSource(edit.logo)} className="max-h-14 max-w-full object-contain"/></div>}
  <label className="flex items-center gap-2 text-sm">预览底色<input type="color" disabled={locked} aria-label="图标底色" value={edit.background||"#292524"} onChange={e=>setEdit({...edit,background:e.target.value})}/><Button type="button" size="sm" disabled={locked} variant="outline" onClick={()=>setEdit({...edit,background:""})}>透明</Button></label>
  {failure&&<p role="alert" className="text-sm text-destructive">{failure}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={locked} onClick={()=>setEdit(null)}>取消</Button><Button type="submit" disabled={locked||!edit.name.trim()}>{busy?"保存中…":"保存"}</Button></div>
 </form>}</DialogContent></Dialog>}</div>
}
