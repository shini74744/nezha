import { useState } from "react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import type { Feature } from "@/lib/appearance-config"
import { builtinFontIds, fontCSS, type FontItem } from "../../../shared/appearance-options"
import builtinStyles from "../../../shared/font-styles.json"

const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm"
export function FontSettings({ value, onChange }: { value: Feature; onChange: (value: Feature) => void }) {
 const [preview, setPreview] = useState<string | null>(null)
 const items = value.items as FontItem[]
 const update = (id: string, change: Partial<FontItem>) => onChange({...value, items: items.map(item => item.id === id ? {...item, ...change} : item)})
 const select = (id: string) => onChange({...value, activeId:id, selection: builtinFontIds.indexOf(id as typeof builtinFontIds[number])})
 const remove = (id: string) => {
  if(items.length === 1)return
  onChange({...value, items:items.filter(item=>item.id!==id), ...(value.activeId===id ? {activeId:"random",selection:-1} : {})})
  if(preview===id)setPreview(null)
 }
 const add = () => {
  const id="font-"+crypto.randomUUID()
  onChange({...value,items:[...items,{id,name:"自定义字体",family:"Custom Font",source:"file",url:"",format:"woff2",builtin:""}]})
 }
 const previewItem=items.find(item=>item.id===preview)
 const previewHTML=previewItem ? '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#fffaf2;color:#29251e;line-height:1.8}'+fontCSS(previewItem,builtinStyles)+'</style><p>云端相连，数据尽在眼前。</p><p>DDnezha · 0123456789 · ABC abc</p></html>' : ""
 return <div className="space-y-4" data-font-settings>
  <label className="block space-y-2"><span>使用字体</span><select aria-label="使用字体" className={selectClass} value={value.activeId} onChange={e=>select(e.target.value)}>
   <option value="random">随机选择（每次访问选择一种）</option>
   {items.map(item=><option key={item.id} value={item.id}>{item.name||"未命名字体"}</option>)}
  </select></label>
  <div className="grid gap-3 lg:grid-cols-2">
   {items.map((item,index)=><details key={item.id} className="min-w-0 rounded-lg border bg-background/35" data-font-id={item.id}>
    <summary className="cursor-pointer px-4 py-3 font-medium break-words">{item.name||"未命名字体"}{value.activeId===item.id&&<span className="ml-2 text-xs text-muted-foreground">正在使用</span>}</summary>
    <div className="space-y-3 border-t p-4">
     <label className="block space-y-1"><span>显示名称</span><Input aria-label="显示名称" maxLength={80} value={item.name} onChange={e=>update(item.id,{name:e.target.value})}/></label>
     <label className="block space-y-1"><span>字体来源</span><select aria-label="字体来源" className={selectClass} value={item.source} onChange={e=>update(item.id,{source:e.target.value})}>
      {item.builtin&&<option value="builtin">内置字体</option>}<option value="file">字体文件地址</option><option value="local">设备本地字体</option>
     </select></label>
     {item.source!=="builtin"&&<label className="block space-y-1"><span>字体名称族</span><Input aria-label="字体名称族" maxLength={128} value={item.family} placeholder="例如 Noto Sans SC" onChange={e=>update(item.id,{family:e.target.value})}/></label>}
     {item.source==="file"&&<div className="space-y-3"><label className="block space-y-1"><span>字体文件地址</span><Input aria-label="字体文件地址" type="url" placeholder="https://example.com/font.woff2" value={item.url} onChange={e=>update(item.id,{url:e.target.value})}/></label><label className="block space-y-1"><span>字体格式</span><select aria-label="字体格式" className={selectClass} value={item.format} onChange={e=>update(item.id,{format:e.target.value})}>{["woff2","woff","truetype","opentype"].map(f=><option key={f} value={f}>{f==="truetype"?"TTF":f==="opentype"?"OTF":f.toUpperCase()}</option>)}</select></label><p className="text-xs text-muted-foreground">使用可直接访问的字体文件，文件所在站点需允许跨域加载。</p></div>}
     {item.source==="local"&&<p className="text-xs text-muted-foreground">访客设备未安装时，自动使用系统字体。</p>}
     <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={()=>setPreview(preview===item.id?null:item.id)}>{preview===item.id?"收起预览":"预览字体"}</Button>
      <Button type="button" variant="outline" onClick={()=>select(item.id)} disabled={value.activeId===item.id}>使用此字体</Button>
      <Button type="button" variant="outline" disabled={index===0} onClick={()=>{const next=[...items];[next[index-1],next[index]]=[next[index],next[index-1]];onChange({...value,items:next})}}>上移</Button>
      <Button type="button" variant="outline" disabled={items.length===1} onClick={()=>remove(item.id)}>删除</Button>
     </div>
     {preview===item.id&&<iframe title="字体预览" sandbox="" srcDoc={previewHTML} className="h-32 w-full rounded border bg-white"/>}
    </div>
   </details>)}
  </div>
  <Button type="button" variant="outline" disabled={items.length>=32} onClick={add}>添加字体</Button>
 </div>
}
