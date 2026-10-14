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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { copyToClipboard } from "@/lib/utils"
import { Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"

export interface AgentCredentialPair {
    uuid: string
    client_secret: string
    version: number
}
interface UnusedCredential {
    uuid: string
    version: number
    created_at: string
    fingerprint: string
}
export function AgentCredentialHistory({
    open,
    onOpenChange,
    copyCommand,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    copyCommand: (os: number, pair: AgentCredentialPair) => Promise<void>
}) {
    const [page, setPage] = useState(0),
        [pending, setPending] = useState(false),
        [selected, setSelected] = useState<UnusedCredential | null>(null),
        [revealed, setRevealed] = useState<AgentCredentialPair | null>(null),
        [error, setError] = useState("")
    const busy = useRef(false),
        revealing = useRef(false),
        viewEpoch = useRef(0),
        currentRows = useRef<UnusedCredential[]>([]),
        size = 20
    const {
        data,
        error: loadError,
        isValidating,
        mutate,
    } = useSWR<{ value: UnusedCredential[]; pagination: { total: number } }>(
        open ? `/api/v1/agent-credentials/unused?offset=${page * size}&limit=${size}` : null,
        swrFetcher,
        { refreshInterval: 5000 },
    )
    const rows = data?.value ?? [],
        total = data?.pagination?.total ?? 0
    currentRows.current = rows
    useEffect(() => {
        viewEpoch.current++
        setRevealed(null)
        return () => {
            viewEpoch.current++
        }
    }, [open, page])
    useEffect(() => {
        setRevealed((pair) =>
            !loadError &&
            pair &&
            rows.some((row) => row.uuid === pair.uuid && row.version === pair.version)
                ? pair
                : null,
        )
    }, [data, loadError])
    async function showSecret(row: UnusedCredential) {
        if (busy.current) return
        busy.current = true
        revealing.current = true
        setPending(true)
        setRevealed(null)
        const epoch = viewEpoch.current
        try {
            const pair = await fetcher<AgentCredentialPair>(
                FetcherMethod.POST,
                "/api/v1/agent-credentials/reuse",
                { uuid: row.uuid, version: row.version },
            )
            if (pair.uuid !== row.uuid || pair.version !== row.version || !pair.client_secret) {
                throw new Error("认证信息已变化，请刷新")
            }
            if (
                viewEpoch.current === epoch &&
                currentRows.current.some(
                    (current) => current.uuid === pair.uuid && current.version === pair.version,
                )
            )
                setRevealed(pair)
        } catch (e) {
            if (viewEpoch.current === epoch) {
                toast.error(e instanceof Error ? e.message : "密钥加载失败")
                void mutate()
            }
        } finally {
            busy.current = false
            revealing.current = false
            setPending(false)
        }
    }
    async function copySecret(secret: string) {
        try {
            await copyToClipboard(secret)
            toast.success("完整密钥已复制")
        } catch {
            toast.error("复制失败，请重试")
        }
    }
    async function reuse(row: UnusedCredential, os: number) {
        if (busy.current) return
        busy.current = true
        setPending(true)
        try {
            const pair = await fetcher<AgentCredentialPair>(
                FetcherMethod.POST,
                "/api/v1/agent-credentials/reuse",
                { uuid: row.uuid, version: row.version },
            )
            await copyCommand(os, pair)
            toast.success("安装命令已复制")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "复用失败")
            void mutate()
        } finally {
            busy.current = false
            setPending(false)
        }
    }
    async function remove() {
        if (!selected || busy.current) return
        busy.current = true
        setPending(true)
        setError("")
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/agent-credentials/delete", {
                uuid: selected.uuid,
                version: selected.version,
            })
            setSelected(null)
            if (rows.length === 1 && page > 0) setPage(page - 1)
            await mutate()
            toast.success("未使用认证已作废")
        } catch (e) {
            setError(e instanceof Error ? e.message : "删除失败")
        } finally {
            busy.current = false
            setPending(false)
        }
    }
    return (
        <>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!busy.current || revealing.current) {
                        if (!next) {
                            viewEpoch.current++
                            setRevealed(null)
                        }
                        onOpenChange(next)
                    }
                }}
            >
                <DialogContent className="max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-2xl overflow-y-auto rounded-lg p-4 sm:p-6">
                    <DialogHeader>
                        <DialogTitle>生成认证历史</DialogTitle>
                        <DialogDescription>
                            只显示尚未接入的认证信息。复用时可重新选择系统。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-between gap-2 text-sm">
                        <span>未使用 {total} 条</span>
                        <Button
                            size="sm"
                            variant="outline"
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
                    <div className="space-y-2">
                        {rows.map((row) => (
                            <article key={row.uuid} className="min-w-0 rounded-md border p-3">
                                <p className="break-all text-xs">
                                    UUID：<span className="font-mono">{row.uuid}</span>
                                </p>
                                <p className="mt-1 break-all text-xs text-muted-foreground">
                                    密钥指纹：<span className="font-mono">{row.fingerprint}</span>
                                </p>
                                <div className="mt-2 flex flex-wrap items-start gap-2 text-xs">
                                    <p className="min-w-0 flex-1 basis-40 break-all leading-7">
                                        完整密钥：
                                        <span className="select-all font-mono">
                                            {open &&
                                            revealed?.uuid === row.uuid &&
                                            revealed.version === row.version
                                                ? revealed.client_secret
                                                : "••••••••"}
                                        </span>
                                    </p>
                                    <div className="flex shrink-0 gap-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2 text-xs"
                                            disabled={pending}
                                            aria-label={
                                                (revealed?.uuid === row.uuid
                                                    ? "隐藏完整密钥："
                                                    : "显示完整密钥：") + row.uuid
                                            }
                                            onClick={() =>
                                                revealed?.uuid === row.uuid
                                                    ? setRevealed(null)
                                                    : void showSecret(row)
                                            }
                                        >
                                            {revealed?.uuid === row.uuid ? (
                                                <EyeOff className="mr-1 size-3.5" />
                                            ) : (
                                                <Eye className="mr-1 size-3.5" />
                                            )}
                                            {revealed?.uuid === row.uuid ? "隐藏" : "显示"}
                                        </Button>
                                        {open &&
                                            revealed?.uuid === row.uuid &&
                                            revealed.version === row.version && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs"
                                                    disabled={pending}
                                                    aria-label={"复制完整密钥：" + row.uuid}
                                                    onClick={() =>
                                                        void copySecret(revealed.client_secret)
                                                    }
                                                >
                                                    <Copy className="mr-1 size-3.5" />
                                                    复制
                                                </Button>
                                            )}
                                    </div>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                    <time
                                        dateTime={row.created_at}
                                        className="text-xs text-muted-foreground"
                                    >
                                        生成时间：
                                        {new Date(row.created_at).toLocaleString("zh-CN", {
                                            hour12: false,
                                        })}
                                    </time>
                                    <div className="flex gap-2">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={pending}
                                                >
                                                    <Copy className="mr-1 size-4" />
                                                    复用
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {["Linux", "macOS", "Windows"].map((os, index) => (
                                                    <DropdownMenuItem
                                                        key={os}
                                                        onSelect={() => void reuse(row, index + 1)}
                                                    >
                                                        {os}
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="size-9 text-destructive"
                                            disabled={pending}
                                            aria-label={"删除未使用认证：" + row.uuid}
                                            onClick={() => {
                                                setSelected({ ...row })
                                                setError("")
                                            }}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                    {!data && !loadError ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
                    ) : (
                        rows.length === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                暂无未使用认证
                            </p>
                        )
                    )}
                    <div className="flex items-center justify-between gap-2 text-sm">
                        <span>第 {page + 1} 页</span>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={pending || page === 0}
                                onClick={() => setPage(page - 1)}
                            >
                                上一页
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={pending || (page + 1) * size >= total}
                                onClick={() => setPage(page + 1)}
                            >
                                下一页
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <AlertDialog
                open={!!selected}
                onOpenChange={(next) => {
                    if (!next && !busy.current) setSelected(null)
                }}
            >
                <AlertDialogContent className="max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-md overflow-y-auto rounded-lg p-4 sm:p-6">
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除未使用认证？</AlertDialogTitle>
                        <AlertDialogDescription>
                            这组 UUID 和密钥将同时作废，之前复制的安装命令将无法接入。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <p className="break-all font-mono text-xs">{selected?.uuid}</p>
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
                        <Button
                            variant="destructive"
                            disabled={pending}
                            onClick={() => void remove()}
                        >
                            {pending ? "正在删除…" : "删除认证"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
