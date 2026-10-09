import { reassignServerIDs, updateServerOrder } from "@/api/server"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { IconButton } from "@/components/xui/icon-button"
import { useServerOrderDrag } from "@/hooks/use-server-order-drag"
import { ModelServer } from "@/types"
import { ArrowDown, ArrowUp, GripVertical, ListRestart } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { KeyedMutator } from "swr"

interface ServerSortDialogProps {
    servers: ModelServer[]
    mutate: KeyedMutator<ModelServer[]>
}

export function reorderServers(
    current: ModelServer[],
    draggedID: number,
    targetID: number,
    after: boolean,
): ModelServer[] {
    if (draggedID === targetID) return current
    const from = current.findIndex((server) => server.id === draggedID)
    if (from < 0 || !current.some((server) => server.id === targetID)) return current
    const next = [...current]
    const [moved] = next.splice(from, 1)
    const targetIndex = next.findIndex((server) => server.id === targetID)
    next.splice(targetIndex + (after ? 1 : 0), 0, moved)
    return next
}

export function ServerSortDialog({ servers, mutate }: ServerSortDialogProps) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [ordered, setOrdered] = useState<ModelServer[]>(servers)
    const [originalIDs, setOriginalIDs] = useState<number[]>([])
    const [saving, setSaving] = useState(false)
    const [reassigning, setReassigning] = useState(false)
    const submitting = useRef(false)
    const busy = saving || reassigning
    const changed = ordered.some((server, index) => server.id !== originalIDs[index])
    const drag = useServerOrderDrag(open && !busy, (id, targetID, after) => {
        setOrdered((current) => reorderServers(current, id, targetID, after))
    })
    const interactionBusy = busy || drag.preview !== null

    useEffect(() => {
        if (!open) setOrdered(servers)
    }, [servers, open])
    const handleOpenChange = (next: boolean) => {
        if (submitting.current || reassigning) return
        if (next) {
            setOrdered(servers)
            setOriginalIDs(servers.map((server) => server.id))
            drag.cancel()
        }
        if (!next) drag.cancel()
        setOpen(next)
    }
    const moveOne = (index: number, step: -1 | 1) => {
        if (busy || !ordered[index + step]) return
        setOrdered((current) =>
            reorderServers(current, current[index].id, current[index + step].id, step === 1),
        )
    }
    const saveOrder = async () => {
        if (submitting.current || !changed) return
        submitting.current = true
        setSaving(true)
        try {
            await updateServerOrder(ordered.map((server) => server.id))
            setOpen(false)
            toast.success(t("ServerOrderSaved"))
            try {
                await mutate()
            } catch {
                toast.warning(t("ServerOrderRefreshFailed"))
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
        } finally {
            setSaving(false)
            submitting.current = false
        }
    }
    const assignSystemIDs = async () => {
        if (submitting.current) return
        submitting.current = true
        setReassigning(true)
        try {
            await reassignServerIDs(ordered.map((server) => server.id))
            toast(t("Done"), { description: t("ServerIDReassignRestarting") })
            setOpen(false)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
            setReassigning(false)
        } finally {
            submitting.current = false
        }
    }
    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <IconButton icon="menu" title={t("ServerSort")} aria-label={t("ServerSort")} />
            </DialogTrigger>
            <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg p-4 sm:max-w-xl sm:p-6">
                <DialogHeader className="shrink-0">
                    <DialogTitle>{t("ServerSort")}</DialogTitle>
                    <DialogDescription>{t("ServerSortHint")}</DialogDescription>
                </DialogHeader>
                <div
                    ref={drag.listRef}
                    className="min-h-0 space-y-2 overflow-y-auto overscroll-contain scroll-auto pr-1"
                    aria-label={t("ServerManualList")}
                    onPointerMove={drag.onPointerMove}
                    onPointerUp={drag.onPointerUp}
                    onPointerCancel={drag.onPointerCancel}
                    onLostPointerCapture={drag.onLostPointerCapture}
                    onWheel={drag.onWheel}
                    onScroll={drag.onScroll}
                >
                    {ordered.map((server, index) => (
                        <div
                            key={server.id}
                            data-sort-server={server.id}
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                            onPointerDown={(event) => drag.onPointerDown(event, server.id)}
                            data-dragging={drag.preview?.id === server.id || undefined}
                            className="relative flex cursor-grab select-none items-center gap-2 rounded-lg border bg-background p-3 active:cursor-grabbing data-[dragging]:border-primary data-[dragging]:opacity-50"
                        >
                            {drag.preview?.target?.id === server.id &&
                                drag.preview.id !== server.id && (
                                    <span
                                        data-sort-drop={
                                            drag.preview.target.after ? "after" : "before"
                                        }
                                        className={`pointer-events-none absolute -left-px -right-px z-10 h-0.5 rounded bg-primary ${drag.preview.target.after ? "-bottom-1.5" : "-top-1.5"}`}
                                    />
                                )}
                            <span data-sort-handle className="touch-none shrink-0 p-1">
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                            </span>
                            <span
                                className="min-w-5 shrink-0 text-sm text-muted-foreground"
                                data-sort-position
                            >
                                {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <span className="break-all font-medium">{server.name}</span>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    ID {server.id}
                                </div>
                            </div>
                            <div className="flex shrink-0 gap-1">
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-9 w-9"
                                    draggable={false}
                                    disabled={interactionBusy || index === 0}
                                    aria-label={t("ServerMoveUp", { name: server.name })}
                                    title={t("ServerMoveUp", { name: server.name })}
                                    onClick={() => moveOne(index, -1)}
                                >
                                    <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-9 w-9"
                                    draggable={false}
                                    disabled={interactionBusy || index === ordered.length - 1}
                                    aria-label={t("ServerMoveDown", { name: server.name })}
                                    title={t("ServerMoveDown", { name: server.name })}
                                    onClick={() => moveOne(index, 1)}
                                >
                                    <ArrowDown className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    {t("ServerIDReassignHint")}
                </div>
                <DialogFooter className="shrink-0 gap-2 sm:justify-between">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="destructive"
                                className="h-auto min-h-10 whitespace-normal text-left"
                                disabled={interactionBusy || !ordered.length}
                            >
                                <ListRestart className="mr-2 h-4 w-4 shrink-0" />
                                {t("ServerIDReassign")}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    {t("ServerIDReassignConfirmTitle")}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t("ServerIDReassignConfirm")}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={assignSystemIDs}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    {t("Confirm")}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <Button
                        onClick={saveOrder}
                        disabled={interactionBusy || !changed || !ordered.length}
                    >
                        {saving ? t("Loading") : t("Save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
