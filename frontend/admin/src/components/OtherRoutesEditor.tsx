import {useState} from "react";
import LogoEditor from "./LogoEditor";
import CarrierColorPicker from "./CarrierColorPicker";
import {carrierColorStyle,defaultCarrierColors,safeCarrierColor} from "../../../shared/carrier-colors";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {carriers,findCarrier} from "../../../shared/carriers";
import {carrierRegions,regionName} from "../../../shared/carrier-regions";
import {safeLogoSource} from "../../../shared/other-routes";
import {type PublicNote} from "@/lib/public-note";
import {patchOtherRoutes,readOtherRoutes,type OtherRoute} from "@/lib/public-note-compat";

import Picker,{type Choice} from "./LogoChoicePicker";
import useLogoLibrary from "@/hooks/useLogoLibrary";
import {libraryLogo} from "../../../shared/logo-library";
export default function OtherRoutesEditor({note,onChange}:{note:PublicNote;onChange:(note:PublicNote)=>void}){
 const {data:library}=useLogoLibrary();
 const catalog=library?library.filter(e=>e.kind==="carrier").map(e=>({id:e.id.replace(/^carrier-/,""),label:e.name,regions:e.regions,aliases:e.aliases,icon:safeLogoSource(e.logo),logoBackground:e.background,reference:!e.logo,library:e})):carriers;
 const entries=readOtherRoutes(note.planDataMod),[logoBusy,setLogoBusy]=useState(false);
 const update=(next:OtherRoute[])=>onChange(patchOtherRoutes(note,next));
 const patch=(index:number,fields:Partial<OtherRoute>)=>update(entries.map((r,i)=>i===index?{...r,...fields}:r));
 return <div className="contents" data-other-routes-editor>
  <div className="space-y-1 min-w-0" data-other-routes-entry><CarrierColorPicker label="其他运营商" fallback={defaultCarrierColors.other} value={note.planDataMod?.networkRouteColors?.other}
    onChange={color=>onChange({...note,planDataMod:{...note.planDataMod,networkRouteColors:{...note.planDataMod?.networkRouteColors,other:color}}})}/>
   <Button type="button" variant="outline" className="w-full h-10 justify-start" disabled={logoBusy||entries.length>=50}
    aria-label="添加线路" onClick={()=>update([...entries,{carrier:"",country:"",text:""}])}>添加线路{entries.length?`（${entries.length}）`:""}</Button></div>
  <div className="space-y-3 sm:col-span-2 min-w-0">

  {entries.map((entry,index)=>{
   const selected=catalog.find(c=>c.id===entry.carrier)||findCarrier(entry.carrier),country=entry.country||selected?.regions[0]||"";
   const choices:Choice[]=[{value:"",label:"不使用 Logo"},{value:"custom",label:"手动添加运营商"},
    ...catalog.filter(c=>c.regions.includes(country)).map(c=>({value:c.id,label:c.label+(c.icon?"":"（暂无 Logo）"),keywords:c.aliases,icon:c.icon,background:c.logoBackground}))];
   if(selected&&!choices.some(c=>c.value===selected.id))choices.push({value:selected.id,label:entry.logoLibraryName||selected.label,icon:safeLogoSource(entry.logo)||selected.icon});
   const preview=safeLogoSource(entry.logo)||((entry.logoLibraryId||entry.logoLibraryName)?"":selected?.icon);
   return <div key={index} className="space-y-2 rounded-md border p-3" data-other-route-row>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
     <div className="space-y-1"><span className="text-xs">国家/地区</span>
      <Picker disabled={logoBusy} value={country} label={"国家地区 "+(index+1)} choices={carrierRegions.map(r=>({value:r.code,label:r.label,keywords:r.code}))}
       onChange={country=>patch(index,{country,carrier:"",name:"",logo:"",logoOriginal:"",logoWebsite:"",logoLibraryId:"",logoLibraryName:"",logoBackground:""})}/></div>
     <div className="space-y-1"><span className="text-xs">运营商 / Logo</span>
      <Picker value={entry.carrier} disabled={logoBusy||!country} label={"运营商 Logo "+(index+1)} choices={choices} onChange={carrier=>{const e=library?.find(v=>v.kind==="carrier"&&v.id==="carrier-"+carrier);patch(index,{carrier,name:e?.name||"",logo:"",logoOriginal:"",logoWebsite:"",logoLibraryId:"",logoLibraryName:"",logoBackground:"",...(e?libraryLogo(e):{})})}}/></div>
    </div>
    {entry.carrier&&<div className="space-y-2">
     {selected?.reference&&<p className="text-xs text-muted-foreground">此条为参考名录，尚未核实 Logo。可以不上传，前台保留线路文字。</p>}
     {entry.carrier==="custom"&&<Input aria-label={"运营商名称 "+(index+1)} placeholder="运营商名称" value={entry.name||""} onChange={e=>patch(index,{name:e.target.value})}/> }
     <LogoEditor locked={logoBusy} onBusyChange={setLogoBusy} key={entry.carrier+country} label={String(index+1)} value={entry} builtIn={!!selected?.icon} onChange={value=>{const e=library?.find(v=>v.id==="carrier-"+entry.carrier);patch(index,!value.logo&&e?libraryLogo(e):{...value,logoLibraryId:"",logoLibraryName:"",logoBackground:""})}}/>
    </div>}
    <CarrierColorPicker label={"线路 "+(index+1)} value={entry.color} fallback={safeCarrierColor(note.planDataMod?.networkRouteColors?.other)||defaultCarrierColors.other} onChange={color=>patch(index,{color})}/>
    <div className="flex gap-2"><Input aria-label={"线路名称 "+(index+1)} placeholder="线路名称，例如 AS2914 / 精品国际线路" value={entry.text}
     onChange={e=>patch(index,{text:e.target.value})}/>
     <Button disabled={logoBusy} type="button" variant="outline" size="sm" aria-label={"删除线路 "+(index+1)} onClick={()=>update(entries.filter((_,i)=>i!==index))}>删除</Button></div>
    <div className="flex items-center gap-1 text-xs rounded px-1 py-0.5 w-fit" style={carrierColorStyle(entry.color||note.planDataMod?.networkRouteColors?.other||defaultCarrierColors.other)}>
     {preview&&<img src={preview} style={{backgroundColor:entry.logo?entry.logoBackground:selected?.logoBackground}} alt="" referrerPolicy="no-referrer" className="h-4 w-6 object-contain rounded-sm bg-stone-700"/>}
     <span>{entry.text||"线路预览"}{country?" · "+regionName(country):""}</span>
    </div>
   </div>;
  })}
  </div>
 </div>;
}
