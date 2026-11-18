import type { Feature, FeatureDefinition } from "@/lib/appearance-config"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Switch } from "./ui/switch"

export function AppearanceOptionsSettings({definition, value, onChange}:{definition:FeatureDefinition;value:Feature;onChange:(value:Feature)=>void}) {
 const update=(key:string,next:unknown)=>onChange({...value,[key]:next})
 return <div className="grid gap-4 sm:grid-cols-2">
  {Object.keys(definition.defaults).filter(k=>k!=="enabled").map(key=>{
   const label=definition.labels[key]||key, item=value[key], range=definition.constraints[key]
   if(typeof item==="boolean")return <label className="flex items-center justify-between gap-3" key={key}><span>{label}</span><Switch aria-label={label} checked={item} onCheckedChange={v=>update(key,v)}/></label>
   if(key==="palette")return <div key={key} className="space-y-2 sm:col-span-2"><span>{label}</span><div className="flex flex-wrap gap-2">{item.map((color:string,i:number)=><div key={i} className="flex items-center gap-1 rounded-md border p-1"><input aria-label={"星星颜色 "+(i+1)} type="color" value={color} onChange={e=>update(key,item.map((c:string,j:number)=>i===j?e.target.value:c))} className="h-9 w-10 cursor-pointer rounded bg-transparent"/><Button type="button" variant="ghost" size="sm" aria-label={"删除颜色 "+(i+1)} disabled={item.length===1} onClick={()=>update(key,item.filter((_:string,j:number)=>i!==j))}>×</Button></div>)}<Button type="button" variant="outline" disabled={item.length>=8} onClick={()=>update(key,[...item,"#6b8e7d"])}>添加颜色</Button></div></div>
   if(typeof item==="string")return <label key={key} className="block space-y-2"><span>{label}</span><div className="flex items-center gap-2"><input aria-label={label+"取色"} type="color" value={/^#[a-f0-9]{6}$/i.test(item)?item:"#888888"} onChange={e=>update(key,e.target.value)} className="h-10 w-12 shrink-0 rounded border bg-transparent"/><Input aria-label={label} value={item} placeholder="#aabbcc" maxLength={7} onChange={e=>update(key,e.target.value)}/></div></label>
   const fractional=["opacity","speed","wind"].includes(key)
   return <label key={key} className="block space-y-2"><span>{label}</span><div className="flex items-center gap-3">{fractional&&<input aria-label={label+"滑块"} type="range" min={range?.[0]} max={range?.[1]} step=".1" value={item} onChange={e=>update(key,Number(e.target.value))} className="min-w-0 flex-1"/>}<Input aria-label={label} type="number" min={range?.[0]} max={range?.[1]} step={fractional?".1":"1"} value={item} onChange={e=>update(key,Number(e.target.value))} className={fractional?"w-24":""}/></div></label>
  })}
 </div>
}
