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
import { Loader2, Settings2 } from "lucide-react"
import { useRef, useState } from "react"
import { useSWRConfig } from "swr"

export interface DeletedCleanupRecord {
    uuid: string
    name: string
    block_version: number
    released_at: number
    cleanup_enabled?: boolean
    cleanup_revision?: number
    cleanup_state?: string
    cleanup_attempts?: number
    cleanup_last_attempt_at?: number
    cleanup_message?: string
    cleanup_unavailable?: string
}
const stateLabels: Record<string, string> = {
    off: "未开启",
    waiting: "等待重连",
    sending: "任务下发中",
    started: "已启动清理",
    failed: "清理未启动",
    unknown: "结果未知",
    cancelled: "已关闭",
}
export function DeletedAgentCleanup({ row }: { row: DeletedCleanupRecord }) {
    const { mutate } = useSWRConfig()
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState("")
    const [done, setDone] = useState(false)
    const sending = useRef(false)
    const selected = useRef(row)
    const handleOpen = (next: boolean) => {
        if (sending.current) return
        if (next) {
            selected.current = { ...row }
            setError("")
            setDone(false)
        }
        setOpen(next)
    }
    const save = async () => {
        if (sending.current || done) return
        sending.current = true
        setPending(true)
        setError("")
        const target = selected.current
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/waf/deleted-cleanup", {
                uuid: target.uuid,
                block_version: target.block_version,
                cleanup_revision: target.cleanup_revision ?? 0,
                enabled: !target.cleanup_enabled,
            })
            setDone(true)
            void mutate(
                (key) =>
                    typeof key === "string" &&
                    ["/api/v1/waf/deleted-servers", "/api/v1/server/operations"].some((prefix) =>
                        key.startsWith(prefix),
                    ),
            ).catch(() => undefined)
        } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败，请刷新后重试")
        } finally {
            sending.current = false
            setPending(false)
        }
    }
    const enabling = !selected.current.cleanup_enabled
    return (
        <div className="mt-3 border-t pt-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground">
                    重连自动卸载 ·{" "}
                    <span
                        className={row.cleanup_enabled ? "text-amber-700 dark:text-amber-300" : ""}
                    >
                        {row.released_at
                            ? "已停用（UUID 已放行）"
                            : (stateLabels[row.cleanup_state ?? "off"] ?? "未开启")}
                    </span>
                </p>
                <AlertDialog open={open} onOpenChange={handleOpen}>
                    <AlertDialogTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            aria-label={"自动卸载设置：" + row.name}
                        >
                            <Settings2 className="size-3.5" />
                            设置
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="max-h-[85dvh] w-[calc(100vw_-_2rem)] max-w-md overflow-y-auto rounded-lg p-4 sm:p-6">
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {done
                                    ? "设置已保存"
                                    : enabling
                                      ? "开启重连后自动卸载？"
                                      : "关闭自动卸载？"}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {done
                                    ? enabling
                                        ? "仅该节点等待有效重连后尝试卸载，UUID 仍保持拉黑。"
                                        : "已停止后续下发，已发出的卸载命令无法撤回。"
                                    : "仅作用于当前已删除节点，不影响其他服务器；不会放行 UUID 或恢复正常监控。"}
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
                        {!done && (
                            <div className="space-y-2 text-sm leading-6 text-muted-foreground">
                                {enabling ? (
                                    <>
                                        <p>
                                            重连身份校验通过后，后台会停止并卸载这个节点的哪吒
                                            Agent，清理对应安装文件。这是不可撤销操作，无需打开网页
                                            SSH。
                                        </p>
                                        <p>
                                            每次开启仅尝试一次；失败或结果未知需检查后手动重新开启。“已启动清理”不是卸载完成证明。
                                        </p>
                                    </>
                                ) : (
                                    <p>关闭后不再下发新任务，但无法停止已经开始的远端卸载。</p>
                                )}
                                {selected.current.cleanup_unavailable && (
                                    <p className="rounded-md border p-2 text-amber-700 dark:text-amber-300">
                                        {selected.current.cleanup_unavailable}
                                    </p>
                                )}
                            </div>
                        )}
                        {error && (
                            <p role="alert" className="break-words text-sm text-destructive">
                                {error}
                            </p>
                        )}
                        <AlertDialogFooter className="gap-2">
                            <Button
                                variant="outline"
                                disabled={pending}
                                onClick={() => handleOpen(false)}
                            >
                                {done ? "关闭" : "取消"}
                            </Button>
                            {!done && (
                                <Button
                                    variant={enabling ? "destructive" : "default"}
                                    disabled={
                                        pending ||
                                        (enabling &&
                                            (!!selected.current.cleanup_unavailable ||
                                                !!selected.current.released_at))
                                    }
                                    onClick={() => void save()}
                                >
                                    {pending && <Loader2 className="mr-1 size-4 animate-spin" />}
                                    {pending ? "保存中…" : enabling ? "确认开启" : "确认关闭"}
                                </Button>
                            )}
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            {!!row.cleanup_message && (
                <p className="mt-1.5 break-words leading-5 text-muted-foreground">
                    {row.cleanup_message}
                </p>
            )}
            {!!row.cleanup_last_attempt_at && (
                <p className="mt-1 text-muted-foreground">
                    最近执行：{new Date(row.cleanup_last_attempt_at * 1000).toLocaleString()} · 累计{" "}
                    {row.cleanup_attempts ?? 0} 次
                </p>
            )}
            {!row.cleanup_enabled && !!row.cleanup_unavailable && !row.released_at && (
                <p className="mt-1 break-words leading-5 text-muted-foreground">
                    {row.cleanup_unavailable}
                </p>
            )}
        </div>
    )
}
