import { createSessionTerminal, InstallState, keepSession, SessionTerminal } from "@/api/terminal-sessions"
import { TerminalSessionsPanel } from "./terminal-sessions"
import { useTerminalConfirm } from "./terminal-confirm"
import { TerminalInstallLog } from "./terminal-install-log"
import { type TerminalKey, controlSequenceForInput, terminalKeySequence } from "@/lib/terminal-keys"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { PanelRight, Layers, Pin, Terminal as TerminalIcon } from "lucide-react"
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
    sessionPanel?: React.ReactNode
    installPanel?: React.ReactNode
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
    ({ wsUrl, setClose, commandsOpen: controlledCommandsOpen, onCommandsOpenChange, sessionPanel, installPanel, className = "", ...props }, ref) => {
        const shellRef = useRef<HTMLDivElement>(null)
        const screenRef = useRef<HTMLDivElement>(null)
        const terminalRef = useRef<Terminal | null>(null)
        const wsRef = useRef<WebSocket | null>(null)
        const installVisibleRef = useRef(!!installPanel)
        installVisibleRef.current = !!installPanel
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
                if (ws.readyState !== WebSocket.OPEN || installVisibleRef.current) return
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
                if (ws.readyState !== WebSocket.OPEN || installVisibleRef.current) return
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
                if (pasteRequestRef.current !== requestID || installVisibleRef.current) return
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
            if (installVisibleRef.current || !ws || ws.readyState !== WebSocket.OPEN || !terminal || terminalCommandError(command)) return false
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
                <div className="terminal-main relative">
                <div ref={screenRef} className="terminal-screen" inert={!!installPanel}/>
                {installPanel}
                <div inert={!!installPanel} className="terminal-keyboard" role="toolbar" aria-label="Terminal controls">
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
                {sessionPanel}
            </div>
        )
    },
)

export const TerminalPage = () => {
    const { id } = useParams<{ id: string }>()
    const serverId = Number(id)
    const [open, setOpen] = useState(false)
    const [commandsOpen, setCommandsOpen] = useState(true)
    const [sessionsOpen, setSessionsOpen] = useState(false)
    const [sessionMode, setSessionMode] = useState<"native" | "tmux">("native")
    const [reconnecting, setReconnecting] = useState(false)
    const [install, setInstall] = useState<InstallState>({ state: "idle", message: "" })
    const [installOpen, setInstallOpen] = useState(false)
    const installStateRef = useRef("idle")
    const updateInstall = useCallback((next: InstallState) => {
        if (next.state === "running" && installStateRef.current !== "running") setInstallOpen(true)
        if (next.state === "idle") setInstallOpen(false)
        installStateRef.current = next.state; setInstall(next)
    }, [])
    const showInstall = useCallback(() => { setInstallOpen(true); if (window.innerWidth < 1024) setSessionsOpen(false) }, [])
    const reconnectingRef = useRef(false)
    const [terminal, setTerminal] = useState<SessionTerminal | null>(null)
    const [error, setError] = useState("")
    const [keeping, setKeeping] = useState(false)
    const [connection, setConnection] = useState(0)
    const terminalIdRef = useRef<HTMLDivElement>(null)
    const { confirm, dialog } = useTerminalConfirm(`${serverId}:${terminal?.session_id || ""}`)
    useEffect(() => {
        if (!Number.isSafeInteger(serverId) || serverId < 1) return
        let cancelled = false
        setTerminal(null); setError("")
        void createSessionTerminal(serverId).then(next => { if (!cancelled) setTerminal(next) })
            .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "终端连接失败") })
        return () => { cancelled = true }
    }, [serverId])
    const select = (next: SessionTerminal) => { setOpen(false); setTerminal(next); setConnection(v => v + 1) }
    const keep = async () => {
        if (!terminal?.session_id || keeping) return
        setKeeping(true)
        try {
            if (terminal.keep && !await confirm({
                kind: "keep", title: "关闭会话保持？",
                description: "当前终端不会立即结束。关闭网页或断开连接后，此终端及其中运行的任务将结束。",
                cancelLabel: "继续保持", confirmLabel: "关闭保持",
            })) return
            const next = await keepSession(terminal.session_id, !terminal.keep)
            setTerminal(next)
            toast.success(next.keep ? "已保持，关闭网页后可从会话列表接回" : "已关闭保持")
        } catch (e) { toast.error(e instanceof Error ? e.message : "设置失败") }
        finally { setKeeping(false) }
    }
    const reconnect = async () => {
        if (reconnectingRef.current) return
        reconnectingRef.current = true; setReconnecting(true); setError("")
        try { select(await createSessionTerminal(serverId)) }
        catch (e) { setError(e instanceof Error ? e.message : "终端连接失败，请重试") }
        finally { reconnectingRef.current = false; setReconnecting(false) }
    }
    const showSessions = (mode: "native" | "tmux") => {
        setSessionsOpen(value => sessionMode === mode ? !value : true)
        setSessionMode(mode); setCommandsOpen(false)
    }
    const setCommands = (value: boolean) => { setCommandsOpen(value); if (value) setSessionsOpen(false) }
    const panel = <TerminalSessionsPanel serverId={serverId} open={sessionsOpen} mode={sessionMode} current={terminal} disconnected={open}
        onClose={() => setSessionsOpen(false)} onSelect={select} onInstall={updateInstall} onShowInstall={showInstall}/>
    return (
        <div className="terminal-page px-3 sm:px-8">
            {dialog}
            <div className="flex flex-wrap mt-3 sm:mt-6 mb-3 sm:mb-4 items-center gap-2">
                <h1 className="min-w-0 basis-full sm:basis-auto flex-1 truncate text-xl sm:text-3xl font-bold tracking-tight" title={terminal?.server_name || `Terminal (${id})`}>{terminal?.server_name || `Terminal (${id})`}</h1>
                <div className="flex flex-wrap justify-end ml-auto gap-1 sm:gap-2 min-w-0">
                    <Button type="button" variant={terminal?.keep ? "default" : "outline"} className="h-10 gap-1.5 px-2 sm:px-3"
                        aria-pressed={!!terminal?.keep} disabled={!terminal?.session_id || terminal.kind === "tmux" || keeping || open}
                        title={terminal?.kind === "tmux" ? "当前为 tmux，会话会自动保留" : "保持当前终端，关闭网页后任务继续运行"}
                        onClick={() => void keep()}>
                        <Pin className="h-4 w-4" aria-hidden/>{terminal?.kind === "tmux" ? "tmux 已连接" : terminal?.keep ? "已保持" : "保持当前"}
                    </Button>
                    <Button type="button" variant="outline" className="h-10 gap-1.5 px-2 sm:px-3" aria-expanded={sessionsOpen && sessionMode === "native"}
                        aria-controls="terminal-session-panel" onClick={() => showSessions("native")}>
                        <Layers className="h-4 w-4" aria-hidden/>面板保持
                    </Button>
                    <Button type="button" variant="outline" className="h-10 gap-1.5 px-2 sm:px-3" aria-expanded={sessionsOpen && sessionMode === "tmux"}
                        aria-controls="terminal-session-panel" onClick={() => showSessions("tmux")}>
                        <TerminalIcon className="h-4 w-4" aria-hidden/>tmux 会话
                    </Button>
                    <Button type="button" variant="outline" className="h-10 gap-1.5 px-2 sm:px-3" aria-label="快捷命令"
                        aria-controls="terminal-command-panel" aria-expanded={commandsOpen} disabled={!terminal?.session_id}
                        onClick={() => setCommands(!commandsOpen)}>
                        <PanelRight className="h-4 w-4" aria-hidden/><span className="hidden sm:inline">快捷命令</span><span className="sm:hidden">命令</span>
                    </Button>
                    {install.state !== "idle" && <Button type="button" variant="outline" className="h-10 px-2 sm:px-3" onClick={showInstall}>安装进度</Button>}
                    <IconButton icon="expand" onClick={async () => { await terminalIdRef.current?.requestFullscreen() }}/>
                    <FMCard id={id}/>
                </div>
            </div>
            {error && <p role="alert" className="text-destructive mb-3">{error}</p>}
            {open && <div role="status" className="mb-3 rounded-lg border p-3 text-sm">连接已断开。可重新连接普通终端，或从对应列表进入已保留的会话。
                <button className="ml-2 underline disabled:opacity-50" disabled={reconnecting} onClick={() => void reconnect()}>{reconnecting ? "正在连接…" : "连接普通终端"}</button>
            </div>}
            {terminal?.session_id ? <XtermComponent ref={terminalIdRef} className="mb-3 sm:mb-5"
                wsUrl={`/api/v1/ws/terminal/${terminal.session_id}?connection=${connection}`} setClose={setOpen} commandsOpen={commandsOpen}
                onCommandsOpenChange={setCommands} sessionPanel={panel}
                installPanel={installOpen && install.state !== "idle" ? <TerminalInstallLog state={install} onClose={() => setInstallOpen(false)}/> : null}/>
                : <div className="terminal-shell relative flex" style={{ minHeight: 320 }}><p className="flex-1 p-4">{error || "正在连接…"}</p>{panel}</div>}
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
