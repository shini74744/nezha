import { swrFetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { UUIDReleaseButton } from "@/components/uuid-release"
import { Archive, RefreshCw, ShieldAlert } from "lucide-react"
import { useState } from "react"
import useSWR from "swr"

interface DeletedServer {
    uuid: string
    name: string
    original_id: number
    created_at: string
    deleted_by_id: number
    deleted_by_name: string
    report_count: number
    block_version: number
    released_at: number
    released_by_name: string
    last_report_at: number
}
export function DeletedServers() {
    const [page, setPage] = useState(0)
    const { data, error, isLoading, isValidating, mutate } = useSWR<{
        value: DeletedServer[]
        pagination: { total: number }
    }>(`/api/v1/waf/deleted-servers?offset=${page * 20}&limit=20`, swrFetcher, {
        refreshInterval: 15000,
    })
    const rows = data?.value ?? [],
        total = data?.pagination.total ?? 0
    return (
        <section className="min-w-0 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    后台删除后立即保留在这里，不要求再次上报。UUID
                    默认持续拉黑，管理员可手动放行；如再次连接，也会出现在“认证防火墙”。 原 ID
                    只作历史标识，可能被其他节点重新使用。
                </p>
                <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={isValidating}
                    onClick={() => void mutate()}
                >
                    <RefreshCw className={"mr-1 size-4 " + (isValidating ? "animate-spin" : "")} />
                    刷新
                </Button>
            </div>
            {error ? (
                <p role="alert" className="py-6 text-sm text-destructive">
                    加载已删除服务器失败，请重试。
                </p>
            ) : isLoading ? (
                <p className="py-6 text-center text-sm">加载中…</p>
            ) : rows.length === 0 ? (
                <div className="rounded-md border py-10 text-center text-sm text-muted-foreground">
                    <Archive className="mx-auto mb-2 size-6" />
                    暂无已删除服务器
                </div>
            ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {rows.map((row) => (
                        <article
                            key={row.uuid}
                            className={
                                "min-w-0 rounded-md border p-3 text-sm " +
                                (row.report_count && !row.released_at
                                    ? "border-amber-500/60 bg-amber-500/5"
                                    : "")
                            }
                        >
                            <div className="flex items-start justify-between gap-3">
                                <strong className="min-w-0 break-words">
                                    {row.name || "历史删除节点"}
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                        {row.original_id
                                            ? "原 ID #" + row.original_id
                                            : "原 ID 未记录"}
                                    </span>
                                </strong>
                                <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs">
                                    {row.released_at ? "已删除 · 已放行" : "已删除"}
                                </span>
                            </div>
                            {row.report_count > 0 && !row.released_at && (
                                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
                                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                                    <span>
                                        <strong>
                                            {row.last_report_at >= Date.now() / 1000 - 120
                                                ? "仍在上报"
                                                : "删除后曾再次上报"}
                                        </strong>
                                        <span className="ml-1">· 连接已拦截</span>
                                        <span className="mt-0.5 block opacity-80">
                                            最近上报：
                                            {row.last_report_at
                                                ? new Date(
                                                      row.last_report_at * 1000,
                                                  ).toLocaleString()
                                                : "未记录"}{" "}
                                            · 累计 {row.report_count} 次
                                        </span>
                                    </span>
                                </div>
                            )}
                            <p className="my-2 break-all font-mono text-xs text-muted-foreground">
                                UUID: {row.uuid}
                            </p>
                            <dl className="space-y-1.5 text-xs">
                                <div className="flex flex-wrap justify-between gap-2">
                                    <dt className="text-muted-foreground">删除时间</dt>
                                    <dd>{new Date(row.created_at).toLocaleString()}</dd>
                                </div>
                                <div className="flex flex-wrap justify-between gap-2">
                                    <dt className="text-muted-foreground">操作人</dt>
                                    <dd className="break-all">
                                        {row.deleted_by_name || "历史记录，未记录操作人"}
                                        {row.deleted_by_id ? " (#" + row.deleted_by_id + ")" : ""}
                                    </dd>
                                </div>
                                <div className="flex flex-wrap justify-between gap-2">
                                    <dt className="text-muted-foreground">删除后上报</dt>
                                    <dd>
                                        {row.report_count
                                            ? row.report_count +
                                              (row.released_at
                                                  ? " 次 · 放行前已拦截"
                                                  : " 次 · 已拒绝连接")
                                            : "尚未再次上报"}
                                    </dd>
                                </div>
                            </dl>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                                {row.released_at ? (
                                    <p className="text-muted-foreground">
                                        放行时间：
                                        {new Date(row.released_at * 1000).toLocaleString()} ·{" "}
                                        {row.released_by_name || "管理员"}
                                    </p>
                                ) : (
                                    <span className="text-muted-foreground">UUID 已拉黑</span>
                                )}
                                <UUIDReleaseButton
                                    uuid={row.uuid}
                                    name={row.name}
                                    blockVersion={row.block_version}
                                    releasedAt={row.released_at}
                                />
                            </div>
                        </article>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>共 {total} 个 · “仍在上报”指最近 2 分钟内有尝试</span>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={page === 0 || isValidating}
                        onClick={() => setPage(page - 1)}
                    >
                        上一页
                    </Button>
                    <span>{page + 1}</span>
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
        </section>
    )
}
