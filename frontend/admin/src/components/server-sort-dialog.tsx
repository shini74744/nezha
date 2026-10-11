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

export function moveServerToPosition(current: ModelServer[], id: number, position: number): ModelServer[] {
    if (!Number.isInteger(position) || position < 1 || position > current.length) return current
    const from = current.findIndex(server => server.id === id)
    if (from < 0 || from === position - 1) return current
    return reorderServers(current, id, current[position - 1].id, from < position - 1)
}

function ServerPositionInput({ server, total, busy, onMove }: {
    server: ModelServer; total: number; busy: boolean; onMove: (position: number) => void
}) {
    const { t } = useTranslation()
    const [value, setValue] = useState("")
    const [editing, setEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const editorRef = useRef<HTMLDivElement>(null)
    const restoreFocus = useRef(false)
    useEffect(() => {
        if (editing) inputRef.current?.focus({ preventScroll: true })
        else if (restoreFocus.current) {
            restoreFocus.current = false
            triggerRef.current?.focus({ preventScroll: true })
        }
    }, [editing])
    useEffect(() => {
        if (!editing) return
        const outside = (event: PointerEvent) => {
            if (editorRef.current?.contains(event.target as Node)) return
            restoreFocus.current = false
            setEditing(false); setValue("")
        }
        document.addEventListener("pointerdown", outside, true)
        return () => document.removeEventListener("pointerdown", outside, true)
    }, [editing])
    const close = (focusTrigger = false) => {
        restoreFocus.current = focusTrigger
        setEditing(false)
        setValue("")
    }
    const apply = () => {
        if (busy || !value.trim()) return
        const position = Number(value)
        if (!Number.isInteger(position) || position < 1 || position > total) {
            toast.error(t("ServerPositionInvalid", { total })); return
        }
        onMove(position); close(true)
    }
    return <div ref={editorRef} className="flex items-center gap-1" data-position-editor={editing || undefined}
        onPointerDown={event => event.stopPropagation()}
        onKeyDown={event => { if (editing && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true) } }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close() }}>
        {editing ? <>
            <input ref={inputRef} type="number" inputMode="numeric" min={1} max={total} step={1} value={value} disabled={busy}
                placeholder={t("ServerPositionPlaceholder")} aria-label={t("ServerPositionInput", { name: server.name })}
                className="h-9 w-14 min-w-0 rounded-md border bg-background px-1.5 text-center text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onChange={event => setValue(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); apply() }
                }}/>
            <Button type="button" size="sm" variant="outline" className="h-9 px-2" disabled={busy || !value.trim()}
                aria-label={t("ServerPositionApply", { name: server.name })} onClick={apply}>{t("ServerMoveTo")}</Button>
        </> : <Button ref={triggerRef} type="button" size="sm" variant="outline" className="h-9 w-14 px-2" disabled={busy}
            aria-label={t("ServerPositionInput", { name: server.name })} aria-expanded={false}
            onClick={() => setEditing(true)}>{t("ServerPositionPlaceholder")}</Button>}
    </div>
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
            <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg p-4 sm:max-w-xl sm:p-6"
                onEscapeKeyDown={event => { if ((event.target as HTMLElement)?.closest('[data-position-editor="true"]')) event.preventDefault() }}>
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
                            className="relative flex cursor-grab select-none items-center gap-2 rounded-lg border bg-background p-3 active:cursor-grabbing data-[dragging]:border-primary data-[dragging]:opacity-50 max-sm:grid max-sm:grid-cols-[24px_20px_minmax(0,1fr)]"
                        >
                            {drag.preview?.target?.id === server.id &&
                                drag.preview.id !== server.id && (
                                    <span
                                        data-sort-drop={
                                            drag.preview.target.after ? "after" : "before"
                                        }
                                        className={`pointer-events-none absolute -left-px -right-px z-10 h-0.5 rounded bg-emerald-500 ${drag.preview.target.after ? "-bottom-1.5" : "-top-1.5"}`}
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
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 max-sm:col-span-2 max-sm:col-start-2 max-sm:justify-start max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11">
                                <ServerPositionInput server={server} total={ordered.length} busy={interactionBusy}
                                    onMove={position => setOrdered(current => moveServerToPosition(current, server.id, position))}/>
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
