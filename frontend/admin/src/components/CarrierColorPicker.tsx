import {useState} from "react";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {safeCarrierColor} from "../../../shared/carrier-colors";
export const carrierPalette=["#2563eb","#16a34a","#dc2626","#78716c","#0891b2","#7c3aed","#db2777","#ea580c","#eab308","#22c55e","#38bdf8","#a78bfa","#ffffff","#111827"];
export default function CarrierColorPicker({label,value,fallback,onChange}:{label:string;value:unknown;fallback:string;onChange:(value:string|undefined)=>void}) {
 const [open,setOpen]=useState(false),custom=safeCarrierColor(value),color=custom||fallback;
 return <span className="inline-flex items-center gap-1 text-xs font-medium">
  <Popover modal open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
   <button type="button" aria-label={label+"标签颜色"} title={"选择"+label+"标签颜色"} className="inline-flex h-4 w-4 shrink-0 items-center justify-center"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{backgroundColor:color}}/></button>
  </PopoverTrigger><PopoverContent align="start" className="w-56 p-3" data-color-palette>
   <p className="mb-2 text-xs">{label} · 选择颜色</p><div className="grid grid-cols-5 gap-2">
    {carrierPalette.map(c=><button key={c} type="button" aria-label={"预设颜色 "+c} aria-pressed={color.toLowerCase()===c} className="h-7 w-7 rounded border border-stone-400 ring-offset-2 aria-pressed:ring-2 ring-primary" style={{backgroundColor:c}} onClick={()=>{onChange(c);setOpen(false)}}/>)}
    <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded border" title="自定义取色器">＋<input type="color" aria-label={label+"自定义颜色"} value={color} onChange={e=>onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></label>
   </div><p className="mt-2 text-xs text-muted-foreground">最后一项：自定义取色器</p>
  </PopoverContent></Popover><span>{label}</span>
  {custom&&<button type="button" aria-label={"恢复"+label+"默认颜色"} title="恢复默认颜色" className="px-1 text-muted-foreground" onClick={()=>onChange(undefined)}>↺</button>}
 </span>;
}
