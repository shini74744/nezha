import { Switch } from "@/components/ui/switch"
import { useState } from "react"
type Mode = "both" | "connectivity" | "latency" | "hidden"
type Props = {
 mode?: Mode; defaultView?: "connectivity" | "latency"; disabled?: boolean; localOnly?: boolean
 onChange: (value: {network_display_mode:Mode;network_default_view:"connectivity"|"latency";connectivity_disabled:boolean;connectivity_local_only:boolean})=>void
}
export default function NetworkCardSettings({mode,defaultView,disabled,localOnly,onChange}:Props){
 const [expanded,setExpanded]=useState<"connectivity"|"latency"|null>(null)
 const visibleConn=!disabled||!!localOnly
 const current=mode==="both"&&!visibleConn?"latency":mode==="connectivity"&&!visibleConn?"hidden":mode||(!visibleConn?"hidden":"both")
 const conn=current==="both"||current==="connectivity",lat=current==="both"||current==="latency"
 const view=conn&&lat?(defaultView||"connectivity"):lat?"latency":"connectivity"
 const update=(c:boolean,l:boolean,local=!!localOnly,v=view)=>{
  onChange({network_display_mode:c?(l?"both":"connectivity"):(l?"latency":"hidden"),network_default_view:c&&l?v:l?"latency":"connectivity",connectivity_disabled:!c||local,connectivity_local_only:c&&local})
 }
 const control=(kind:"connectivity"|"latency",title:string)=> <button type="button" aria-expanded={expanded===kind} onClick={()=>setExpanded(expanded===kind?null:kind)} className={"inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring "+(kind==="latency"?"order-2 justify-self-end sm:order-3":"order-1 justify-self-start")}>
  {title}<span className="text-muted-foreground text-[11px]">设置 {expanded===kind?"▴":"▾"}</span>
 </button>
 return <div data-network-card-settings>
  <div className="grid grid-cols-2 items-center gap-x-2 gap-y-0 sm:grid-cols-[auto_1fr_auto]">
   {control("connectivity","连通性")}
   <div className="order-3 col-span-2 flex min-h-9 items-center justify-center gap-1.5 text-[11px] sm:order-2 sm:col-span-1" aria-label="默认显示">
    <button type="button" disabled={!conn||!lat} onClick={()=>update(conn,lat,!!localOnly,"connectivity")} className="rounded px-1 py-2 disabled:opacity-60">连通性</button>
    <Switch aria-label="默认显示延迟" checked={view==="latency"} disabled={!conn||!lat} onCheckedChange={v=>update(conn,lat,!!localOnly,v?"latency":"connectivity")} className="h-5 w-9 shrink-0 [&>span]:size-4 [&>span[data-state=checked]]:translate-x-4"/>
    <button type="button" disabled={!conn||!lat} onClick={()=>update(conn,lat,!!localOnly,"latency")} className="rounded px-1 py-2 disabled:opacity-60">延迟</button>
   </div>
   {control("latency","延迟")}
  </div>
  {expanded&&<div className="mt-1 border-t pt-2 pb-1 flex flex-wrap items-center justify-between gap-2">
   <span className="text-xs text-muted-foreground">{expanded==="connectivity"?"连通性显示":"延迟显示"}</span>
   <fieldset aria-label={expanded==="connectivity"?"连通性模式":"延迟模式"} className="inline-flex flex-wrap rounded-2xl bg-muted/70 p-0.5">
    {(expanded==="connectivity"?[["all","服务器＋本地"],["local","仅本地"],["hide","隐藏"]]:[["show","显示"],["hide","隐藏"]]).map(([value,label])=>{
     const selected=expanded==="connectivity"?(!conn?"hide":disabled?"local":"all"):(lat?"show":"hide")
     return <label key={value} className="relative cursor-pointer">
      <input type="radio" name={expanded+"-display"} value={value} checked={selected===value} className="peer absolute inset-0 size-full cursor-pointer opacity-0" onChange={()=>expanded==="connectivity"?update(value!=="hide",lat,value==="local"):update(conn,value==="show")}/>
      <span className="flex min-h-9 items-center rounded-full px-2.5 text-xs peer-checked:bg-background peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{label}</span>
     </label>
    })}
   </fieldset>
  </div>}
 </div>
}
