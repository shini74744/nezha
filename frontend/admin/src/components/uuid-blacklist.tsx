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
import { UUIDReleaseButton } from "@/components/uuid-release"
import { RefreshCw, ShieldBan } from "lucide-react"
import { useState } from "react"
import useSWR from "swr"

interface UUIDRow {
    uuid: string
    name: string
    original_id: number
    created_at: string
    block_version: number
    released_at: number
    released_by_name: string
    kind?: "deleted" | "rejected"
}
export function UUIDBlacklist({ onReview }: { onReview: () => void }) {
    const [open, setOpen] = useState(false),
        [page, setPage] = useState(0),
        [search, setSearch] = useState(""),
        [q, setQ] = useState(""),
        [status, setStatus] = useState("all")
    const { data, error, isLoading, isValidating, mutate } = useSWR<{
        value: UUIDRow[]
        pagination: { total: number }
    }>(
        open
            ? `/api/v1/waf/uuid-blacklist?offset=${page * 20}&limit=20&status=${status}&q=${encodeURIComponent(q)}`
            : null,
        swrFetcher,
        { refreshInterval: 15000 },
    )
    const total = data?.pagination.total ?? 0
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1.5">
                    <ShieldBan className="size-4" />
                    UUID 黑名单
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-3xl flex-col gap-3 overflow-hidden rounded-lg p-4 sm:p-6">
                <DialogHeader className="pr-6">
                    <DialogTitle>UUID 黑名单</DialogTitle>
                    <DialogDescription>
                        记录已删除节点和被拦截的认证信息。清理删除记录不会解除封禁，UUID
                        与密钥只能整组放行。
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex min-w-0 flex-wrap gap-2"
                    onSubmit={(e) => {
                        e.preventDefault()
                        setQ(search.trim())
                        setPage(0)
                    }}
                >
                    <Input
                        className="min-w-0 flex-1 basis-44"
                        aria-label="搜索 UUID 黑名单"
                        placeholder="名称、UUID 或原 ID"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <Button type="submit" variant="outline">
                        搜索
                    </Button>
                    <select
                        aria-label="黑名单状态"
                        className="h-10 rounded-md border bg-background px-2 text-sm"
                        value={status}
                        onChange={(e) => {
                            setStatus(e.target.value)
                            setPage(0)
                        }}
                    >
                        <option value="all">全部记录</option>
                        <option value="blocked">拦截中</option>
                        <option value="released">已放行</option>
                    </select>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="刷新黑名单"
                        disabled={isValidating}
                        onClick={() => void mutate()}
                    >
                        <RefreshCw className={"size-4 " + (isValidating ? "animate-spin" : "")} />
                    </Button>
                </form>
                <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
                    {error ? (
                        <p role="alert" className="py-6 text-sm text-destructive">
                            加载失败，请重试。
                        </p>
                    ) : isLoading ? (
                        <p className="py-6 text-center text-sm">加载中…</p>
                    ) : !data?.value.length ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            暂无匹配记录
                        </p>
                    ) : (
                        data.value.map((row) => (
                            <article
                                key={row.uuid}
                                className="min-w-0 rounded-md border p-3 text-sm"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <strong className="min-w-0 break-words">
                                        {row.name || "历史节点"}
                                        {row.original_id > 0 && (
                                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                原 ID #{row.original_id}
                                            </span>
                                        )}
                                    </strong>
                                    <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs">
                                        {row.released_at ? "已放行" : "拦截中"}
                                    </span>
                                </div>
                                <p className="my-2 break-all font-mono text-xs text-muted-foreground">
                                    {row.uuid}
                                </p>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">
                                        拉黑时间：
                                        {new Date(row.created_at).toLocaleString("zh-CN", {
                                            hour12: false,
                                        })}
                                    </span>
                                    {row.kind === "rejected" ? (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setOpen(false)
                                                onReview()
                                            }}
                                        >
                                            查看认证记录
                                        </Button>
                                    ) : (
                                        <UUIDReleaseButton
                                            uuid={row.uuid}
                                            name={row.name}
                                            blockVersion={row.block_version}
                                            releasedAt={row.released_at}
                                        />
                                    )}
                                </div>
                                {row.kind === "rejected" && (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        认证配对拦截，不影响此 UUID 的合法配对。
                                    </p>
                                )}
                                {!!row.released_at && (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        放行时间：
                                        {new Date(row.released_at * 1000).toLocaleString("zh-CN", {
                                            hour12: false,
                                        })}
                                    </p>
                                )}
                            </article>
                        ))
                    )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <span>
                        共 {total} 条 · 第 {page + 1} 页
                    </span>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={!page || isValidating}
                            onClick={() => setPage(page - 1)}
                        >
                            上一页
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={(page + 1) * 20 >= total || isValidating}
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
