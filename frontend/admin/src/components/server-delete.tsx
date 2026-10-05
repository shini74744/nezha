import { ServerDeleteResult, deleteServer } from "@/api/server"
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
import { IconButton } from "@/components/xui/icon-button"
import { Loader2 } from "lucide-react"
import { useRef, useState } from "react"

export function ServerDeleteButton({
    ids,
    onUpdated,
}: {
    ids: number[]
    onUpdated: () => Promise<unknown>
}) {
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState(false)
    const [result, setResult] = useState<ServerDeleteResult>()
    const [error, setError] = useState("")
    const sending = useRef(false)
    const selected = useRef<number[]>([])
    const attempted = useRef(false)
    const handleOpen = (value: boolean) => {
        if (sending.current) return
        if (value) {
            selected.current = [...ids]
            attempted.current = false
            setResult(undefined)
            setError("")
        }
        setOpen(value)
        // Keep the row mounted until the result has been read.
        if (!value && attempted.current) void onUpdated().catch(() => undefined)
    }
    const remove = async () => {
        if (sending.current || !selected.current.length) return
        sending.current = true
        attempted.current = true
        setPending(true)
        setError("")
        try {
            const response = await deleteServer(selected.current)
            setResult(response)
        } catch (e) {
            setError(e instanceof Error ? e.message : "删除失败，请刷新后重试")
        } finally {
            sending.current = false
            setPending(false)
        }
    }
    return (
        <AlertDialog open={open} onOpenChange={handleOpen}>
            <AlertDialogTrigger asChild>
                <IconButton
                    variant="destructive"
                    icon="trash"
                    className="text-white"
                    disabled={!ids.length}
                    aria-label="卸载并删除节点"
                />
            </AlertDialogTrigger>
            <AlertDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>{result ? "删除结果" : "卸载并删除节点"}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {result
                            ? "节点记录已删除，UUID 已拉黑，再次上报将被拒绝。"
                            : `确认删除选中的 ${ids.length} 个节点？会先尝试启动远端 Agent 的停止、卸载和文件清理，再删除面板记录并拉黑 UUID。此操作不可撤销。`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {!result && (
                    <p className="text-sm leading-6 text-muted-foreground">
                        离线、禁止命令执行或不支持标准卸载的节点，仍会删除并拉黑，但无法保证远端清理完成。只清理匹配
                        UUID 的标准 Agent 文件，不影响同机面板和其他实例；不适用于 F50 等特殊节点。
                    </p>
                )}
                {result && (
                    <div className="max-h-[40dvh] space-y-2 overflow-y-auto" role="status">
                        {result.cleanup.map((item) => (
                            <div key={item.id} className="rounded-md border px-3 py-2 text-sm">
                                <span className="font-medium">
                                    #{item.id} ·{" "}
                                    {item.status === "started" ? "已启动清理" : "远端未确认清理"}
                                </span>
                                <p className="mt-1 break-words text-muted-foreground">
                                    {item.message}
                                </p>
                            </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                            “已启动”不是卸载完成回执；停止 Agent
                            后连接会断开。后续异常上报可在“防火墙 → 认证防火墙”中查看。
                        </p>
                    </div>
                )}
                {error && (
                    <p role="alert" className="break-words text-sm text-destructive">
                        {error}
                    </p>
                )}
                <AlertDialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => handleOpen(false)} disabled={pending}>
                        {result ? "关闭" : "取消"}
                    </Button>
                    {!result && (
                        <Button
                            variant="destructive"
                            onClick={remove}
                            disabled={pending || !ids.length}
                        >
                            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                            {pending ? "正在启动卸载并删除…" : "确认卸载并删除"}
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
