import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import useTerminal from "@/hooks/useTerminal"
import { type TerminalKey, controlSequenceForInput, terminalKeySequence } from "@/lib/terminal-keys"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { PanelRight, Terminal as TerminalIcon } from "lucide-react"
import { TerminalCommandsPanel } from "./terminal-commands"
import { terminalCommandError } from "@/lib/terminal-commands"
import {
    JSX,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { toast } from "sonner"

import { FMCard } from "./fm"
import { Button } from "./ui/button"
import { IconButton } from "./xui/icon-button"

interface XtermProps {
    wsUrl: string
    setClose: React.Dispatch<React.SetStateAction<boolean>>
    commandsOpen?: boolean
    onCommandsOpenChange?: (open: boolean) => void
}

type ConnectionState = "connecting" | "connected" | "disconnected"

const terminalKeys: Array<{ key: TerminalKey; label: string; ariaLabel: string }> = [
    { key: "escape", label: "Esc", ariaLabel: "Escape" },
    { key: "tab", label: "Tab", ariaLabel: "Tab" },
    { key: "arrowLeft", label: "←", ariaLabel: "Left arrow" },
    { key: "arrowUp", label: "↑", ariaLabel: "Up arrow" },
    { key: "arrowDown", label: "↓", ariaLabel: "Down arrow" },
    { key: "arrowRight", label: "→", ariaLabel: "Right arrow" },
    { key: "home", label: "Home", ariaLabel: "Home" },
    { key: "end", label: "End", ariaLabel: "End" },
    { key: "pageUp", label: "PgUp", ariaLabel: "Page up" },
    { key: "pageDown", label: "PgDn", ariaLabel: "Page down" },
]

const maxClipboardBytes = 512 * 1024

export const XtermComponent = forwardRef<HTMLDivElement, XtermProps & JSX.IntrinsicElements["div"]>(
    ({ wsUrl, setClose, commandsOpen: controlledCommandsOpen, onCommandsOpenChange, className = "", ...props }, ref) => {
        const shellRef = useRef<HTMLDivElement>(null)
        const screenRef = useRef<HTMLDivElement>(null)
        const terminalRef = useRef<Terminal | null>(null)
        const wsRef = useRef<WebSocket | null>(null)
        const fitAddonRef = useRef<FitAddon | null>(null)
        const fitFrameRef = useRef(0)
        const lastSizeRef = useRef("")
        const controlActiveRef = useRef(false)
        const pasteInProgressRef = useRef(false)
        const pasteRequestRef = useRef(0)
        const [localCommandsOpen, setLocalCommandsOpen] = useState(() => window.innerWidth >= 1024)
        const commandsOpen = controlledCommandsOpen ?? localCommandsOpen
        const setCommandsOpen = (next: boolean) => {
            if (controlledCommandsOpen === undefined) setLocalCommandsOpen(next)
            onCommandsOpenChange?.(next)
        }
        const [controlActive, setControlActive] = useState(false)
        const [pasteBusy, setPasteBusy] = useState(false)
        const [connectionState, setConnectionState] = useState<ConnectionState>("connecting")

        useImperativeHandle(ref, () => shellRef.current!, [])

        const updateControl = useCallback((active: boolean) => {
            controlActiveRef.current = active
            setControlActive(active)
        }, [])

        const sendResize = useCallback(() => {
            const terminal = terminalRef.current
            const ws = wsRef.current
            if (!terminal || !ws || ws.readyState !== WebSocket.OPEN) return
            if (terminal.cols < 2 || terminal.rows < 2) return

            const sizeKey = `${terminal.cols}x${terminal.rows}`
            if (lastSizeRef.current === sizeKey) return
            lastSizeRef.current = sizeKey
            const resizeMessage = new TextEncoder().encode(
                JSON.stringify({ Rows: terminal.rows, Cols: terminal.cols }),
            )
            const message = new Uint8Array(resizeMessage.length + 1)
            message[0] = 1
            message.set(resizeMessage, 1)
            ws.send(message)
        }, [])

        const fit = useCallback(() => {
            window.cancelAnimationFrame(fitFrameRef.current)
            fitFrameRef.current = window.requestAnimationFrame(() => {
                const screen = screenRef.current
                if (!screen || screen.clientWidth === 0 || screen.clientHeight === 0) return
                try {
                    fitAddonRef.current?.fit()
                    sendResize()
                } catch (error) {
                    console.error("resize error", error)
                }
            })
        }, [sendResize])

        useEffect(() => {
            const shell = shellRef.current
            const screen = screenRef.current
            if (!shell || !screen) return

            let active = true
            const terminal = new Terminal({
                cursorBlink: true,
                // Keep xterm measurement and rendering independent of dashboard fonts.
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: window.innerWidth <= 640 ? 13 : 16,
                scrollback: 10000,
                scrollOnUserInput: true,
            })
            const fitAddon = new FitAddon()
            fitAddonRef.current = fitAddon
            terminal.loadAddon(fitAddon)
            terminal.open(screen)
            terminal.element?.setAttribute("aria-label", "Interactive terminal")
            terminalRef.current = terminal

            const url = new URL(wsUrl, window.location.origin)
            url.protocol = url.protocol.replace("http", "ws")
            const ws = new WebSocket(url)
            ws.binaryType = "arraybuffer"
            wsRef.current = ws
            pasteInProgressRef.current = false
            setPasteBusy(false)
            updateControl(false)
            setConnectionState("connecting")

            const sendText = (data: string, applyControl: boolean) => {
                if (ws.readyState !== WebSocket.OPEN) return
                let outgoing = data
                if (applyControl && controlActiveRef.current) {
                    outgoing = controlSequenceForInput(data) ?? data
                    updateControl(false)
                }
                ws.send(outgoing)
                terminal.focus()
            }

            const dataSubscription = terminal.onData((data) => {
                sendText(data, !pasteInProgressRef.current)
            })
            const binarySubscription = terminal.onBinary((data) => {
                if (ws.readyState !== WebSocket.OPEN) return
                const message = new Uint8Array(data.length + 1)
                for (let index = 0; index < data.length; index += 1) {
                    message[index + 1] = data.charCodeAt(index) & 0xff
                }
                ws.send(message)
            })

            ws.onopen = () => {
                if (!active) return
                lastSizeRef.current = ""
                setConnectionState("connected")
                fit()
                terminal.focus()
            }
            ws.onmessage = (event) => {
                if (!active) return
                if (event.data instanceof ArrayBuffer) {
                    terminal.write(new Uint8Array(event.data))
                } else if (typeof event.data === "string") {
                    terminal.write(event.data)
                }
            }
            ws.onclose = () => {
                if (!active) return
                pasteRequestRef.current += 1
                setPasteBusy(false)
                setConnectionState("disconnected")
                setClose(true)
            }
            ws.onerror = (event) => {
                console.error(event)
                toast("终端连接失败", { description: "请检查服务器连接后重试。" })
            }

            const updateViewport = () => {
                const viewport = window.visualViewport
                const viewportTop = viewport?.offsetTop ?? 0
                const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
                const shellTop = Math.max(shell.getBoundingClientRect().top, viewportTop)
                const bottomGap = document.fullscreenElement === shell ? 0 : 8
                shell.style.setProperty(
                    "--terminal-available-height",
                    `${Math.max(0, Math.floor(viewportBottom - shellTop - bottomGap))}px`,
                )
                fit()
            }
            const observer = new ResizeObserver(fit)
            observer.observe(screen)
            window.addEventListener("resize", updateViewport)
            window.addEventListener("orientationchange", updateViewport)
            document.addEventListener("fullscreenchange", updateViewport)
            window.visualViewport?.addEventListener("resize", updateViewport)
            window.visualViewport?.addEventListener("scroll", updateViewport)
            updateViewport()
            // A late-loading dashboard font can move the heading without a window resize.
            document.fonts?.ready.then(() => { if (active) updateViewport() })

            return () => {
                active = false
                pasteRequestRef.current += 1
                window.cancelAnimationFrame(fitFrameRef.current)
                observer.disconnect()
                window.removeEventListener("resize", updateViewport)
                window.removeEventListener("orientationchange", updateViewport)
                document.removeEventListener("fullscreenchange", updateViewport)
                window.visualViewport?.removeEventListener("resize", updateViewport)
                window.visualViewport?.removeEventListener("scroll", updateViewport)
                dataSubscription.dispose()
                binarySubscription.dispose()
                ws.onopen = null
                ws.onmessage = null
                ws.onclose = null
                ws.onerror = null
                ws.close()
                terminal.dispose()
                if (wsRef.current === ws) wsRef.current = null
                if (terminalRef.current === terminal) terminalRef.current = null
                if (fitAddonRef.current === fitAddon) fitAddonRef.current = null
            }
        }, [fit, setClose, updateControl, wsUrl])

        const pasteClipboard = async () => {
            if (pasteBusy || connectionState !== "connected") return
            if (!navigator.clipboard?.readText) {
                toast("Clipboard unavailable", {
                    description: "Use HTTPS and allow clipboard permission in your browser.",
                })
                terminalRef.current?.focus()
                return
            }

            setPasteBusy(true)
            const requestID = ++pasteRequestRef.current
            try {
                const text = await navigator.clipboard.readText()
                if (pasteRequestRef.current !== requestID) return
                if (!text) {
                    toast("Clipboard is empty")
                    return
                }
                if (new TextEncoder().encode(text).length > maxClipboardBytes) {
                    toast("Clipboard is too large", {
                        description: "Terminal paste is limited to 512 KiB per action.",
                    })
                    return
                }
                const terminal = terminalRef.current
                if (!terminal) return
                pasteInProgressRef.current = true
                try {
                    terminal.paste(text)
                } finally {
                    pasteInProgressRef.current = false
                }
                terminal.focus()
            } catch {
                if (pasteRequestRef.current === requestID) {
                    toast("Could not read clipboard", {
                        description: "Allow clipboard access in your browser and try again.",
                    })
                }
            } finally {
                if (pasteRequestRef.current === requestID) setPasteBusy(false)
            }
        }

        const executeCommand = (command: string) => {
            const ws = wsRef.current
            const terminal = terminalRef.current
            if (!ws || ws.readyState !== WebSocket.OPEN || !terminal || terminalCommandError(command)) return false
            updateControl(false)
            pasteInProgressRef.current = true
            try {
                terminal.paste(command.trim())
                ws.send("\r")
            } finally {
                pasteInProgressRef.current = false
            }
            terminal.focus()
            return true
        }

        const sendKey = (key: TerminalKey) => {
            const ws = wsRef.current
            if (!ws || ws.readyState !== WebSocket.OPEN) return
            const withControl = controlActiveRef.current
            updateControl(false)
            ws.send(terminalKeySequence(key, withControl))
            terminalRef.current?.focus()
        }

        return (
            <div
                ref={shellRef}
                className={`terminal-shell ${className}`}
                data-connection-state={connectionState}
                {...props}
            >
                <div className="terminal-main">
                <div ref={screenRef} className="terminal-screen" />
                <div className="terminal-keyboard" role="toolbar" aria-label="Terminal controls">
                    <button type="button" className="terminal-key terminal-key-commands"
                        aria-label="快捷命令" aria-expanded={commandsOpen} aria-controls="terminal-command-panel"
                        onClick={() => setCommandsOpen(!commandsOpen)}>
                        <PanelRight size={16} aria-hidden />快捷命令
                    </button>
                    <button
                        type="button"
                        className="terminal-key terminal-key-paste"
                        disabled={connectionState !== "connected" || pasteBusy}
                        aria-label="Paste clipboard"
                        onClick={() => void pasteClipboard()}
                    >
                        {pasteBusy ? "Pasting…" : "Paste"}
                    </button>
                    <button
                        type="button"
                        className={`terminal-key ${controlActive ? "is-active" : ""}`}
                        aria-label="Control modifier for next key"
                        aria-pressed={controlActive}
                        disabled={connectionState !== "connected"}
                        onClick={() => {
                            updateControl(!controlActiveRef.current)
                            terminalRef.current?.focus()
                        }}
                    >
                        Ctrl
                    </button>
                    {terminalKeys.map(({ key, label, ariaLabel }) => (
                        <button
                            key={key}
                            type="button"
                            className={`terminal-key ${key.startsWith("arrow") ? "terminal-key-arrow" : ""}`}
                            aria-label={ariaLabel}
                            disabled={connectionState !== "connected"}
                            onClick={() => sendKey(key)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                </div>
                <TerminalCommandsPanel open={commandsOpen} connected={connectionState === "connected"} onClose={() => setCommandsOpen(false)} onExecute={executeCommand} />
            </div>
        )
    },
)

export const TerminalPage = () => {
    const { id } = useParams<{ id: string }>()
    const [open, setOpen] = useState(false)
    const [commandsOpen, setCommandsOpen] = useState(() => window.innerWidth >= 1024)
    const terminal = useTerminal(id ? parseInt(id) : undefined)
    const terminalIdRef = useRef<HTMLDivElement>(null)
    return (
        <div className="terminal-page px-3 sm:px-8">
            <div className="flex mt-3 sm:mt-6 mb-3 sm:mb-4 items-center gap-2">
                <h1 className="min-w-0 flex-1 truncate text-xl sm:text-3xl font-bold tracking-tight" title={`Terminal (${id})`}>{`Terminal (${id})`}</h1>
                <div className="flex ml-auto gap-2 shrink-0">
                    <Button
                        type="button"
                        variant="outline"
                        className="h-10 gap-1.5 px-2 sm:px-3"
                        aria-label="快捷命令"
                        aria-controls="terminal-command-panel"
                        aria-expanded={commandsOpen}
                        title={commandsOpen ? "收起快捷命令" : "打开快捷命令"}
                        disabled={!terminal?.session_id}
                        onClick={() => setCommandsOpen(value => !value)}
                    >
                        <PanelRight className="h-4 w-4" aria-hidden />
                        <span className="hidden sm:inline">快捷命令</span>
                        <span className="sm:hidden">命令</span>
                    </Button>
                    <IconButton
                        icon="expand"
                        onClick={async () => {
                            await terminalIdRef.current?.requestFullscreen()
                        }}
                    />
                    <FMCard id={id} />
                </div>
            </div>
            {terminal?.session_id ? (
                <XtermComponent
                    ref={terminalIdRef}
                    className="mb-3 sm:mb-5"
                    wsUrl={`/api/v1/ws/terminal/${terminal.session_id}`}
                    setClose={setOpen}
                    commandsOpen={commandsOpen}
                    onCommandsOpenChange={setCommandsOpen}
                />
            ) : (
                <p>The server does not exist, or have not been connected yet.</p>
            )}
            <AlertDialog open={open} onOpenChange={setOpen}>
                <AlertDialogContent className="sm:max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Session completed</AlertDialogTitle>
                        <AlertDialogDescription>
                            You may close this window now.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction asChild>
                            <Button onClick={window.close}>Close</Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export const TerminalButton = ({ id, menuItem = false }: { id: number; menuItem?: boolean }) => {
    const { t } = useTranslation()
    const handleOpenNewTab = () => {
        window.open(`/dashboard/terminal/${id}`, "_blank")
    }

    if (menuItem) {
        return (
            <button
                type="button"
                onClick={handleOpenNewTab}
                className="flex w-full items-center text-sm px-2 py-2 hover:bg-accent hover:text-accent-foreground"
            >
                <TerminalIcon className="h-4 w-4 mr-2" />
                <span>{t("Terminal")}</span>
            </button>
        )
    }

    return <IconButton variant="outline" icon="terminal" onClick={handleOpenNewTab} />
}
