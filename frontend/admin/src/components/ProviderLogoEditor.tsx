import useLogoGroups from "@/hooks/useLogoGroups";
import ProviderLayoutEditor from "./ProviderLayoutEditor";
import {useId,useState} from "react";
import {Button} from "./ui/button";
import LogoEditor from "./LogoEditor";
import Picker from "./LogoChoicePicker";
import SettingHelp from "./SettingHelp";
import useLogoLibrary from "@/hooks/useLogoLibrary";
import {libraryLogo} from "../../../shared/logo-library";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
import type {PublicNote} from "@/lib/public-note";
type ProviderLogoProps={note:PublicNote;onChange:(note:PublicNote)=>void;serverId?:number;name?:string};
export default function ProviderLogoEditor(props:ProviderLogoProps){
 const [expanded,setExpanded]=useState(false),contentId=useId();
 return <fieldset className="min-w-0 space-y-2 sm:col-span-2" data-provider-logo-editor>
  <legend className="text-xs font-medium"><button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(v=>!v)} className="inline-flex cursor-pointer items-center gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"><span aria-hidden>{expanded?"▾":"▸"}</span>服务器厂商 Logo</button><SettingHelp label="服务器厂商 Logo">在图标库按名称搜索选择，修改库条目后自动同步；删除库条目会保留最后图标。桌面默认以到期进度条的实际左右边界为宽度范围并居中；无到期信息时保留同起点的 70px 区域，手机在 CPU 与内存标题上方区域显示。图片等比例适配、不裁切；默认不放大小图，手动放大不会提高原图清晰度。</SettingHelp></legend>
  {expanded&&<div id={contentId}><ProviderLogoFields {...props}/></div>}
 </fieldset>;
}
function ProviderLogoFields({note,onChange,serverId,name}:{note:PublicNote;onChange:(note:PublicNote)=>void;serverId?:number;name?:string}){
 const {data:groups}=useLogoGroups(),[group,setGroup]=useState(""),[adjusting,setAdjusting]=useState(false),adjustmentId=useId();
 const {data:library,error}=useLogoLibrary(),[busy,setBusy]=useState(false),[dimensions,setDimensions]=useState({src:"",width:0,height:0});
 const saved=note.planDataMod?.providerLogo||{},selected=library?.find(e=>e.id===saved.logoLibraryId),value=selected?{...saved,...libraryLogo(selected)}:saved,src=safeLogoSource(value.logo);
 const change=(providerLogo:LogoValue)=>onChange({...note,planDataMod:{...note.planDataMod,providerLogo:{...providerLogo,logoLayout:providerLogo.logoLayout??saved.logoLayout}}});
 const choices=[{value:"",label:"不显示厂商图标"},{value:"manual",label:"自行填写 / 上传"},...(library||[]).filter(e=>e.kind==="provider"&&(!group||(group==="_ungrouped"?!e.groupId:e.groupId===group))).map(e=>({value:e.id,label:e.name,keywords:e.aliases+" "+e.logoWebsite+" "+(groups?.find(g=>g.id===e.groupId)?.name||""),icon:safeLogoSource(e.logo),background:e.background}))];
 if(saved.logoLibraryId&&!choices.some(e=>e.value===saved.logoLibraryId))choices.push({value:saved.logoLibraryId,label:saved.logoLibraryName||"已保存的厂商"});
 return <div className="min-w-0 space-y-2" data-provider-logo-content>
  <Picker disabled={busy} value={group} label="筛选厂商分组" choices={[{value:"",label:"全部分组"},{value:"_ungrouped",label:"未分组"},...(groups||[]).map(g=>({value:g.id,label:g.name}))]} onChange={setGroup}/>
  <Picker disabled={busy} value={saved.logoLibraryId||(src?"manual":"")} label="选择服务器厂商" choices={choices} onChange={id=>{const entry=library?.find(e=>e.id===id);change(entry?libraryLogo(entry):id==="manual"?{...value,logoLibraryId:"",logoLibraryName:""}:{})}}/>
  {error&&<p role="alert" className="text-xs text-destructive">图标库暂时无法加载，已有图标保留。</p>}
  <LogoEditor key={saved.logoLibraryId||"manual"} label="服务器厂商" value={value} locked={busy} onBusyChange={setBusy} onChange={v=>change({...v,logoLibraryId:"",logoLibraryName:""})}/>
  {src&&<div className="flex flex-wrap items-center gap-2"><div className="inline-flex items-center justify-center rounded border p-2 bg-stone-500/20" style={{width:98,height:46,backgroundColor:value.logoBackground||undefined}}><img src={src} alt="厂商 Logo 预览" referrerPolicy="no-referrer" onLoad={e=>setDimensions({src,width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} style={{width:"auto",height:"auto",maxWidth:80,maxHeight:28,objectFit:"scale-down"}}/></div>
  {dimensions.src===src&&<span className="text-xs text-muted-foreground">{dimensions.width}×{dimensions.height}{dimensions.height<56?" · 小尺寸原图":""}</span>}<Button type="button" size="sm" variant="outline" aria-expanded={adjusting} aria-controls={adjustmentId} onClick={()=>setAdjusting(v=>!v)}>卡片调整</Button></div>}
  {src&&adjusting&&<div id={adjustmentId}><ProviderLayoutEditor note={{...note,planDataMod:{...note.planDataMod,providerLogo:value}}} onChange={onChange} serverId={serverId} name={name}/></div>}
 </div>;
}