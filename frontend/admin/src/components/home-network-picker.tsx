import { useEffect, useState } from "react"
import { getHomeNetwork, setHomeNetwork } from "@/api/server"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { hasOverlappingSelection, type NetworkInventory } from "@/lib/network-interfaces"
import { toast } from "sonner"

export function HomeNetworkPicker({ sid, inventory }: { sid: number; inventory?: NetworkInventory }) {
 const [selected, setSelected] = useState<string[]>([])
 const [saved, setSaved] = useState<string[]>([])
 const [ready, setReady] = useState(false)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState("")
 const [retry, setRetry] = useState(0)
 useEffect(() => {
  let active = true
  setReady(false); setError("")
  getHomeNetwork(sid).then(data => {
   if (!Array.isArray(data.interfaces)) throw new Error("Invalid home network selection")
   if (active) { setSelected(data.interfaces); setSaved(data.interfaces); setReady(true) }
  }).catch(() => { if (active) setError("暂时无法读取首页设置") })
  return () => { active = false }
 }, [sid, retry])
 const rows = [...new Set([...(inventory?.interfaces ?? []).map(n => n.name), ...selected, ...saved])]
 const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...saved].sort())
 const save = async () => {
  setBusy(true)
  try {
   const data = await setHomeNetwork(sid, selected)
   setSaved(data.interfaces); setSelected(data.interfaces); toast.success("首页网卡设置已保存")
  } catch { toast.error("保存失败，请重试") } finally { setBusy(false) }
 }
 return <details className="rounded-md border p-3 text-sm">
  <summary className="cursor-pointer break-words">首页显示网卡 · {ready ? selected.length ? "已选 " + selected.length + " 个" : "全部" : "读取中"}</summary>
  <div className="mt-3 space-y-3">
   <p className="text-xs text-muted-foreground">首页速率、累计和周期流量合并显示所选网卡。不选择则沿用全部统计。</p>
   {error ? <Button type="button" variant="outline" size="sm" onClick={() => setRetry(n => n + 1)}>{error}，重试</Button> : <fieldset disabled={!ready || busy} className="space-y-2">
    <Button type="button" variant="outline" size="sm" onClick={() => setSelected([])}>全部</Button>
    <div className="max-h-48 overflow-y-auto overscroll-contain rounded-md border">
     {rows.map(name => {
      const row = inventory?.interfaces.find(n => n.name === name)
      const checked = selected.includes(name)
      return <label key={name} className="flex min-h-11 cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0">
       <Checkbox aria-label={"首页统计 " + name} checked={checked} disabled={!checked && !row?.monitored}
        onCheckedChange={value => setSelected(current => value === true ? [...new Set([...current, name])] : current.filter(n => n !== name))}/>
       <span className="min-w-0 break-all">{name}{!row ? <small className="ml-2 text-muted-foreground">暂未检测到</small> : !row.monitored ? <small className="ml-2 text-muted-foreground">未启用监控</small> : null}</span>
      </label>
     })}
    </div>
    {!rows.length && <p className="text-xs text-muted-foreground">暂无可选择的网卡，请升级 Agent 后重试。</p>}
    {selected.some(name => !inventory?.interfaces.some(n => n.name === name && n.monitored)) && <p className="text-xs text-muted-foreground">部分所选网卡暂未上报，首页将保留选择并等待数据。</p>}
    {selected.length > 1 && hasOverlappingSelection(inventory?.interfaces ?? [], Object.fromEntries(selected.map(n => [n,true]))) && <p className="text-xs text-muted-foreground">所选网卡存在上下级关系，同一流量可能重复计数。</p>}
    <Button type="button" size="sm" disabled={!dirty || busy} onClick={save}>{busy ? "保存中" : "保存首页设置"}</Button>
   </fieldset>}
  </div>
 </details>
}
