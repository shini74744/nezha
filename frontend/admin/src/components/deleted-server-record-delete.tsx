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
import { Loader2, Trash2 } from "lucide-react"
import { useRef, useState } from "react"

export function DeletedServerRecordDelete({
    row,
    onDeleted,
}: {
    row: {
        uuid: string
        name: string
        block_version: number
        cleanup_revision?: number
        released_at: number
    }
    onDeleted: (uuid: string) => void
}) {
    const [open, setOpen] = useState(false),
        [pending, setPending] = useState(false),
        [error, setError] = useState("")
    const sending = useRef(false),
        selected = useRef(row)
    function changeOpen(next: boolean) {
        if (sending.current) return
        if (next) {
            selected.current = { ...row }
            setError("")
        }
        setOpen(next)
    }
    async function remove() {
        if (sending.current) return
        sending.current = true
        setPending(true)
        setError("")
        try {
            const target = selected.current
            await fetcher(FetcherMethod.POST, "/api/v1/waf/deleted-servers/delete", {
                uuid: target.uuid,
                block_version: target.block_version,
                cleanup_revision: target.cleanup_revision ?? 0,
            })
            setOpen(false)
            onDeleted(target.uuid)
        } catch (e) {
            setError(e instanceof Error ? e.message : "删除失败，请刷新后重试")
        } finally {
            sending.current = false
            setPending(false)
        }
    }
    return (
        <AlertDialog open={open} onOpenChange={changeOpen}>
            <AlertDialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={"删除记录：" + (row.name || row.uuid)}
                    title="删除记录"
                >
                    <Trash2 className="size-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-md overflow-y-auto rounded-lg p-4 sm:p-6">
                <AlertDialogHeader>
                    <AlertDialogTitle>删除这条记录？</AlertDialogTitle>
                    <AlertDialogDescription>
                        仅移除“已删除服务器”中的记录，UUID 黑名单和操作历史仍保留。
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
                <p className="text-sm text-muted-foreground">
                    {selected.current.released_at
                        ? "此 UUID 仍保持已放行状态。"
                        : "此 UUID 仍会被拦截，只有手动放行后才能重新上报。"}{" "}
                    已下发的卸载命令无法撤回。
                </p>
                {error && (
                    <p role="alert" className="break-words text-sm text-destructive">
                        {error}
                    </p>
                )}
                <AlertDialogFooter className="gap-2">
                    <Button variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
                        取消
                    </Button>
                    <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
                        {pending && <Loader2 className="mr-1 size-4 animate-spin" />}
                        {pending ? "正在删除…" : "删除记录"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
