import { fetcher, FetcherMethod, swrFetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { ArrowLeft, ChevronRight, History, RefreshCw, Search, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"

interface ServerIdentity { server_uuid: string; server_id: number; server_name: string }
interface ServerCard extends ServerIdentity {
    position: number; deleted: boolean; count: number; last_id: number; last_at: number
}
interface Operation extends ServerIdentity {
    id: number; created_at: string; previous_id: number
    actor_id: number; actor_name: string; source: string; action: string
    changes: { field: string; before: string; after: string }[]
}
interface Page<T> { value: T[]; pagination: { total: number } }
const actions: Record<string, string> = {
    inventory_baseline: "首次信息记录", inventory_change: "机器信息变化", replace_machine: "清理数据换机",
    create: "节点注册", edit: "编辑节点", delete: "删除节点", release_uuid: "解除节点封禁",
    deleted_cleanup: "删除节点自动清理", order: "调整排序", weights: "批量分配权重",
    reassign_ids: "调整系统 ID", visibility: "修改显示", group: "修改分组",
    transfer: "转移归属", transfer_revert: "转移回滚", agent_config: "请求修改 Agent 配置", agent_update: "请求更新 Agent",
}
const fields: Record<string, string> = {
    cpu: "CPU", memory_total: "内存容量", disk_total: "磁盘容量（已挂载文件系统）", swap_total: "交换空间",
    operating_system: "操作系统", architecture: "系统架构", virtualization: "虚拟化类型",
    gpu: "GPU", agent_version: "Agent 版本", ipv4: "IPv4", ipv6: "IPv6", region: "区域",
    id: "系统 ID", name: "节点名称", owner: "所属用户 ID", display_index: "内部排序值",
    hide_for_guest: "对游客隐藏", hide_for_display: "前台隐藏", connectivity_disabled: "关闭服务器连通性检测",
    connectivity_local_only: "连通性仅保留本地延迟", bgp_disabled: "隐藏 BGP", return_route_disabled: "隐藏回程",
    streaming_disabled: "隐藏流媒体", enable_ddns: "启用 DDNS", ddns_profiles: "DDNS 配置 ID", ddns_domains: "DDNS 域名",
    note: "私有备注", public_note: "公开配置 / 备注", groups: "分组", status: "状态", uuid_block: "节点身份封禁状态",
    deleted_cleanup: "自动清理状态", config: "Agent 配置", update: "Agent 更新", replacement: "换机数据清理",
}
const sources: Record<string, string> = { web: "后台", api: "API", system: "系统", agent: "Agent", transfer: "转移流程" }
function displayValue(field: string, text: string) {
    if (["memory_total", "disk_total", "swap_total"].includes(field) && /^\d+$/.test(text)) {
        const bytes = Number(text)
        return bytes === 0 ? "0 B" : (bytes / 1024 ** 3).toFixed(2) + " GiB（" + text + " B）"
    }
    if (field === "region" && /^[A-Z]{2}$/.test(text)) {
        try { return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(text) + " (" + text + ")" } catch { /* raw fallback */ }
    }
    return text === "true" ? "开启" : text === "false" ? "关闭" : text || "—"
}
function stamp(text: string | number) {
    if (!text) return "暂无记录"
    return new Date(text).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

export function ServerOperationHistory({ server }: { server?: ServerIdentity }) {
    const [open, setOpen] = useState(false)
    const [selected, setSelected] = useState<ServerIdentity | null>(server ?? null)
    const [draft, setDraft] = useState("")
    const [query, setQuery] = useState("")
    const [action, setAction] = useState("")
    const [field, setField] = useState("")
    const [page, setPage] = useState(0)
    const [listPage, setListPage] = useState(0)
    const [deletion, setDeletion] = useState<{ id?: number; through_id?: number } | null>(null)
    const [deleting, setDeleting] = useState(false)
    const size = 20
    const listParams = new URLSearchParams({ q: query, action, field, offset: String(listPage * size), limit: String(size) })
    const detailParams = new URLSearchParams({ uuid: selected?.server_uuid ?? "", action, field, offset: String(page * size), limit: String(size) })
    const cards = useSWR<Page<ServerCard>>(open && !selected ? "/api/v1/server/operation-servers?" + listParams : null, swrFetcher, { revalidateOnFocus: false })
    const history = useSWR<Page<Operation>>(open && selected ? "/api/v1/server/operations?" + detailParams : null, swrFetcher, { revalidateOnFocus: false })
    const active = selected ? history : cards
    const total = active.data?.pagination.total ?? 0
    const currentPage = selected ? page : listPage
    const setCurrentPage = selected ? setPage : setListPage
    const rows = history.data?.value ?? []
    const deleteHistory = async () => {
        if (!selected || !deletion || deleting) return
        setDeleting(true)
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/server/operations/delete", { uuid: selected.server_uuid, ...deletion })
            toast.success("历史记录已删除，不影响服务器及监控数据")
            setDeletion(null)
            if (rows.length === 1 && page > 0) setPage(page - 1)
            else await history.mutate()
            await cards.mutate()
        } catch { toast.error("删除失败，请重试") }
        finally { setDeleting(false) }
    }
    return (
        <Dialog open={open} onOpenChange={(next) => {
            if (deleting) return
            setOpen(next)
            if (next) { setSelected(server ?? null); setPage(0); setListPage(0); setAction(""); setField(""); setDraft(""); setQuery("") }
        }}>
            <DialogTrigger asChild>
                {server ? (
                    <Button variant="outline" size="icon" className="shrink-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]" title="查看历史记录" aria-label={"查看 " + server.server_name + " 的历史记录"} disabled={!server.server_uuid}>
                        <History className="size-4" />
                    </Button>
                ) : (
                    <Button variant="ghost" size="sm" className="gap-1.5"><History className="size-4" />历史记录</Button>
                )}
            </DialogTrigger>
            <DialogContent className="flex max-h-[85dvh] w-[94vw] max-w-4xl flex-col gap-3 rounded-lg p-4 sm:p-5">
                <DialogHeader className="pr-6 text-left">
                    <DialogTitle className="break-words">{selected ? selected.server_name + " · 历史记录" : "服务器历史记录"}</DialogTitle>
                    <DialogDescription className="text-xs leading-5">
                        {selected ? "系统 ID " + selected.server_id + " · " : "按当前服务器排序，点击卡片查看详细变化。"}
                        永久保存，仅手动删除；删除节点或换机不清除历史。时间按设备时区显示。
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setListPage(0); setQuery(draft.trim()) }}>
                    {selected ? (
                        <Button variant="outline" size="sm" type="button" onClick={() => { setSelected(null); setPage(0) }} className="gap-1.5">
                            <ArrowLeft className="size-4" />全部服务器
                        </Button>
                    ) : (
                        <div className="flex min-w-0 flex-1 basis-48 gap-1">
                            <Input aria-label="搜索节点历史" placeholder="名称 / 原 ID / 当前 ID" value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} className="h-9 min-w-0" />
                            <Button type="submit" size="sm" variant="outline" aria-label="搜索"><Search className="size-4" /></Button>
                        </div>
                    )}
                    <select aria-label="操作类型" value={action} className="h-9 min-w-0 max-w-44 rounded-md border bg-background px-2 text-sm" onChange={(e) => { setPage(0); setListPage(0); setAction(e.target.value) }}>
                        <option value="">全部变化</option>
                        {Object.entries(actions).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <Button type="button" size="sm" variant="outline" disabled={active.isValidating} onClick={() => void active.mutate()} aria-label="刷新历史">
                        <RefreshCw className={"size-4 " + (active.isValidating ? "animate-spin" : "")} />
                    </Button>
                    {selected && !action && !field && page === 0 && rows.length > 0 && <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setDeletion({ through_id: rows[0].id })}>清空此节点历史</Button>}
                </form>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="按变化项目筛选">
                    {[["", "全部"], ["cpu", "CPU"], ["memory", "内存"], ["disk", "磁盘"], ["system", "系统"], ["ip", "IP"], ["region", "区域"], ["gpu", "GPU"]].map(([key, label]) => (
                        <Button key={key} type="button" size="sm" variant={field === key ? "default" : "outline"} aria-pressed={field === key} className="h-8 px-3 text-xs" onClick={() => { setField(key); setPage(0); setListPage(0) }}>{label}</Button>
                    ))}
                </div>
                <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
                    {active.error ? <p role="alert" className="py-6 text-center text-sm text-destructive">加载失败，请点击刷新重试。</p>
                    : active.isLoading ? <p className="py-6 text-center text-sm">加载中…</p>
                    : total === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">暂无符合条件的{selected ? "历史记录" : "服务器"}</p>
                    : !selected ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                            {(cards.data?.value ?? []).map((card) => (
                                <button type="button" key={card.server_uuid} onClick={() => { setSelected(card); setPage(0) }} className="min-w-0 rounded-md border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <div className="flex items-start gap-2">
                                        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">{card.deleted ? "已删除" : card.position}</span>
                                        <span className="min-w-0 flex-1 break-words text-sm font-medium">{card.server_name || "未命名节点"}</span>
                                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                    </div>
                                    <p className="mt-1.5 text-xs text-muted-foreground">系统 ID {card.server_id} · {card.count} 条记录</p>
                                    <p className="mt-1 text-xs text-muted-foreground">最近：{stamp(card.last_at)}</p>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {rows.map((row) => (
                                <details key={row.id} open={!!field} className="group rounded-md border p-3 text-sm">
                                    <summary className="cursor-pointer list-none space-y-1.5">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <span className="font-medium">{actions[row.action] || row.action}</span>
                                            <time dateTime={row.created_at} className="text-xs text-muted-foreground">{row.action === "inventory_change" ? "检测到变化：" : row.action === "inventory_baseline" ? "首次记录：" : "操作时间："}{stamp(row.created_at)}</time>
                                        </div>
                                        <p className="break-words text-xs text-muted-foreground">{row.actor_name || "系统"}{row.actor_name !== (sources[row.source] || row.source) && " · " + (sources[row.source] || row.source)} · 当时：{row.server_name}（#{row.server_id}）</p>
                                        <p className="text-xs text-muted-foreground">{row.changes?.length ?? 0} 项变更 · <span className="group-open:hidden">展开详情</span><span className="hidden group-open:inline">收起详情</span></p>
                                    </summary>
                                    <div className="mt-3 space-y-2 border-t pt-3">
                                        {(row.changes ?? []).map((change,index) => (
                                            <div key={index} className="rounded-md border p-2">
                                                <p className="mb-1.5 text-xs font-medium">{fields[change.field] || change.field}</p>
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    {[["修改前", change.before], ["修改后", change.after]].map(([label,text]) => (
                                                        <p key={label} className="min-w-0 whitespace-pre-wrap break-all text-xs leading-5"><span className="mr-2 text-muted-foreground">{label}</span>{displayValue(change.field,text)}</p>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                        <div className="flex justify-end"><Button variant="ghost" size="sm" className="gap-1.5 text-destructive" onClick={() => setDeletion({ id: row.id })}><Trash2 className="size-3.5" />删除此记录</Button></div>
                                    </div>
                                </details>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <span>共 {total} {selected ? "条记录" : "台服务器"} · 第 {currentPage + 1} 页</span>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={currentPage === 0 || active.isValidating} onClick={() => setCurrentPage(currentPage - 1)}>上一页</Button>
                        <Button size="sm" variant="outline" disabled={(currentPage + 1) * size >= total || active.isValidating} onClick={() => setCurrentPage(currentPage + 1)}>下一页</Button>
                    </div>
                </div>
                <AlertDialog open={!!deletion} onOpenChange={(next) => { if (!next && !deleting) setDeletion(null) }}>
                    <AlertDialogContent className="w-[calc(100vw-2rem)] rounded-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle>{deletion?.id ? "删除这条历史记录？" : "清空此节点历史？"}</AlertDialogTitle>
                            <AlertDialogDescription>仅删除「{selected?.server_name}」{deletion?.id ? "所选整条记录（包括其中其他字段的变化）" : "当前已确认范围内的历史记录"}，无法撤销。不删除服务器或监控数据；之后的新变化仍会记录。</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2">
                            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                            <Button variant="destructive" disabled={deleting} onClick={() => void deleteHistory()}>{deleting ? "删除中…" : "确认删除"}</Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </DialogContent>
        </Dialog>
    )
}
