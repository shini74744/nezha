import LogoEditor from "./LogoEditor";
import {safeLogoSource} from "../../../shared/other-routes";
import type {PublicNote} from "@/lib/public-note";
export default function ProviderLogoEditor({note,onChange}:{note:PublicNote;onChange:(note:PublicNote)=>void}){
 const value=note.planDataMod?.providerLogo||{},src=safeLogoSource(value.logo);
 return <fieldset className="space-y-2 sm:col-span-2" data-provider-logo-editor><legend className="text-xs font-medium">服务器厂商 Logo</legend>
  <LogoEditor label="服务器厂商" value={value} onChange={providerLogo=>onChange({...note,planDataMod:{...note.planDataMod,providerLogo}})}/>
  {src&&<div className="inline-flex rounded border p-2 bg-stone-500/20"><img src={src} alt="厂商 Logo 预览" referrerPolicy="no-referrer" style={{width:80,height:28,objectFit:"contain",objectPosition:"left center"}}/></div>}
  <p className="text-xs text-muted-foreground">显示在服务器名称上方；方形、圆形、长条图均等比例适配，不裁切。</p>
 </fieldset>;
}
