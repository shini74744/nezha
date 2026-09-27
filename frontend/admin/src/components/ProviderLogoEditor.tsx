import {useState} from "react";
import LogoEditor from "./LogoEditor";
import SettingHelp from "./SettingHelp";
import {safeLogoSource} from "../../../shared/other-routes";
import type {PublicNote} from "@/lib/public-note";
export default function ProviderLogoEditor({note,onChange}:{note:PublicNote;onChange:(note:PublicNote)=>void}){
 const value=note.planDataMod?.providerLogo||{},src=safeLogoSource(value.logo),[dimensions,setDimensions]=useState({src:"",width:0,height:0});
 return <fieldset className="space-y-2 sm:col-span-2" data-provider-logo-editor><legend className="text-xs font-medium">服务器厂商 Logo<SettingHelp label="服务器厂商 Logo">显示在服务器名称上方，居中、等比例适配，不裁切、不放大小图。清晰度取决于原图分辨率，建议使用至少 64×64 的图标；长条 Logo 建议高度至少 56 像素。</SettingHelp></legend>
  <LogoEditor label="服务器厂商" value={value} onChange={providerLogo=>onChange({...note,planDataMod:{...note.planDataMod,providerLogo}})}/>
  {src&&<div className="flex items-center gap-2"><div className="inline-flex items-center justify-center rounded border p-2 bg-stone-500/20" style={{width:98,height:46}}><img src={src} alt="厂商 Logo 预览" referrerPolicy="no-referrer" onLoad={e=>setDimensions({src,width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} style={{width:"auto",height:"auto",maxWidth:80,maxHeight:28,objectFit:"scale-down"}}/></div>
   {dimensions.src===src&&<span className="text-xs text-muted-foreground">{dimensions.width}×{dimensions.height}{dimensions.height<56?" · 小尺寸原图":""}</span>}</div>}
 </fieldset>;
}
