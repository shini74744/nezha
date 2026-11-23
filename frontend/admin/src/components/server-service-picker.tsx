import {
    type ServerServiceChoice,
    type ServerServicePreference,
    getServerServices,
    setServerServices,
} from "@/api/server-services"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useServerOrderDrag } from "@/hooks/use-server-order-drag"
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

export function reorderServerServices(
    rows: ServerServicePreference[],
    id: number,
    target: number,
    after: boolean,
) {
    if (id === target) return rows
    const moved = rows.find((row) => row.service_id === id)
    if (!moved || !rows.some((row) => row.service_id === target)) return rows
    const next = rows.filter((row) => row.service_id !== id)
    next.splice(next.findIndex((row) => row.service_id === target) + Number(after), 0, moved)
    return next
}
export function ServerServicePicker({ sid }: { sid: number }) {
    const [activated, setActivated] = useState(false)
    const [ready, setReady] = useState(false)
    const [rows, setRows] = useState<ServerServicePreference[]>([])
    const [saved, setSaved] = useState<ServerServicePreference[]>([])
    const [choices, setChoices] = useState<ServerServiceChoice[]>([])
    const [error, setError] = useState("")
    const [search, setSearch] = useState("")
    const [busy, setBusy] = useState(false)
    const [retry, setRetry] = useState(0)
    const generation = useRef(0)
    useEffect(() => {
        if (!activated) return
        const request = ++generation.current
        setReady(false)
        setBusy(false)
        setError("")
        setRows([])
        setSaved([])
        setChoices([])
        getServerServices(sid)
            .then((data) => {
                if (request !== generation.current) return
                setRows(data.services)
                setSaved(data.services)
                setChoices(data.available)
                setReady(true)
            })
            .catch(() => {
                if (request === generation.current) setError("暂时无法读取服务设置")
            })
        return () => {
            generation.current++
        }
    }, [sid, activated, retry])
    const drag = useServerOrderDrag(
        ready && !busy,
        (id, target, after) =>
            setRows((current) => reorderServerServices(current, id, target, after)),
        "data-sort-service",
    )
    const dirty = JSON.stringify(rows) !== JSON.stringify(saved)
    const invalidColor = rows.some((row) => !!row.color && !/^#[\da-f]{6}$/i.test(row.color))
    const visible = choices.filter((row) =>
        (row.name + " " + row.id).toLowerCase().includes(search.trim().toLowerCase()),
    )
    const choose = (id: number, checked: boolean) => {
        drag.cancel()
        setRows((current) =>
            checked
                ? current.some((row) => row.service_id === id)
                    ? current
                    : [...current, { service_id: id }]
                : current.filter((row) => row.service_id !== id),
        )
    }
    const color = (id: number, value: string) =>
        setRows((current) =>
            current.map((row) =>
                row.service_id === id
                    ? { service_id: id, ...(value ? { color: value } : {}) }
                    : row,
            ),
        )
    const move = (index: number, step: number) =>
        setRows((current) => {
            if (!current[index + step]) return current
            const next = [...current]
            ;[next[index], next[index + step]] = [next[index + step], next[index]]
            return next
        })
    const save = async () => {
        if (busy || !ready || invalidColor) return
        const request = generation.current
        setBusy(true)
        try {
            const data = await setServerServices(sid, rows)
            if (request !== generation.current) return
            setRows(data.services)
            setSaved(data.services)
            setChoices(data.available)
            toast.success("服务设置已保存")
        } catch {
            if (request === generation.current) toast.error("保存失败，请确认服务仍存在并重试")
        } finally {
            if (request === generation.current) setBusy(false)
        }
    }
    return (
        <details
            className="rounded-md border p-3 text-sm"
            onToggle={(event) => {
                if (event.currentTarget.open) setActivated(true)
            }}
        >
            <summary className="cursor-pointer break-words">
                服务选择 ·{" "}
                {ready
                    ? rows.length
                        ? "已选 " + rows.length + " 个"
                        : "默认"
                    : activated
                      ? "读取中"
                      : "默认 / 自定义"}
            </summary>
            <div
                className="mt-3 space-y-3"
                onKeyDown={(event) => {
                    if (event.key === "Enter" && event.target instanceof HTMLInputElement)
                        event.preventDefault()
                }}
            >
                <p className="text-xs text-muted-foreground">
                    不选择则沿用服务覆盖规则。选择后仅监测所选服务；可拖动排序，颜色默认跟随服务设置。
                </p>
                {error ? (
                    <Button type="button" variant="outline" onClick={() => setRetry((n) => n + 1)}>
                        {error}，重试
                    </Button>
                ) : !ready ? (
                    <p role="status">读取中…</p>
                ) : (
                    <>
                        <fieldset disabled={busy} className="min-w-0 space-y-3">
                            <div className="flex flex-wrap gap-2">
                                <Input
                                    type="search"
                                    aria-label="搜索服务名称或 ID"
                                    placeholder="搜索服务名称或 ID"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="min-w-0 flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        drag.cancel()
                                        setRows([])
                                    }}
                                >
                                    恢复默认
                                </Button>
                            </div>
                            <div className="max-h-48 overflow-y-auto overscroll-contain rounded-md border">
                                {visible.map((choice) => (
                                    <label
                                        key={choice.id}
                                        className="flex min-h-11 cursor-pointer items-center gap-2 border-b px-3 py-2 last:border-0"
                                    >
                                        <Checkbox
                                            aria-label={"选择服务 " + choice.name}
                                            checked={rows.some(
                                                (row) => row.service_id === choice.id,
                                            )}
                                            onCheckedChange={(value) =>
                                                choose(choice.id, value === true)
                                            }
                                        />
                                        <span
                                            aria-hidden
                                            className="h-3 w-3 shrink-0 rounded-sm"
                                            style={{ backgroundColor: choice.chart_color }}
                                        />
                                        <span className="min-w-0 flex-1 break-all">
                                            {choice.name}{" "}
                                            <small className="text-muted-foreground">
                                                #{choice.id}
                                            </small>
                                        </span>
                                        {choice.default_included && (
                                            <small className="shrink-0 text-muted-foreground">
                                                默认覆盖
                                            </small>
                                        )}
                                    </label>
                                ))}
                                {!visible.length && (
                                    <p className="p-3 text-muted-foreground">没有匹配的服务</p>
                                )}
                            </div>
                            {rows.length > 0 && (
                                <div
                                    ref={drag.listRef}
                                    aria-label="所选服务排序"
                                    className="max-h-96 space-y-2 overflow-y-auto overscroll-contain p-1"
                                    onPointerMove={drag.onPointerMove}
                                    onPointerUp={drag.onPointerUp}
                                    onPointerCancel={drag.onPointerCancel}
                                    onLostPointerCapture={drag.onLostPointerCapture}
                                    onWheel={drag.onWheel}
                                    onScroll={drag.onScroll}
                                >
                                    {rows.map((row, index) => {
                                        const choice = choices.find(
                                            (item) => item.id === row.service_id,
                                        )
                                        const name = choice?.name || "已删除服务 #" + row.service_id
                                        return (
                                            <div
                                                key={row.service_id}
                                                data-sort-service={row.service_id}
                                                data-dragging={
                                                    drag.preview?.id === row.service_id || undefined
                                                }
                                                onPointerDown={(e) =>
                                                    drag.onPointerDown(e, row.service_id)
                                                }
                                                className="relative min-w-0 rounded-md border bg-background p-2 data-[dragging]:opacity-50"
                                            >
                                                {drag.preview?.target?.id === row.service_id &&
                                                    drag.preview.id !== row.service_id && (
                                                        <span
                                                            className={
                                                                "pointer-events-none absolute left-0 right-0 h-0.5 bg-emerald-500 " +
                                                                (drag.preview.target.after
                                                                    ? "-bottom-1"
                                                                    : "-top-1")
                                                            }
                                                        />
                                                    )}
                                                <div className="flex flex-wrap items-center gap-1">
                                                    <span
                                                        data-sort-handle
                                                        className="touch-none cursor-grab p-2"
                                                        title="拖动排序"
                                                    >
                                                        <GripVertical className="h-4 w-4" />
                                                    </span>
                                                    <span className="min-w-0 flex-1 break-all">
                                                        {index + 1}. {name}
                                                    </span>
                                                    <div className="flex shrink-0 items-center max-[380px]:basis-full max-[380px]:justify-end">
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            aria-label={"上移 " + name}
                                                            disabled={busy || index === 0}
                                                            onClick={() => move(index, -1)}
                                                        >
                                                            <ArrowUp className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            aria-label={"下移 " + name}
                                                            disabled={
                                                                busy || index === rows.length - 1
                                                            }
                                                            onClick={() => move(index, 1)}
                                                        >
                                                            <ArrowDown className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            aria-label={"移除 " + name}
                                                            onClick={() =>
                                                                choose(row.service_id, false)
                                                            }
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div
                                                    className="mt-1 flex flex-wrap items-center gap-2 max-[380px]:grid max-[380px]:grid-cols-[40px_minmax(0,1fr)]"
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                >
                                                    <Input
                                                        type="color"
                                                        aria-label={"单机颜色 " + name}
                                                        className="h-9 w-10 shrink-0 p-1"
                                                        value={
                                                            /^#[\da-f]{6}$/i.test(row.color || "")
                                                                ? row.color
                                                                : choice?.chart_color || "#396b9c"
                                                        }
                                                        onChange={(e) =>
                                                            color(row.service_id, e.target.value)
                                                        }
                                                    />
                                                    <Input
                                                        aria-label={"单机颜色值 " + name}
                                                        className="h-9 min-w-0 flex-1 font-mono"
                                                        placeholder={
                                                            choice?.chart_color || "默认颜色"
                                                        }
                                                        value={row.color || ""}
                                                        onChange={(e) =>
                                                            color(
                                                                row.service_id,
                                                                e.target.value.trim(),
                                                            )
                                                        }
                                                    />
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        className="max-[380px]:col-span-2 max-[380px]:justify-self-end"
                                                        disabled={!row.color || busy}
                                                        onClick={() => color(row.service_id, "")}
                                                    >
                                                        {row.color ? "恢复默认颜色" : "跟随服务"}
                                                    </Button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                            {invalidColor && (
                                <p role="alert" className="text-destructive">
                                    颜色应为 #RRGGBB 格式，留空则跟随服务颜色。
                                </p>
                            )}
                            <Button
                                type="button"
                                disabled={!dirty || busy || invalidColor}
                                onClick={save}
                            >
                                {busy ? "保存中" : "保存服务设置"}
                            </Button>
                        </fieldset>
                    </>
                )}
            </div>
        </details>
    )
}
