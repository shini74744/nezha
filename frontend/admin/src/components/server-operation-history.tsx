import { swrFetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { History, RefreshCw, Search } from "lucide-react"
import { useState } from "react"
import useSWR from "swr"

interface Operation {
    id: number
    created_at: string
    server_uuid: string
    server_id: number
    previous_id: number
    server_name: string
    actor_id: number
    actor_name: string
    source: string
    action: string
    changes: { field: string; before: string; after: string }[]
}
const actions: Record<string, string> = {
    create: "节点注册",
    edit: "编辑节点",
    delete: "删除节点",
    release_uuid: "放行 UUID",
    deleted_cleanup: "删除节点自动清理",
    order: "调整排序",
    reassign_ids: "调整系统 ID",
    visibility: "修改显示",
    group: "修改分组",
    transfer: "转移归属",
    transfer_revert: "转移回滚",
    agent_config: "请求修改 Agent 配置",
    agent_update: "请求更新 Agent",
}
const fields: Record<string, string> = {
    id: "系统 ID",
    name: "节点名称",
    owner: "所属用户 ID",
    display_index: "显示排序",
    hide_for_guest: "对游客隐藏",
    hide_for_display: "前台隐藏",
    enable_ddns: "启用 DDNS",
    ddns_profiles: "DDNS 配置 ID",
    ddns_domains: "DDNS 域名",
    note: "私有备注",
    public_note: "公开配置 / 备注",
    groups: "分组",
    status: "状态",
    uuid_block: "UUID 封禁状态",
    deleted_cleanup: "自动清理状态",
    config: "Agent 配置",
    update: "Agent 更新",
}
const sources: Record<string, string> = {
    web: "后台",
    api: "API",
    system: "系统",
    agent: "Agent",
    transfer: "转移流程",
}
const value = (text: string) => (text === "true" ? "开启" : text === "false" ? "关闭" : text || "—")

export function ServerOperationHistory() {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState("")
    const [query, setQuery] = useState("")
    const [action, setAction] = useState("")
    const [page, setPage] = useState(0)
    const size = 20
    const params = new URLSearchParams({
        q: query,
        action,
        offset: String(page * size),
        limit: String(size),
    })
    const { data, error, isLoading, isValidating, mutate } = useSWR<{
        value: Operation[]
        pagination: { total: number }
    }>(open ? "/api/v1/server/operations?" + params : null, swrFetcher, {
        revalidateOnFocus: false,
    })
    const rows = data?.value ?? []
    const total = data?.pagination.total ?? 0
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                    <History className="size-4" />
                    历史记录
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[85dvh] w-[94vw] max-w-4xl flex-col gap-3 p-4 sm:p-5">
                <DialogHeader className="pr-6 text-left">
                    <DialogTitle>服务器操作历史</DialogTitle>
                    <DialogDescription className="text-xs leading-5">
                        从功能启用后开始记录；删除节点、调整 ID
                        后仍保留。备注及配置中的敏感内容不记录。
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                        e.preventDefault()
                        setPage(0)
                        setQuery(draft.trim())
                    }}
                >
                    <div className="flex min-w-0 flex-1 basis-48 gap-1">
                        <Input
                            aria-label="搜索节点历史"
                            placeholder="名称 / 原 ID / 当前 ID / UUID"
                            value={draft}
                            maxLength={200}
                            onChange={(e) => setDraft(e.target.value)}
                            className="h-9 min-w-0"
                        />
                        <Button type="submit" size="sm" variant="outline" aria-label="搜索">
                            <Search className="size-4" />
                        </Button>
                    </div>
                    <select
                        aria-label="操作类型"
                        value={action}
                        className="h-9 max-w-48 rounded-md border bg-background px-2 text-sm"
                        onChange={(e) => {
                            setPage(0)
                            setAction(e.target.value)
                        }}
                    >
                        <option value="">全部操作</option>
                        {Object.entries(actions).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isValidating}
                        onClick={() => void mutate()}
                        aria-label="刷新历史"
                    >
                        <RefreshCw className={"size-4 " + (isValidating ? "animate-spin" : "")} />
                    </Button>
                </form>
                <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
                    {error ? (
                        <p role="alert" className="py-6 text-center text-sm text-destructive">
                            加载失败，请点击刷新重试。
                        </p>
                    ) : isLoading ? (
                        <p className="py-6 text-center text-sm">加载中…</p>
                    ) : rows.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            暂无符合条件的操作记录
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {rows.map((row) => (
                                <details
                                    key={row.id}
                                    className="group rounded-md border p-3 text-sm"
                                >
                                    <summary className="cursor-pointer list-none space-y-1.5">
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="min-w-0 break-words font-medium">
                                                {row.server_name || "未命名节点"}
                                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                    {row.previous_id &&
                                                    row.previous_id !== row.server_id
                                                        ? "#" + row.previous_id + " → "
                                                        : ""}
                                                    #{row.server_id}
                                                </span>
                                            </span>
                                            <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs">
                                                {actions[row.action] || row.action}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                            <span>
                                                {row.actor_name || "系统"}
                                                {row.actor_id
                                                    ? " (#" + row.actor_id + ")"
                                                    : ""} · {sources[row.source] || row.source}
                                            </span>
                                            <time>{new Date(row.created_at).toLocaleString()}</time>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {row.changes?.length ?? 0} 项变更 ·{" "}
                                            <span className="group-open:hidden">展开详情</span>
                                            <span className="hidden group-open:inline">
                                                收起详情
                                            </span>
                                        </p>
                                    </summary>
                                    <div className="mt-3 space-y-2 border-t pt-3">
                                        <p className="break-all font-mono text-xs text-muted-foreground">
                                            UUID: {row.server_uuid}
                                        </p>
                                        {(row.changes ?? []).map((change, index) => (
                                            <div key={index} className="rounded border p-2">
                                                <p className="mb-1.5 text-xs font-medium">
                                                    {fields[change.field] || change.field}
                                                </p>
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    <p className="min-w-0 break-all text-xs">
                                                        <span className="mr-2 text-muted-foreground">
                                                            修改前
                                                        </span>
                                                        {value(change.before)}
                                                    </p>
                                                    <p className="min-w-0 break-all text-xs">
                                                        <span className="mr-2 text-muted-foreground">
                                                            修改后
                                                        </span>
                                                        {value(change.after)}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <span>
                        共 {total} 条 · 第 {page + 1} 页
                    </span>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={page === 0 || isValidating}
                            onClick={() => setPage(page - 1)}
                        >
                            上一页
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={(page + 1) * size >= total || isValidating}
                            onClick={() => setPage(page + 1)}
                        >
                            下一页
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
