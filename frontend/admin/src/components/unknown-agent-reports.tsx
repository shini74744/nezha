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
import { UUIDReleaseButton } from "@/components/uuid-release"
import { RefreshCw, ShieldBan } from "lucide-react"
import { useState } from "react"
import useSWR from "swr"

interface UnknownReport {
    uuid: string
    kind: "deleted" | "unregistered" | "registered" | "conflict" | "uuid_missing" | "uuid_invalid"
    previous_ip?: string
    previous_peer?: string
    last_peer?: string
    name: string
    last_ip: string
    created_at: string
    first_report_at: number
    last_report_at: number
    report_count: number
    released_at: number
    block_version: number
}
interface UnknownReportPage {
    value: UnknownReport[]
    pagination: { total: number; offset: number; limit: number }
}
const date = (value: number | string) =>
    value ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString() : "—"

const labels = {
    deleted: "已删除节点重连",
    unregistered: "未登记 UUID 认证失败",
    registered: "已有 UUID 认证失败",
    conflict: "疑似 UUID 冲突",
    uuid_missing: "UUID 缺失",
    uuid_invalid: "UUID 格式不合法",
}
const reportKey = (row: UnknownReport) =>
    JSON.stringify([row.kind, row.uuid, row.uuid ? "" : row.last_ip])
const reportUUID = (row: UnknownReport) =>
    row.uuid || (row.kind === "uuid_missing" ? "UUID：未提供" : "UUID：格式不合法（原文不保存）")
const reportName = (row: UnknownReport) =>
    row.name ||
    (row.kind === "uuid_missing" || row.kind === "uuid_invalid"
        ? "未识别节点"
        : row.kind === "unregistered"
          ? "未登记节点"
          : row.kind === "deleted"
            ? "已删除节点"
            : "已有节点")
const reportStatus = (row: UnknownReport) =>
    row.kind === "conflict"
        ? "待核查 · 未自动封禁"
        : row.kind === "deleted"
          ? row.released_at
              ? "UUID 已放行"
              : "UUID 已拉黑"
          : "认证已拒绝"
function ReportSource({ row }: { row: UnknownReport }) {
    return (
        <div className="min-w-0 break-all font-mono text-xs">
            {row.kind === "conflict" ? (
                <>
                    <p>旧连接：{row.previous_ip || "未知"}</p>
                    <p>新连接：{row.last_ip || "未知"}</p>
                    <details className="mt-1 text-muted-foreground">
                        <summary className="cursor-pointer font-sans">连接端点</summary>
                        <p>{row.previous_peer || "—"}</p>
                        <p>{row.last_peer || "—"}</p>
                    </details>
                </>
            ) : (
                row.last_ip || "未知"
            )}
        </div>
    )
}

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
                    记录已有/未登记 UUID 认证失败、UUID 缺失或格式不合法、已删除节点重连和疑似 UUID
                    冲突。 新 UUID 携带有效密钥正常注册，不计入异常。 冲突表示同一 UUID
                    的不同连接重叠上报，可能来自重复安装或短时重连，请核查；不会自动封禁正常节点。
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
                    加载认证记录失败，请重试。
                </p>
            )}
            {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
            ) : rows.length === 0 ? (
                <div className="rounded-md border py-10 text-center text-sm text-muted-foreground">
                    <ShieldBan className="mx-auto mb-2 size-6" />
                    暂无认证异常记录
                    <p className="mt-1 text-xs">已删除但尚未重连的节点，请查看“已删除服务器”。</p>
                </div>
            ) : (
                <>
                    <div className="hidden overflow-x-auto rounded-md border md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {[
                                        "节点 / UUID",
                                        "类型",
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
                                    <TableRow
                                        key={reportKey(row)}
                                        className={
                                            row.kind === "conflict" ? "bg-amber-500/10" : undefined
                                        }
                                    >
                                        <TableCell>
                                            <p>{reportName(row)}</p>
                                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                                                {reportUUID(row)}
                                            </p>
                                        </TableCell>
                                        <TableCell className="max-w-40 text-xs">
                                            {labels[row.kind]}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            <ReportSource row={row} />
                                        </TableCell>
                                        <TableCell>{row.report_count}</TableCell>
                                        <TableCell className="text-xs">
                                            {date(row.first_report_at)}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {date(row.last_report_at)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="whitespace-nowrap rounded border px-2 py-1 text-xs">
                                                    {reportStatus(row)}
                                                </span>
                                                {row.kind === "deleted" && (
                                                    <UUIDReleaseButton
                                                        uuid={row.uuid}
                                                        name={row.name}
                                                        blockVersion={row.block_version}
                                                        releasedAt={row.released_at}
                                                    />
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="space-y-2 md:hidden">
                        {rows.map((row) => (
                            <article
                                key={reportKey(row)}
                                className={
                                    "min-w-0 rounded-md border p-3 text-sm " +
                                    (row.kind === "conflict"
                                        ? "border-amber-500/60 bg-amber-500/10"
                                        : "")
                                }
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <strong className="break-all">{reportName(row)}</strong>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {labels[row.kind]} · {row.report_count} 次
                                    </span>
                                </div>
                                <p className="my-2 break-all font-mono text-xs text-muted-foreground">
                                    {reportUUID(row)}
                                </p>
                                <dl className="space-y-1 text-xs">
                                    <div className="flex justify-between gap-3">
                                        <dt className="shrink-0">来源 IP</dt>
                                        <dd className="min-w-0">
                                            <ReportSource row={row} />
                                        </dd>
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
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                    <span>{reportStatus(row)}</span>
                                    {row.kind === "deleted" && (
                                        <UUIDReleaseButton
                                            uuid={row.uuid}
                                            name={row.name}
                                            blockVersion={row.block_version}
                                            releasedAt={row.released_at}
                                        />
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                </>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>共 {total} 条分类记录 · 认证失败不代表该节点身份已验证</span>
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
