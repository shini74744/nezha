import {safeCarrierColor} from "../../../shared/carrier-colors";
export default function CarrierColorPicker({label,value,fallback,onChange}:{label:string;value:unknown;fallback:string;onChange:(value:string|undefined)=>void}) {
 const custom=safeCarrierColor(value),color=custom||fallback;
 return <span className="inline-flex items-center gap-1 text-xs font-medium">
  <label className="relative inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center" title={"选择"+label+"标签颜色"}>
   <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{backgroundColor:color}}/>
   <input type="color" aria-label={label+"标签颜色"} value={color} onChange={e=>onChange(e.target.value)}
    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/>
  </label>
  <span>{label}</span>
  {custom&&<button type="button" aria-label={"恢复"+label+"默认颜色"} title="恢复默认颜色"
   className="px-1 text-muted-foreground" onClick={()=>onChange(undefined)}>↺</button>}
 </span>;
}
