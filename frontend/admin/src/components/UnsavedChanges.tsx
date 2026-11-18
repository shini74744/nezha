import { SESSION_EXPIRED_EVENT } from "@/api/session-renewal"
import { type RefObject, useCallback, useContext, useEffect, useRef } from "react"
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "./ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog"

export function DiscardChangesDialog({
    open,
    onKeep,
    onDiscard,
}: {
    open: boolean
    onKeep: () => void
    onDiscard: () => void
}) {
    // Unmount immediately so a closing layer cannot consume the next Escape.
    if (!open) return null
    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!v) onKeep()
            }}
        >
            <DialogContent className="w-[calc(100%_-_2rem)] sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>有未保存的修改</DialogTitle>
                    <DialogDescription>离开后，本次修改不会保留。</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onKeep}>
                        继续编辑
                    </Button>
                    <Button variant="destructive" onClick={onDiscard}>
                        放弃修改并离开
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
function RouteGuard({
    dirty,
    busy,
    expired,
}: {
    dirty: boolean
    busy: boolean
    expired: RefObject<boolean>
}) {
    const blocker = useBlocker(
        useCallback(
            ({ currentLocation, nextLocation }) =>
                !expired.current &&
                !nextLocation.pathname.endsWith("/login") &&
                (dirty || busy) &&
                currentLocation.pathname + currentLocation.search !==
                    nextLocation.pathname + nextLocation.search,
            [dirty, busy, expired],
        ),
    )
    useEffect(() => {
        if (blocker.state === "blocked" && busy) {
            toast.info("正在处理，请完成后再离开")
            blocker.reset()
        }
    }, [blocker, busy])
    return (
        <DiscardChangesDialog
            open={blocker.state === "blocked" && !busy}
            onKeep={() => {
                if (blocker.state === "blocked") blocker.reset()
            }}
            onDiscard={() => {
                if (blocker.state === "blocked") blocker.proceed()
            }}
        />
    )
}
export default function UnsavedChanges({
    dirty,
    busy = false,
}: {
    dirty: boolean
    busy?: boolean
}) {
    const router = useContext(UNSAFE_DataRouterContext),
        expired = useRef(false)
    useEffect(() => {
        const expire = () => {
            expired.current = true
        }
        window.addEventListener(SESSION_EXPIRED_EVENT, expire)
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire)
    }, [])
    useEffect(() => {
        if (!dirty && !busy) return
        const warn = (e: BeforeUnloadEvent) => {
            if (expired.current) return
            e.preventDefault()
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [dirty, busy])
    return router && (dirty || busy) ? (
        <RouteGuard dirty={dirty} busy={busy} expired={expired} />
    ) : null
}
