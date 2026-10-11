import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { ArrowRight, Download, PinOff, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import "./terminal-confirm.css"

interface TerminalConfirmation {
    title: string
    description: string
    confirmLabel: string
    cancelLabel?: string
    kind: "keep" | "switch" | "install" | "end"
}

export function useTerminalConfirm(scope: string | number) {
    const [options, setOptions] = useState<TerminalConfirmation | null>(null)
    const pending = useRef<((confirmed: boolean) => void) | null>(null)
    const trigger = useRef<HTMLElement | null>(null)
    const settle = useCallback((confirmed: boolean) => {
        const resolve = pending.current
        pending.current = null
        setOptions(null)
        resolve?.(confirmed)
    }, [])
    useEffect(() => {
        setOptions(null)
        return () => {
            // Navigating away must never approve an outstanding operation.
            const resolve = pending.current
            pending.current = null
            resolve?.(false)
        }
    }, [scope])
    const confirm = useCallback((next: TerminalConfirmation): Promise<boolean> => {
        if (pending.current) return Promise.resolve(false)
        trigger.current = document.activeElement as HTMLElement | null
        return new Promise(resolve => {
            pending.current = resolve
            setOptions(next)
        })
    }, [])
    const Icon = options?.kind === "install" ? Download : options?.kind === "switch" ? ArrowRight : options?.kind === "keep" ? PinOff : TriangleAlert
    const dialog = <AlertDialog.Root open={!!options} onOpenChange={open => { if (!open) settle(false) }}>
        <AlertDialog.Portal container={document.fullscreenElement as HTMLElement | undefined}>
            <AlertDialog.Overlay className="terminal-confirm-overlay"/>
            <AlertDialog.Content className="terminal-confirm" data-kind={options?.kind}
                onKeyDown={event => event.stopPropagation()}
                onEscapeKeyDown={event => { event.preventDefault(); settle(false) }}
                onCloseAutoFocus={event => {
                    event.preventDefault()
                    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
                }}>
                <div className="terminal-confirm-heading">
                    <span className="terminal-confirm-icon"><Icon size={21} aria-hidden/></span>
                    <AlertDialog.Title className="terminal-confirm-title">{options?.title}</AlertDialog.Title>
                </div>
                <AlertDialog.Description className="terminal-confirm-description">{options?.description}</AlertDialog.Description>
                <div className="terminal-confirm-actions">
                    <AlertDialog.Cancel className="terminal-confirm-cancel" onClick={() => settle(false)}>{options?.cancelLabel || "取消"}</AlertDialog.Cancel>
                    <AlertDialog.Action className="terminal-confirm-accept" onClick={() => settle(true)}>{options?.confirmLabel}</AlertDialog.Action>
                </div>
            </AlertDialog.Content>
        </AlertDialog.Portal>
    </AlertDialog.Root>
    return { confirm, dialog }
}
