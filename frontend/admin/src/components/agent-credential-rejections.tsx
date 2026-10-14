import { FetcherMethod, fetcher, swrFetcher } from "@/api/api"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { RefreshCw, ShieldCheck } from "lucide-react"
import { useRef, useState } from "react"
import useSWR, { useSWRConfig } from "swr"

interface Row {
    id: string
    uuid: string
    name: string
    fingerprint: string
    last_ip: string
    first_report_at: number
    last_report_at: number
    report_count: number
    binding_version: number
    block_version: number
    existing: boolean
    can_admit: boolean
    reason: string
}
const date = (seconds: number) =>
    seconds ? new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false }) : "—"
export function AgentCredentialRejections() {
    const [page, setPage] = useState(0),
        [selected, setSelected] = useState<Row | null>(null),
        [pending, setPending] = useState(false),
        [error, setError] = useState("")
    const busy = useRef(false),
        size = 20,
        { mutate: mutateAll } = useSWRConfig()
    const {
        data,
        error: loadError,
        isValidating,
        mutate,
    } = useSWR<{ value: Row[]; pagination: { total: number } }>(
        `/api/v1/waf/credentials?offset=${page * size}&limit=${size}`,
        swrFetcher,
        { refreshInterval: 15000 },
    )
    const rows = data?.value ?? [],
        total = data?.pagination?.total ?? 0
    async function admit() {
        if (!selected || busy.current) return
        busy.current = true
        setPending(true)
        setError("")
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/waf/credentials/admit", {
                report_id: selected.id,
                binding_version: selected.binding_version,
                block_version: selected.block_version,
            })
            setSelected(null)
            if (rows.length === 1 && page > 0) setPage(page - 1)
            void mutateAll(
                (key) =>
                    typeof key === "string" &&
                    ["/api/v1/server", "/api/v1/waf/", "/api/v1/agent-credentials/"].some(
                        (prefix) => key.startsWith(prefix),
                    ),
            )
            await mutate()
        } catch (e) {
            setError(e instanceof Error ? e.message : "放行失败，请刷新后重试")
        } finally {
            busy.current = false
            setPending(false)
        }
    }
    return (
        <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">认证拦截记录</h3>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={isValidating || pending}
                    onClick={() => void mutate()}
                >
                    <RefreshCw className="mr-1 size-4" />
                    刷新
                </Button>
            </div>
            {loadError && (
                <p role="alert" className="text-sm text-destructive">
                    加载失败，请重试。
                </p>
            )}
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                {rows.map((row) => (
                    <article key={row.id} className="min-w-0 rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <strong className="break-words">{row.name || "未登记节点"}</strong>
                            <span className="text-xs text-muted-foreground">
                                已拦截 · {row.report_count} 次
                            </span>
                        </div>
                        <p className="mt-2 break-all font-mono text-xs">
                            UUID：{row.uuid || "未提供有效 UUID"}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs">
                            密钥指纹：{row.fingerprint}
                        </p>
                        <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {[
                                ["来源 IP", row.last_ip || "未知"],
                                ["首次上报", date(row.first_report_at)],
                                ["最近上报", date(row.last_report_at)],
                            ].map(([label, value]) => (
                                <div key={label} className="flex justify-between gap-3">
                                    <dt className="shrink-0">{label}</dt>
                                    <dd className="min-w-0 break-all text-right">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                                {row.reason}
                            </p>
                            {row.can_admit && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={pending}
                                    onClick={() => {
                                        setSelected({ ...row })
                                        setError("")
                                    }}
                                >
                                    <ShieldCheck className="mr-1 size-4" />
                                    整组放行
                                </Button>
                            )}
                        </div>
                    </article>
                ))}
            </div>
            {!data && !loadError ? (
                <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
            ) : (
                !rows.length && (
                    <p className="rounded-md border py-8 text-center text-sm text-muted-foreground">
                        暂无认证拦截记录
                    </p>
                )
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                    共 {total} 条 · 第 {page + 1} 页
                </span>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0 || pending}
                        onClick={() => setPage(page - 1)}
                    >
                        上一页
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={(page + 1) * size >= total || pending}
                        onClick={() => setPage(page + 1)}
                    >
                        下一页
                    </Button>
                </div>
            </div>
            <AlertDialog
                open={!!selected}
                onOpenChange={(next) => {
                    if (!next && !busy.current) setSelected(null)
                }}
            >
                <AlertDialogContent className="max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-md overflow-y-auto rounded-lg p-4 sm:p-6">
                    <AlertDialogHeader>
                        <AlertDialogTitle>放行这组认证信息？</AlertDialogTitle>
                        <AlertDialogDescription>
                            {selected?.existing
                                ? "将以这组 UUID 和密钥替换此节点的现有认证，原密钥将失效。"
                                : "将同时登记并放行这组 UUID 和密钥，节点会出现在服务器列表。"}{" "}
                            请确认来源是你信任的服务器。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 rounded-md border p-3 text-xs">
                        <p className="break-all">UUID：{selected?.uuid}</p>
                        <p className="break-all">密钥指纹：{selected?.fingerprint}</p>
                        <p className="break-all">来源 IP：{selected?.last_ip || "未知"}</p>
                    </div>
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <AlertDialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() => setSelected(null)}
                        >
                            取消
                        </Button>
                        <Button disabled={pending} onClick={() => void admit()}>
                            {pending ? "正在放行…" : "确认整组放行"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    )
}
