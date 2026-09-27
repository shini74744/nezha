import {useState} from "react";
import CarrierColorPicker from "./CarrierColorPicker";
import {carrierColorStyle,defaultCarrierColors,safeCarrierColor} from "../../../shared/carrier-colors";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {Command,CommandInput,CommandList,CommandEmpty,CommandItem} from "@/components/ui/command";
import {carriers,findCarrier} from "../../../shared/carriers";
import {carrierRegions,regionName} from "../../../shared/carrier-regions";
import {safeLogoSource} from "../../../shared/other-routes";
import {type PublicNote} from "@/lib/public-note";
import {patchOtherRoutes,readOtherRoutes,type OtherRoute} from "@/lib/public-note-compat";

type Choice={value:string;label:string;keywords?:string;icon?:string;background?:string};
function Picker({value,label,choices,onChange,disabled=false}:{value:string;label:string;choices:Choice[];onChange:(value:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),selected=choices.find(c=>c.value===value);
 return <Popover modal open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
  <Button type="button" disabled={disabled} variant="outline" role="combobox" aria-expanded={open}
   aria-label={label} className="w-full min-w-0 justify-start">
   {selected?.icon&&<img src={selected.icon} style={{backgroundColor:selected.background}} alt="" className="h-4 w-6 shrink-0 object-contain rounded-sm bg-stone-700"/>}
   <span className="truncate">{selected?.label||value||"请选择"}</span>
  </Button></PopoverTrigger>
  <PopoverContent align="start" collisionPadding={12} className="w-[min(350px,calc(100vw-40px))] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-0">
   <Command className="h-auto"><CommandInput placeholder={"搜索"+label} aria-label={"搜索"+label}/>
    <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-48px))] min-h-0 overscroll-contain touch-pan-y" data-carrier-picker-list><CommandEmpty>暂无匹配项。该地区未收录的运营商可手动添加。</CommandEmpty>
     {choices.map(c=><CommandItem key={c.value||"none"} value={c.value+" "+c.label+" "+(c.keywords||"")} onSelect={()=>{onChange(c.value);setOpen(false)}}>
      {c.icon&&<img src={c.icon} style={{backgroundColor:c.background}} alt="" className="h-5 w-8 shrink-0 object-contain rounded-sm bg-stone-700"/>}
      <span>{c.label}</span>
     </CommandItem>)}
    </CommandList>
   </Command>
  </PopoverContent>
 </Popover>;
}
export default function OtherRoutesEditor({note,onChange}:{note:PublicNote;onChange:(note:PublicNote)=>void}){
 const entries=readOtherRoutes(note.planDataMod),[uploadError,setUploadError]=useState("");
 const update=(next:OtherRoute[])=>onChange(patchOtherRoutes(note,next));
 const patch=(index:number,fields:Partial<OtherRoute>)=>update(entries.map((r,i)=>i===index?{...r,...fields}:r));
 const upload=async(file:File|undefined,index:number)=>{
  setUploadError("");if(!file)return;
  if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type)){
   setUploadError("Logo 请使用 PNG、JPEG、WebP 或 GIF 图片。");return;
  }
  const reader=new FileReader();reader.onerror=()=>setUploadError("Logo 读取失败");
  reader.onload=()=>{const logo=safeLogoSource(reader.result);if(logo)patch(index,{logo});else setUploadError("Logo 格式无效")};
  reader.readAsDataURL(file);
 };
 return <div className="contents" data-other-routes-editor>
  <div className="space-y-1 min-w-0" data-other-routes-entry><CarrierColorPicker label="其他运营商" fallback={defaultCarrierColors.other} value={note.planDataMod?.networkRouteColors?.other}
    onChange={color=>onChange({...note,planDataMod:{...note.planDataMod,networkRouteColors:{...note.planDataMod?.networkRouteColors,other:color}}})}/>
   <Button type="button" variant="outline" className="w-full h-10 justify-start" disabled={entries.length>=50}
    aria-label="添加线路" onClick={()=>update([...entries,{carrier:"",country:"",text:""}])}>添加线路{entries.length?`（${entries.length}）`:""}</Button></div>
  <div className="space-y-3 sm:col-span-2 min-w-0">

  {uploadError&&<p role="alert" className="text-xs text-destructive">{uploadError}</p>}
  {entries.map((entry,index)=>{
   const selected=findCarrier(entry.carrier),country=entry.country||selected?.regions[0]||"";
   const choices:Choice[]=[{value:"",label:"不使用 Logo"},{value:"custom",label:"手动添加运营商"},
    ...carriers.filter(c=>c.regions.includes(country)).map(c=>({value:c.id,label:c.label+(c.icon?"":"（暂无 Logo）"),keywords:c.aliases,icon:c.icon,background:c.logoBackground}))];
   if(selected&&!choices.some(c=>c.value===selected.id))choices.push({value:selected.id,label:selected.label,icon:selected.icon});
   const preview=safeLogoSource(entry.logo)||selected?.icon;
   return <div key={index} className="space-y-2 rounded-md border p-3" data-other-route-row>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
     <div className="space-y-1"><span className="text-xs">国家/地区</span>
      <Picker value={country} label={"国家地区 "+(index+1)} choices={carrierRegions.map(r=>({value:r.code,label:r.label,keywords:r.code}))}
       onChange={country=>patch(index,{country,carrier:"",name:"",logo:""})}/></div>
     <div className="space-y-1"><span className="text-xs">运营商 / Logo</span>
      <Picker value={entry.carrier} disabled={!country} label={"运营商 Logo "+(index+1)} choices={choices} onChange={carrier=>patch(index,{carrier,logo:"",name:""})}/></div>
    </div>
    {(entry.carrier==="custom"||selected?.reference)&&<div className="space-y-2">
     {selected?.reference&&<p className="text-xs text-muted-foreground">此条为参考名录，尚未核实 Logo。可以不上传，前台保留线路文字。</p>}
     {entry.carrier==="custom"&&<Input aria-label={"运营商名称 "+(index+1)} placeholder="运营商名称" value={entry.name||""} onChange={e=>patch(index,{name:e.target.value})}/> }
     <Input aria-label={"Logo 地址 "+(index+1)} placeholder="HTTPS Logo 地址（公开可见，不要填写密钥）" value={entry.logo?.startsWith("data:")?"":entry.logo||""} onChange={e=>patch(index,{logo:e.target.value})}/>
     <label className="block text-xs">或上传 Logo（PNG/JPEG/WebP/GIF，前台固定尺寸）
      <input aria-label={"上传 Logo "+(index+1)} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block mt-1 max-w-full" onChange={e=>{void upload(e.target.files?.[0],index);e.target.value=""}}/></label>
     {!!entry.logo&&!safeLogoSource(entry.logo)&&<p role="alert" className="text-xs text-destructive">Logo 地址须为 HTTPS；不安全地址不会显示。</p>}
     <Button type="button" size="sm" variant="outline" onClick={()=>patch(index,{logo:""})}>清除 Logo</Button>
    </div>}
    <CarrierColorPicker label={"线路 "+(index+1)} value={entry.color} fallback={safeCarrierColor(note.planDataMod?.networkRouteColors?.other)||defaultCarrierColors.other} onChange={color=>patch(index,{color})}/>
    <div className="flex gap-2"><Input aria-label={"线路名称 "+(index+1)} placeholder="线路名称，例如 AS2914 / 精品国际线路" value={entry.text}
     onChange={e=>patch(index,{text:e.target.value})}/>
     <Button type="button" variant="outline" size="sm" aria-label={"删除线路 "+(index+1)} onClick={()=>update(entries.filter((_,i)=>i!==index))}>删除</Button></div>
    <div className="flex items-center gap-1 text-xs rounded px-1 py-0.5 w-fit" style={carrierColorStyle(entry.color||note.planDataMod?.networkRouteColors?.other||defaultCarrierColors.other)}>
     {preview&&<img src={preview} style={{backgroundColor:entry.logo?undefined:selected?.logoBackground}} alt="" referrerPolicy="no-referrer" className="h-4 w-6 object-contain rounded-sm bg-stone-700"/>}
     <span>{entry.text||"线路预览"}{country?" · "+regionName(country):""}</span>
    </div>
   </div>;
  })}
  </div>
 </div>;
}
