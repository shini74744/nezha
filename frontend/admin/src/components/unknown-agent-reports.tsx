import { swrFetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { RefreshCw, ShieldBan } from "lucide-react"
import { useState } from "react"
import useSWR from "swr"

interface UnknownReport {
    uuid: string
    name: string
    last_ip: string
    created_at: string
    first_report_at: number
    last_report_at: number
    report_count: number
}
interface UnknownReportPage {
    value: UnknownReport[]
    pagination: { total: number; offset: number; limit: number }
}
const date = (value: number | string) =>
    value ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString() : "—"

export function UnknownAgentReports() {
    const [page, setPage] = useState(0)
    const size = 20
    const { data, error, isLoading, isValidating, mutate } = useSWR<UnknownReportPage>(
        `/api/v1/waf/unknown-reports?offset=${page * size}&limit=${size}`,
        swrFetcher,
        { refreshInterval: 15000 },
    )
    const rows = data?.value ?? []
    const total = data?.pagination.total ?? 0
    return (
        <section className="min-w-0 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    已删除节点恢复上线、继续上报时，会在这里记录并按 UUID
                    拦截。面板重启后仍有效，不会封禁同 IP 的其他正常节点。
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void mutate()}
                    disabled={isValidating}
                >
                    <RefreshCw className={`mr-1 size-4 ${isValidating ? "animate-spin" : ""}`} />
                    刷新
                </Button>
            </div>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    加载未知上报失败，请重试。
                </p>
            )}
            {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
            ) : rows.length === 0 ? (
                <div className="rounded-md border py-10 text-center text-sm text-muted-foreground">
                    <ShieldBan className="mx-auto mb-2 size-6" />
                    暂无未知上报
                    <p className="mt-1 text-xs">已删除但尚未重连的节点不会出现在这里。</p>
                </div>
            ) : (
                <>
                    <div className="hidden overflow-x-auto rounded-md border md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {[
                                        "节点 / UUID",
                                        "来源 IP",
                                        "上报次数",
                                        "首次上报",
                                        "最近上报",
                                        "处理",
                                    ].map((label) => (
                                        <TableHead key={label}>{label}</TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((row) => (
                                    <TableRow key={row.uuid}>
                                        <TableCell>
                                            <p>{row.name || "已删除节点"}</p>
                                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                                                {row.uuid}
                                            </p>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {row.last_ip || "未知"}
                                        </TableCell>
                                        <TableCell>{row.report_count}</TableCell>
                                        <TableCell className="text-xs">
                                            {date(row.first_report_at)}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {date(row.last_report_at)}
                                        </TableCell>
                                        <TableCell>
                                            <span className="whitespace-nowrap rounded border px-2 py-1 text-xs">
                                                已拦截
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="space-y-2 md:hidden">
                        {rows.map((row) => (
                            <article
                                key={row.uuid}
                                className="min-w-0 rounded-md border p-3 text-sm"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <strong className="break-all">
                                        {row.name || "已删除节点"}
                                    </strong>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        已拦截 · {row.report_count} 次
                                    </span>
                                </div>
                                <p className="my-2 break-all font-mono text-xs text-muted-foreground">
                                    {row.uuid}
                                </p>
                                <dl className="space-y-1 text-xs">
                                    <div className="flex justify-between gap-3">
                                        <dt className="shrink-0">来源 IP</dt>
                                        <dd className="break-all">{row.last_ip || "未知"}</dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="shrink-0">首次上报</dt>
                                        <dd>{date(row.first_report_at)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="shrink-0">最近上报</dt>
                                        <dd>{date(row.last_report_at)}</dd>
                                    </div>
                                </dl>
                            </article>
                        ))}
                    </div>
                </>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>共 {total} 个节点 · 仅记录上报，不自动解除拉黑</span>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                    >
                        上一页
                    </Button>
                    <span>{page + 1}</span>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={(page + 1) * size >= total}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        下一页
                    </Button>
                </div>
            </div>
        </section>
    )
}
