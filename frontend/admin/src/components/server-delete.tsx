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
                            ? "节点记录已删除，UUID 和密钥已同时拉黑，再次上报将被拒绝。"
                            : `确认删除选中的 ${selected.current.length} 个节点？删除后将同时拉黑 UUID 和密钥，只有手动放行后才能重新上报。此操作不可撤销。`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {!result && (
                    <p className="text-sm leading-6 text-muted-foreground">
                        在线节点会在后台尝试卸载；离线节点仅删除，不再自动卸载。无论卸载是否成功，UUID
                        和密钥都保持拉黑。
                    </p>
                )}
                {result && (
                    <div className="max-h-[40dvh] space-y-2 overflow-y-auto" role="status">
                        {result.cleanup.map((item) => (
                            <div key={item.id} className="rounded-md border px-3 py-2 text-sm">
                                <span className="font-medium">
                                    #{item.id} ·{" "}
                                    {item.status === "queued"
                                        ? "后台卸载中"
                                        : item.status === "started"
                                          ? "卸载已启动"
                                          : item.status === "offline"
                                            ? "离线，仅删除"
                                            : "请手动卸载"}
                                </span>
                                <p className="mt-1 break-words text-muted-foreground">
                                    {item.message}
                                </p>
                            </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                            可在“防火墙 → 已删除服务器”查看卸载状态；卸载是否完成请在服务器上确认。
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
                            {pending ? "正在删除…" : "确认卸载并删除"}
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
