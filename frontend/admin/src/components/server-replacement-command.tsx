import { fetcher, FetcherMethod } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { copyToClipboard } from "@/lib/utils"
import { useRef, useState } from "react"
import { toast } from "sonner"

export function ServerReplacementCommand({ uuid, name, open, onOpenChange, generate }: {
    uuid: string; name?: string; open: boolean; onOpenChange: (value: boolean) => void
    generate: (type: number, secret: string) => string
}) {
    const [type, setType] = useState(1)
    const [busy, setBusy] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const [command, setCommand] = useState("")
    const [expires, setExpires] = useState("")
    const [error, setError] = useState("")
    const sending = useRef(false)
    const handleOpen = (next: boolean) => {
        if (sending.current) return
        if (!next) { setCommand(""); setExpires(""); setError(""); setConfirmed(false) }
        onOpenChange(next)
    }
    const create = async () => {
        if (sending.current || !confirmed) return
        sending.current = true
        setBusy(true); setError("")
        try {
            const result = await fetcher<{ secret: string; expires_at: string }>(FetcherMethod.POST, "/api/v1/server/replacement-command", { uuid, confirmed: true, reset_scope: "full_node_v1" })
            const text = generate(type, result.secret)
            setCommand(text); setExpires(result.expires_at)
            try { await copyToClipboard(text); toast.success("换机安装命令已复制；当前数据尚未清理") }
            catch { setError("命令已生成，自动复制失败，请从下方手动复制。") }
        } catch { setError("生成失败，请刷新后重试；没有执行数据清理。") }
        finally { sending.current = false; setBusy(false) }
    }
    return (
        <Dialog open={open} onOpenChange={handleOpen}>
            <DialogContent className="flex max-h-[85dvh] w-[94vw] max-w-xl flex-col gap-3 overflow-hidden rounded-lg p-4 sm:p-6">
                <DialogHeader className="shrink-0 pr-6 text-left">
                    <DialogTitle>清理数据换机安装命令</DialogTitle>
                    <DialogDescription>在新机器上执行，沿用当前节点身份。复制命令不会立即清理数据。</DialogDescription>
                </DialogHeader>
                <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border p-3 text-sm">
                    <p className="break-words font-medium">{name || "所选服务器"}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{uuid}</p>
                </div>
                <div className="space-y-2 text-sm leading-6">
                    <p>新机器成功连接并完整上报后，清空该节点全部旧历史：机器信息与操作历史、监控曲线、流量、检测快照、IP 历史、终端会话和通知发送记录。</p>
                    <p className="text-muted-foreground">名称恢复为“新服务器”，公开／私有备注、购买／到期日期、套餐、分组归属、通知及任务关联等配置恢复初始状态。仅保留内部系统 ID、UUID、排序和所属账号；共享分组、通知渠道及其他节点不删除，全局规则按新节点生效。</p>
                    <p className="text-destructive">请确认旧机器不再使用此 UUID；清理完成后无法通过面板恢复旧记录或配置，新凭据会使旧机器密钥失效。</p>
                </div>
                {!command && <label className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm leading-6">
                    <input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1.5 shrink-0" />
                    我确认清空全部旧历史和配置，作为新机器重新开始，仅保留 ID、UUID、排序和所属账号。
                </label>}
                {!command && <label className="flex items-center gap-3 text-sm">新机器系统
                    <select value={type} disabled={busy} onChange={(e) => setType(Number(e.target.value))} className="h-9 flex-1 rounded-md border bg-background px-3">
                        <option value={1}>Linux</option><option value={2}>macOS</option><option value={3}>Windows</option>
                    </select>
                </label>}
                {command && <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">首次使用截止：{new Date(expires).toLocaleString()}。成功后不会重复清理。命令含专用凭据，请勿分享。</p>
                    <textarea aria-label="换机安装命令" readOnly value={command} className="min-h-32 w-full resize-y rounded-md border bg-muted p-3 font-mono text-xs leading-5" onFocus={(e) => e.target.select()} />
                </div>}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter className="shrink-0 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => handleOpen(false)}>{command ? "关闭" : "取消"}</Button>
                    {!command && <Button disabled={busy || !confirmed} onClick={() => void create()}>{busy ? "生成中…" : "确认并复制命令"}</Button>}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
