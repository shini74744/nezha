import { useRef, useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"
import { batchUpdateServerVisibility } from "@/api/server"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Choice = "keep" | "on" | "off" | "local"
const features = [["connectivity_disabled", "连通性"], ["bgp_disabled", "BGP"], ["return_route_disabled", "回程"], ["streaming_disabled", "流媒体"]] as const
type Feature = typeof features[number][0]
type SelectedServer = { id: number; name: string } & Partial<Record<Feature, boolean>> & { connectivity_local_only?: boolean }
const initialFeatures = () => Object.fromEntries(features.map(([key]) => [key, "keep"])) as Record<Feature, Choice>

export function ServerVisibilityBatch({ servers, onUpdated }: { servers: SelectedServer[]; onUpdated: () => Promise<unknown> }) {
    const [open, setOpen] = useState(false)
    const [selected, setSelected] = useState<SelectedServer[]>([])
    const [guest, setGuest] = useState<Choice>("keep")
    const [display, setDisplay] = useState<Choice>("keep")
    const [busy, setBusy] = useState(false)
    const [choices, setChoices] = useState(initialFeatures)
    const submitting = useRef(false)
    const changed = guest !== "keep" || display !== "keep" || Object.values(choices).some(value => value !== "keep")
    const submit = async () => {
        if (submitting.current || !changed || selected.length === 0) return
        submitting.current = true
        setBusy(true)
        try {
            const result = await batchUpdateServerVisibility({
                ids: selected.map(s => s.id),
                ...Object.fromEntries(features.filter(([key]) => choices[key] !== "keep").map(([key]) => [key, choices[key] === "off" || choices[key] === "local"])),
                ...(["off", "local"].includes(choices.connectivity_disabled) ? { connectivity_local_only: choices.connectivity_disabled === "local" } : {}),
                ...(guest === "keep" ? {} : { hide_for_guest: guest === "on" }),
                ...(display === "keep" ? {} : { hide_for_display: display === "on" }),
            })
            setOpen(false)
            toast.success(`已修改 ${result.updated} 台服务器，${selected.length - result.updated} 台原本已是所选状态`)
            try { await onUpdated() } catch { toast.warning("设置已保存，列表刷新失败，请手动刷新") }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "批量设置失败，请重试")
        } finally {
            submitting.current = false
            setBusy(false)
        }
    }
    return (
        <>
            <Button variant="outline" disabled={servers.length === 0} title={servers.length ? "设置所选服务器的隐藏状态和功能开关" : "请先在左侧勾选服务器"}
                onClick={() => { setSelected(servers.map(s => ({ ...s }))); setGuest("keep"); setDisplay("keep"); setChoices(initialFeatures()); setOpen(true) }}>
                <SlidersHorizontal className="mr-2 h-4 w-4 shrink-0" />批量设置
            </Button>
            <Dialog open={open} onOpenChange={value => { if (!submitting.current) setOpen(value) }}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>批量设置</DialogTitle>
                        <DialogDescription>仅修改左侧勾选的 {selected.length} 台服务器。</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-24 overflow-y-auto break-words rounded-md border p-2 text-xs text-muted-foreground" aria-label="所选服务器">
                        {selected.map(s => `${s.name}（ID：${s.id}）`).join("、")}
                    </div>
                    <div className="grid gap-3 rounded-lg border p-3" data-batch-features>
                        <p className="text-sm font-medium">功能开关</p>
                        <p className="text-xs text-muted-foreground">默认保持原样；开启或关闭会统一所选机器。已经处于目标状态的机器自动跳过，不会反转。</p>
                        {features.map(([key, label]) => {
                            const enabled = selected.filter(s => !s[key]).length
                            return <div key={key} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                                <div><Label htmlFor={"batch-" + key}>{label}</Label><p className="mt-1 text-xs text-muted-foreground">已开 {enabled} · 已关 {selected.length - enabled}{key === "connectivity_disabled" && selected.some(s => s.connectivity_disabled && s.connectivity_local_only) ? " · 仅本地 " + selected.filter(s => s.connectivity_disabled && s.connectivity_local_only).length : ""}</p></div>
                                <Select value={choices[key]} onValueChange={v => setChoices(current => ({ ...current, [key]: v as Choice }))} disabled={busy}>
                                    <SelectTrigger id={"batch-" + key} aria-label={label}><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectItem value="keep">保持原样</SelectItem><SelectItem value="on">全部开启</SelectItem><SelectItem value="off">{key === "connectivity_disabled" ? "关闭并隐藏标签" : "全部关闭"}</SelectItem>{key === "connectivity_disabled" && <SelectItem value="local">关闭，仅保留本地延迟</SelectItem>}</SelectContent>
                                </Select>
                            </div>
                        })}
                    </div>
                    <div className="grid gap-4">
                        {([
                            ["普通隐藏", "batch-display", display, setDisplay],
                            ["对游客隐藏", "batch-guest", guest, setGuest],
                        ] as const).map(([label, id, value, setValue]) => (
                            <div key={id} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-4">
                                <Label htmlFor={id} className="whitespace-nowrap">{label}</Label>
                                <Select value={value} onValueChange={v => setValue(v as Choice)} disabled={busy}>
                                    <SelectTrigger id={id} aria-label={label}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="keep">保持不变</SelectItem>
                                        <SelectItem value="on">开启隐藏</SelectItem>
                                        <SelectItem value="off">关闭隐藏</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">普通隐藏仅限制未登录访客，登录后不受影响。访客可连点小鸡 5 下展开；对游客隐藏不受此入口影响，两项同时开启时以对游客隐藏为准。</p>
                    <DialogFooter className="gap-2">
                        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
                        <Button disabled={!changed || busy} onClick={submit}>{busy ? "保存中…" : `应用到 ${selected.length} 台服务器`}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}