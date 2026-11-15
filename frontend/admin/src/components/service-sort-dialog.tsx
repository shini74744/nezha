import { updateServiceOrder } from "@/api/service"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { ModelService } from "@/types"
import { ArrowDown, ArrowUp, GripVertical, Search, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { KeyedMutator } from "swr"

interface ServiceSortDialogProps {
    services: ModelService[]
    mutate: KeyedMutator<ModelService[]>
}

export function reorderServices(
    current: ModelService[],
    draggedID: number,
    targetID: number,
    after: boolean,
): ModelService[] {
    if (draggedID === targetID) return current
    const from = current.findIndex((service) => service.id === draggedID)
    if (from < 0 || !current.some((service) => service.id === targetID)) return current
    const next = [...current]
    const [moved] = next.splice(from, 1)
    const targetIndex = next.findIndex((service) => service.id === targetID)
    next.splice(targetIndex + (after ? 1 : 0), 0, moved)
    return next
}

export function moveServiceToPosition(current: ModelService[], id: number, position: number): ModelService[] {
    if (!Number.isInteger(position) || position < 1 || position > current.length) return current
    const from = current.findIndex(service => service.id === id)
    if (from < 0 || from === position - 1) return current
    return reorderServices(current, id, current[position - 1].id, from < position - 1)
}

export function filterSortableServices(current: ModelService[], search: string) {
    const query = search.trim().toLowerCase()
    return current.map((service, index) => ({ service, index })).filter(({ service }) =>
        !query || service.name.toLowerCase().includes(query) || String(service.id).includes(query),
    )
}

function ServicePositionInput({ service, total, busy, onMove }: {
    service: ModelService; total: number; busy: boolean; onMove: (position: number) => void
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
            toast.error(t("ServicePositionInvalid", { total })); return
        }
        onMove(position); close(true)
    }
    return <div ref={editorRef} className="flex items-center gap-1" data-position-editor={editing || undefined}
        onPointerDown={event => event.stopPropagation()}
        onKeyDown={event => { if (editing && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true) } }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close() }}>
        {editing ? <>
            <input ref={inputRef} type="number" inputMode="numeric" min={1} max={total} step={1} value={value} disabled={busy}
                placeholder={t("ServicePositionPlaceholder")} aria-label={t("ServicePositionInput", { name: service.name })}
                className="h-9 w-14 min-w-0 rounded-md border bg-background px-1.5 text-center text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onChange={event => setValue(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); apply() }
                }}/>
            <Button type="button" size="sm" variant="outline" className="h-9 px-2" disabled={busy || !value.trim()}
                aria-label={t("ServicePositionApply", { name: service.name })} onClick={apply}>{t("ServiceMoveTo")}</Button>
        </> : <Button ref={triggerRef} type="button" size="sm" variant="outline" className="h-9 w-14 px-2" disabled={busy}
            aria-label={t("ServicePositionInput", { name: service.name })} aria-expanded={false}
            onClick={() => setEditing(true)}>{t("ServicePositionPlaceholder")}</Button>}
    </div>
}

export function ServiceSortDialog({ services, mutate }: ServiceSortDialogProps) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [ordered, setOrdered] = useState<ModelService[]>(services)
    const [originalIDs, setOriginalIDs] = useState<number[]>([])
    const [search, setSearch] = useState("")
    const searchRef = useRef<HTMLInputElement>(null)
    const visibleServices = filterSortableServices(ordered, search)
    const [saving, setSaving] = useState(false)
    const submitting = useRef(false)
    const busy = saving
    const changed = ordered.length !== originalIDs.length || ordered.some((service, index) => service.id !== originalIDs[index])
    const drag = useServerOrderDrag(open && !busy, (id, targetID, after) => {
        setOrdered((current) => reorderServices(current, id, targetID, after))
    }, "data-sort-service")
    const interactionBusy = busy || drag.preview !== null

    useEffect(() => {
        if (!open) setOrdered(services)
    }, [services, open])
    const handleOpenChange = (next: boolean) => {
        if (submitting.current) return
        if (next) {
            setOrdered(services)
            setOriginalIDs(services.map((service) => service.id))
            setSearch("")
            drag.cancel()
        }
        if (!next) drag.cancel()
        setOpen(next)
    }
    const changeSearch = (value: string) => {
        drag.cancel()
        setSearch(value)
        if (drag.listRef.current) drag.listRef.current.scrollTop = 0
    }
    const moveOne = (index: number, step: -1 | 1) => {
        if (busy || !ordered[index + step]) return
        setOrdered((current) =>
            reorderServices(current, current[index].id, current[index + step].id, step === 1),
        )
    }
    const saveOrder = async () => {
        if (submitting.current || !changed) return
        submitting.current = true
        setSaving(true)
        try {
            await updateServiceOrder(ordered.map((service) => service.id), originalIDs)
            setOpen(false)
            toast.success(t("ServiceOrderSaved"))
            try {
                await mutate()
            } catch {
                toast.warning(t("ServiceOrderRefreshFailed"))
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error))
            await mutate().catch(() => undefined)
        } finally {
            setSaving(false)
            submitting.current = false
        }
    }
    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <IconButton icon="menu" title={t("ServiceSort")} aria-label={t("ServiceSort")} />
            </DialogTrigger>
            <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg p-4 sm:max-w-xl sm:p-6"
                onEscapeKeyDown={event => { if ((event.target as HTMLElement)?.closest('[data-position-editor="true"]')) event.preventDefault() }}>
                <DialogHeader className="shrink-0">
                    <DialogTitle>{t("ServiceSort")}</DialogTitle>
                    <DialogDescription>{t("ServiceSortHint")}</DialogDescription>
                </DialogHeader>
                <div className="shrink-0 space-y-1.5">
                    <div className="relative">
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input ref={searchRef} type="search" value={search} disabled={interactionBusy}
                            aria-label={t("ServiceSortSearch")} placeholder={t("ServiceSortSearch")}
                            aria-describedby="service-sort-search-hint" className="pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none"
                            onChange={event => changeSearch(event.target.value)} />
                        {search && <Button type="button" variant="ghost" size="icon"
                            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                            disabled={interactionBusy} aria-label={t("ServiceSortSearchClear")}
                            onClick={() => { changeSearch(""); searchRef.current?.focus() }}>
                            <X aria-hidden="true" className="h-4 w-4" />
                        </Button>}
                    </div>
                    <p id="service-sort-search-hint" role="status" className="text-xs text-muted-foreground">
                        {t("ServiceSortSearchHint", { count: visibleServices.length, total: ordered.length })}
                    </p>
                </div>
                <div
                    ref={drag.listRef}
                    className="min-h-0 space-y-2 overflow-y-auto overscroll-contain scroll-auto pr-1"
                    aria-label={t("ServiceManualList")}
                    onPointerMove={drag.onPointerMove}
                    onPointerUp={drag.onPointerUp}
                    onPointerCancel={drag.onPointerCancel}
                    onLostPointerCapture={drag.onLostPointerCapture}
                    onWheel={drag.onWheel}
                    onScroll={drag.onScroll}
                >
                    {visibleServices.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("ServiceSortSearchEmpty")}</p>}
                    {visibleServices.map(({ service, index }) => (
                        <div
                            key={service.id}
                            data-sort-service={service.id}
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                            onPointerDown={(event) => drag.onPointerDown(event, service.id)}
                            data-dragging={drag.preview?.id === service.id || undefined}
                            className="relative flex cursor-grab select-none items-center gap-2 rounded-lg border bg-background p-3 active:cursor-grabbing data-[dragging]:border-primary data-[dragging]:opacity-50 max-sm:grid max-sm:grid-cols-[24px_20px_minmax(0,1fr)]"
                        >
                            {drag.preview?.target?.id === service.id &&
                                drag.preview.id !== service.id && (
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
                                <span className="break-all font-medium">{service.name}</span>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    ID {service.id}
                                </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 max-sm:col-span-2 max-sm:col-start-2 max-sm:justify-start max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11">
                                <ServicePositionInput service={service} total={ordered.length} busy={interactionBusy}
                                    onMove={position => setOrdered(current => moveServiceToPosition(current, service.id, position))}/>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-9 w-9"
                                    draggable={false}
                                    disabled={interactionBusy || index === 0}
                                    aria-label={t("ServiceMoveUp", { name: service.name })}
                                    title={t("ServiceMoveUp", { name: service.name })}
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
                                    aria-label={t("ServiceMoveDown", { name: service.name })}
                                    title={t("ServiceMoveDown", { name: service.name })}
                                    onClick={() => moveOne(index, 1)}
                                >
                                    <ArrowDown className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
                <DialogFooter className="shrink-0 gap-2">
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
