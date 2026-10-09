import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

interface Target {
    id: number
    after: boolean
}
interface Session {
    id: number
    pointerID: number
    startX: number
    startY: number
    x: number
    y: number
    active: boolean
    wheelControlled: boolean
}
export interface ServerOrderDragPreview {
    id: number
    target: Target | null
}

// Pointer capture keeps the row held while the native wheel scrolls the list.
// Unlike HTML drag-and-drop, this does not enter the browser's blocking drag loop.
export function useServerOrderDrag(
    enabled: boolean,
    onDrop: (id: number, target: number, after: boolean) => void,
) {
    const listRef = useRef<HTMLDivElement>(null)
    const session = useRef<Session | null>(null)
    const frame = useRef<number | null>(null)
    const lastFrame = useRef<number | null>(null)
    const drop = useRef(onDrop)
    drop.current = onDrop
    const [preview, setPreview] = useState<ServerOrderDragPreview | null>(null)

    const targetAtPointer = useCallback((): Target | null => {
        const list = listRef.current
        const current = session.current
        if (!list || !current) return null
        const bounds = list.getBoundingClientRect()
        if (
            current.x < bounds.left ||
            current.x > bounds.right ||
            current.y < bounds.top ||
            current.y > bounds.bottom
        )
            return null
        const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-sort-server]"))
        for (const row of rows) {
            const rect = row.getBoundingClientRect()
            if (current.y <= rect.bottom) {
                return {
                    id: Number(row.dataset.sortServer),
                    after: current.y > rect.top + rect.height / 2,
                }
            }
        }
        const last = rows[rows.length - 1]
        return last ? { id: Number(last.dataset.sortServer), after: true } : null
    }, [])

    const updatePreview = useCallback(() => {
        const current = session.current
        if (!current?.active) return
        const target = targetAtPointer()
        setPreview((previous) =>
            previous?.id === current.id &&
            previous.target?.id === target?.id &&
            previous.target?.after === target?.after
                ? previous
                : { id: current.id, target },
        )
    }, [targetAtPointer])

    const cancel = useCallback(() => {
        const current = session.current
        session.current = null
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
        lastFrame.current = null
        setPreview(null)
        const list = listRef.current
        if (current && list?.hasPointerCapture(current.pointerID)) {
            list.releasePointerCapture(current.pointerID)
        }
    }, [])

    const startFrames = useCallback(() => {
        if (frame.current !== null) return
        const tick = (time: number) => {
            const current = session.current
            const list = listRef.current
            if (!current?.active || !list) {
                frame.current = null
                return
            }
            const elapsed = Math.min(32, Math.max(0, time - (lastFrame.current ?? time)))
            lastFrame.current = time
            const rect = list.getBoundingClientRect()
            if (
                !current.wheelControlled &&
                current.x >= rect.left &&
                current.x <= rect.right &&
                current.y >= rect.top &&
                current.y <= rect.bottom
            ) {
                const edge = Math.min(48, rect.height / 4)
                let speed = 0
                if (current.y < rect.top + edge) speed = -720 * (1 - (current.y - rect.top) / edge)
                else if (current.y > rect.bottom - edge)
                    speed = 720 * (1 - (rect.bottom - current.y) / edge)
                list.scrollTop += (speed * elapsed) / 1000
            }
            updatePreview()
            frame.current = requestAnimationFrame(tick)
        }
        frame.current = requestAnimationFrame(tick)
    }, [updatePreview])

    const activate = useCallback(() => {
        const current = session.current
        if (!current) return
        current.active = true
        updatePreview()
        startFrames()
    }, [startFrames, updatePreview])

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: number) => {
        if (!enabled || event.button !== 0 || event.isPrimary === false || session.current) return
        const target = event.target as Element
        if (target.closest("button,a,input,select,textarea,[role=button]")) return
        // On phones, ordinary row swipes still scroll. Only the grip starts a touch drag.
        if (event.pointerType === "touch" && !target.closest("[data-sort-handle]")) return
        const list = listRef.current
        if (!list) return
        event.preventDefault()
        session.current = {
            id,
            pointerID: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            active: false,
            wheelControlled: false,
        }
        list.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = session.current
        if (!current || event.pointerId !== current.pointerID) return
        if (event.clientX !== current.x || event.clientY !== current.y)
            current.wheelControlled = false
        current.x = event.clientX
        current.y = event.clientY
        if (
            !current.active &&
            Math.hypot(current.x - current.startX, current.y - current.startY) >= 5
        )
            activate()
        else updatePreview()
    }
    const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = session.current
        if (!current || event.pointerId !== current.pointerID) return
        current.x = event.clientX
        current.y = event.clientY
        const target = current.active ? targetAtPointer() : null
        cancel()
        if (enabled && target && target.id !== current.id)
            drop.current(current.id, target.id, target.after)
    }
    const onWheel = () => {
        if (!session.current) return
        // Native wheel scrolling remains enabled; it also starts a hold-and-scroll drag.
        session.current.wheelControlled = true
        activate()
    }

    useEffect(() => {
        if (!enabled) cancel()
    }, [enabled, cancel])
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && session.current) {
                event.preventDefault()
                event.stopPropagation()
                cancel()
            }
        }
        window.addEventListener("keydown", onKey, true)
        window.addEventListener("blur", cancel)
        return () => {
            window.removeEventListener("keydown", onKey, true)
            window.removeEventListener("blur", cancel)
            cancel()
        }
    }, [cancel])

    return {
        listRef,
        preview,
        cancel,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: cancel,
        onLostPointerCapture: cancel,
        onWheel,
        onScroll: updatePreview,
    }
}
