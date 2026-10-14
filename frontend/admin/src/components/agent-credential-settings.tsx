import { FetcherMethod, fetcher, swrFetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { RefreshCw, Settings2 } from "lucide-react"
import { useRef, useState } from "react"
import useSWR from "swr"

interface Row {
    id: number
    uuid: string
    name: string
    status: "legacy" | "pending" | "active"
    message: string
}
export function AgentCredentialSettings() {
    const [open, setOpen] = useState(false),
        [pending, setPending] = useState(false),
        [error, setError] = useState("")
    const busy = useRef(false)
    const {
        data,
        mutate,
        isValidating,
        error: loadError,
    } = useSWR<Row[]>(open ? "/api/v1/agent-credentials/migrations" : null, swrFetcher, {
        refreshInterval: 5000,
    })
    const rows = data ?? []
    async function migrate(ids: number[]) {
        if (busy.current || !ids.length) return
        busy.current = true
        setPending(true)
        setError("")
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/agent-credentials/migrate", ids)
        } catch (e) {
            setError(e instanceof Error ? e.message : "迁移请求失败")
        } finally {
            await mutate()
            busy.current = false
            setPending(false)
        }
    }
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!busy.current) setOpen(next)
            }}
        >
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="rounded-lg"
                    title="认证设置"
                    aria-label="认证设置"
                >
                    <Settings2 className="size-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-2xl overflow-y-auto rounded-lg p-4 sm:p-6">
                <DialogHeader>
                    <DialogTitle>认证设置</DialogTitle>
                    <DialogDescription>
                        每台服务器使用独立 UUID
                        和密钥。逐台确认新密钥连接后，才停用该节点的旧认证；离线节点等待上线。
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-sm">
                        已生效 {rows.filter((row) => row.status === "active").length} /{" "}
                        {rows.length}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pending || isValidating}
                            onClick={() => void mutate()}
                        >
                            <RefreshCw className="mr-1 size-4" />
                            刷新
                        </Button>
                        <Button
                            size="sm"
                            disabled={pending || !rows.some((row) => row.status !== "active")}
                            onClick={() =>
                                void migrate(
                                    rows
                                        .filter((row) => row.status !== "active")
                                        .map((row) => row.id),
                                )
                            }
                        >
                            逐台迁移
                        </Button>
                    </div>
                </div>
                {(error || loadError) && (
                    <p role="alert" className="text-sm text-destructive">
                        {error || "加载失败，请重试"}
                    </p>
                )}
                <div className="space-y-2">
                    {rows.map((row) => (
                        <article
                            key={row.uuid}
                            className="flex min-w-0 items-center justify-between gap-3 rounded-md border p-3"
                        >
                            <div className="min-w-0">
                                <p className="break-words text-sm font-medium">
                                    {row.name}{" "}
                                    <span className="text-muted-foreground">#{row.id}</span>
                                </p>
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                    {row.message}
                                </p>
                            </div>
                            {row.status !== "active" && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={pending}
                                    className="shrink-0"
                                    onClick={() => void migrate([row.id])}
                                >
                                    迁移
                                </Button>
                            )}
                        </article>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}
