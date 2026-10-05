import { FetcherMethod, fetcher } from "@/api/api"
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Loader2, ShieldCheck } from "lucide-react"
import { useRef, useState } from "react"
import { useSWRConfig } from "swr"

export function UUIDReleaseButton({
    uuid,
    name,
    blockVersion,
    releasedAt = 0,
}: {
    uuid: string
    name: string
    blockVersion: number
    releasedAt?: number
}) {
    const { mutate } = useSWRConfig()
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState("")
    const sending = useRef(false)
    const selected = useRef({ uuid, name, block_version: blockVersion })
    const handleOpen = (next: boolean) => {
        if (sending.current) return
        if (next) {
            selected.current = { uuid, name, block_version: blockVersion }
            setError("")
            setDone(false)
        }
        setOpen(next)
    }
    const release = async () => {
        if (sending.current || done) return
        sending.current = true
        setPending(true)
        setError("")
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/waf/release-uuid", {
                uuid: selected.current.uuid,
                block_version: selected.current.block_version,
            })
            setDone(true)
            void mutate(
                (key) =>
                    typeof key === "string" &&
                    [
                        "/api/v1/waf/unknown-reports",
                        "/api/v1/waf/deleted-servers",
                        "/api/v1/server/operations",
                    ].some((prefix) => key.startsWith(prefix)),
            ).catch(() => undefined)
        } catch (e) {
            setError(e instanceof Error ? e.message : "放行失败，请刷新后重试")
        } finally {
            sending.current = false
            setPending(false)
        }
    }
    return (
        <AlertDialog open={open} onOpenChange={handleOpen}>
            {!releasedAt && (!done || selected.current.block_version !== blockVersion) && (
                <AlertDialogTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={!blockVersion}
                    >
                        <ShieldCheck className="size-3.5" />
                        放行 UUID
                    </Button>
                </AlertDialogTrigger>
            )}
            <AlertDialogContent className="max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-md overflow-y-auto rounded-lg p-4 sm:p-6">
                <AlertDialogHeader>
                    <AlertDialogTitle>{done ? "UUID 已放行" : "确认放行 UUID？"}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {done
                            ? "黑名单已解除，删除记录和历史上报仍然保留。"
                            : "仅解除这个 UUID 的删除黑名单，不会解除 IP 封禁，也不会绕过连接密钥验证。"}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="min-w-0 rounded-md border p-3 text-sm">
                    <p className="break-words font-medium">
                        {selected.current.name || "已删除节点"}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {selected.current.uuid}
                    </p>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                    节点下次携带有效密钥连接时可重新注册；不会恢复原 ID、配置或监控历史。已卸载的
                    Agent 需要重新安装。
                </p>
                {error && (
                    <p role="alert" className="break-words text-sm text-destructive">
                        {error}
                    </p>
                )}
                <AlertDialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => handleOpen(false)} disabled={pending}>
                        {done ? "关闭" : "取消"}
                    </Button>
                    {!done && (
                        <Button onClick={() => void release()} disabled={pending}>
                            {pending && <Loader2 className="mr-1 size-4 animate-spin" />}
                            {pending ? "正在放行…" : "确认放行"}
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
