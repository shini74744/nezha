import {useState} from "react";
import {ChevronDown} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {Feature} from "@/lib/appearance-config";
import type {CustomCharacter} from "@/lib/mascot-config";
export function SakanaCharacters({value:f,onChange}:{value:Feature;onChange:(f:Feature)=>void}){
 const list=f.customCharacters as CustomCharacter[];
 const [expanded,setExpanded]=useState<string|null>(null);
 const update=(id:string,patch:Partial<CustomCharacter>)=>onChange({...f,customCharacters:list.map(r=>r.id===id?{...r,...patch}:r)});
 return <fieldset className="sm:col-span-2 min-w-0 rounded border p-3 space-y-3"><legend className="px-2 font-semibold">自定义角色图片</legend>
 <p className="text-sm text-muted-foreground">最多16个。建议使用透明背景 PNG/WebP 图片直链；HTTPS 网站请使用 HTTPS 图片。图片需允许外链访问，不要填写密钥。仅电脑端左下角显示，手机保持隐藏。</p>
 {list.map((r,i)=><div key={r.id} className="min-w-0 rounded border">
 <button type="button" className="flex w-full items-center gap-2 rounded p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={expanded===r.id} aria-controls={"character-editor-"+r.id} onClick={()=>setExpanded(expanded===r.id?null:r.id)}>
 <ChevronDown aria-hidden="true" className={"h-4 w-4 shrink-0 transition-transform "+(expanded===r.id?"":"-rotate-90")}/><span className="min-w-0 flex-1 break-words">{r.name.trim()||"未命名角色 "+(i+1)}</span>{f.character===r.id&&<span className="shrink-0 text-xs text-muted-foreground">默认角色</span>}
 </button>
 {expanded===r.id&&<div id={"character-editor-"+r.id} className="space-y-3 border-t p-3">
 <label className="block space-y-1">角色名称<Input aria-label={"自定义角色名称 "+(i+1)} value={r.name} maxLength={60} onChange={e=>update(r.id,{name:e.target.value})}/></label>
 <label className="block space-y-1">图片地址<Input aria-label={"自定义角色图片 "+(i+1)} value={r.imageUrl} placeholder="https://example.com/character.png" onChange={e=>update(r.id,{imageUrl:e.target.value})}/></label>
 <div className="space-y-2"><label className="block space-y-1">图片缩放（%，默认100）<Input type="number" min={25} max={200} aria-label={"自定义角色缩放 "+(i+1)} value={r.scale??100} onChange={e=>update(r.id,{scale:e.target.value===""?0:Number(e.target.value)})}/></label>
 <input className="w-full" type="range" min={25} max={200} step={1} aria-label={"自定义角色缩放滑块 "+(i+1)} value={r.scale??100} onChange={e=>update(r.id,{scale:Number(e.target.value)})}/>
 <Button type="button" variant="outline" onClick={()=>update(r.id,{scale:100})}>恢复100%</Button>
 <p className="text-sm text-muted-foreground">25%–200%，每张图片独立保存；等比例缩放，不裁切。整体尺寸仍可在“Sakana 尺寸”调整，放大时会为左边缘预留空间。</p></div>
 <Button type="button" variant="outline" aria-label={"删除自定义角色 "+(i+1)} onClick={()=>onChange({...f,character:f.character===r.id?"chisato":f.character,customCharacters:list.filter(c=>c.id!==r.id)})}>删除角色</Button>
 </div>}
 </div>)}
 <Button type="button" variant="outline" disabled={list.length>=16} onClick={()=>{const id="custom-"+crypto.randomUUID();setExpanded(id);onChange({...f,customCharacters:[...list,{id,name:"",imageUrl:""}]})}}>添加自定义角色</Button>
 <p className="text-sm text-muted-foreground">添加后在“Sakana 默认角色”中选择并保存。前台工具栏可在内置角色与自定义角色间切换；图片加载失败会回到千束。</p>
 </fieldset>;
}
