import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, RefreshCw, X, ArrowRight, Download, Square } from "lucide-react"
import { toast } from "sonner"
import { createSessionTerminal, InstallState, sessionRequest, SessionList, SessionRow, SessionTerminal } from "@/api/terminal-sessions"
import "./terminal-sessions.css"
import { useTerminalConfirm } from "./terminal-confirm"

const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试"
interface Props {
    serverId: number; open: boolean; mode: "native" | "tmux"; current: SessionTerminal | null
    onClose: () => void; onSelect: (terminal: SessionTerminal) => void
    onInstall: (state: InstallState) => void; onShowInstall: () => void
}
export function TerminalSessionsPanel({ serverId, open, mode, current, onClose, onSelect, onInstall, onShowInstall }: Props) {
    const [list, setList] = useState<SessionList | null>(null)
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [creating, setCreating] = useState(false)
    const [name, setName] = useState("")
    const [windowName, setWindowName] = useState("main")
    const [install, setInstall] = useState<InstallState>({ state: "idle", message: "" })
    const panelRef = useRef<HTMLElement>(null)
    const generation = useRef(0)
    const { confirm, dialog } = useTerminalConfirm(`${serverId}:${current?.session_id || ""}:${mode}:${open}`)
    const load = useCallback(async () => {
        const request = ++generation.current
        setLoading(true); setError("")
        try {
            const result = await sessionRequest<SessionList>("list", { server_id: serverId })
            if (generation.current === request) setList(result)
        } catch (e) { if (generation.current === request) setError(message(e)) }
        finally { if (generation.current === request) setLoading(false) }
    }, [serverId])

    useEffect(() => {
        setList(null); setInstall({ state: "idle", message: "" })
        void load()
        void sessionRequest<InstallState>("tmux/install-status", { server_id: serverId }).then(setInstall).catch(() => {})
        return () => { generation.current++ }
    }, [serverId, load])
    useEffect(() => { if (open) void load() }, [open, mode, load])
    useEffect(() => { onInstall(install) }, [install, onInstall])
    useEffect(() => {
        if (install.state !== "running") return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
            try {
                const next = await sessionRequest<InstallState>("tmux/install-status", { server_id: serverId })
                if (cancelled) return
                setInstall(next)
                if (next.state === "done") { void load(); return }
                if (next.state !== "running") return
            } catch { if (cancelled) return }
            timer = setTimeout(poll, 1000)
        }
        timer = setTimeout(poll, 1000)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [install.state, serverId, load])
    useEffect(() => {
        if (!open) return
        const previous = document.activeElement as HTMLElement | null
        panelRef.current?.focus()
        return () => { if (previous?.isConnected) previous.focus() }
    }, [open])

    const switchTo = async (operation: () => Promise<SessionTerminal>) => {
        if (busy) return
        setBusy(true)
        try {
            if (current?.session_id && current.kind !== "tmux" && !current.keep) {
                if (!await confirm({
                    kind: "switch", title: "切换终端？",
                    description: "当前普通终端未开启面板保持，切换后其中的任务将结束。\n如需保留，请取消并先点击“保持当前”。",
                    cancelLabel: "留在当前终端", confirmLabel: "结束旧终端并切换",
                })) return
            }
            const next = await operation()
            onSelect(next)
            void load()
            if (window.innerWidth < 1024) onClose()
        } catch (e) { toast.error(message(e)) }
        finally { setBusy(false) }
    }
    const enter = (row: SessionRow, kind: "native" | "tmux", windowId = "") => {
        if (kind === "native" && row.attached && row.stream_id === current?.session_id) { onClose(); return }
        void switchTo(() => sessionRequest<SessionTerminal>(kind === "native" ? "resume" : "tmux/attach",
            kind === "native" ? { stream_id: row.stream_id } : { server_id: serverId, record_id: row.id, window: windowId }))
    }
    const end = async (row: SessionRow, kind: "native" | "tmux") => {
        if (busy) return
        setBusy(true)
        try {
            if (!await confirm({
                kind: "end", title: "结束这个会话？",
                description: `“${row.name}”中的所有运行任务将立即终止，此操作无法撤销。`,
                cancelLabel: "保留会话", confirmLabel: "结束会话",
            })) return
            const endingCurrent = kind === "native"
                ? current?.kind !== "tmux" && row.stream_id === current?.session_id
                : current?.kind === "tmux" && row.id === current.record_id
            await sessionRequest(kind === "native" ? "stop" : "tmux/end",
                kind === "native" ? { stream_id: row.stream_id, confirm: true } : { server_id: serverId, record_id: row.id, confirm: true })
            if (endingCurrent) {
                try {
                    onSelect(await createSessionTerminal(serverId))
                } catch (e) {
                    toast.error("会话已结束，普通终端连接失败：" + message(e))
                }
            }
            await load()
        } catch (e) { toast.error(message(e)) }
        finally { setBusy(false) }
    }
    const installTmux = async () => {
        if (busy) return
        setBusy(true)
        try {
            if (!await confirm({
                kind: "install", title: "安装 tmux",
                description: "仅在当前节点安装 tmux 和必要依赖，不会升级整机。安装可能需要几分钟。",
                confirmLabel: "安装 tmux",
            })) return
            setInstall({ state: "running", message: "正在启动安装…" }); onShowInstall()
            const next = await sessionRequest<InstallState>("tmux/install", { server_id: serverId, confirm: true })
            setInstall(next)
            if (next.state === "done") void load()
        }
        catch (e) { setInstall({ state: "failed", message: message(e) }); toast.error(message(e)) }
        finally { setBusy(false) }
    }
    const create = () => void switchTo(async () => {
        const next = await sessionRequest<SessionTerminal>("tmux/create", { server_id: serverId, name: name.trim(), window: windowName.trim() })
        setCreating(false); setName(""); return next
    })
    const renderRow = (row: SessionRow, kind: "native" | "tmux") => {
        const active = kind === "native" ? row.stream_id === current?.session_id : current?.kind === "tmux" && row.id === current.record_id
        return <article className={"terminal-session-card" + (active ? " is-current" : "")} key={row.id}>
            <div className="terminal-session-heading">
                <strong title={row.name}>{row.name}</strong>
                <span>{active ? "当前" : kind === "native" ? (row.attached ? "使用中" : "已保持") : row.source === "panel" ? "面板创建" : "已有会话"}</span>
            </div>
            {kind === "tmux" && <div className="terminal-session-windows">
                {row.windows.map(win => <button key={win.id} disabled={busy} onClick={() => enter(row, kind, win.id)} title={win.name}>{win.index} · {win.name}<ArrowRight size={12} /></button>)}
            </div>}
            <div className="terminal-session-actions">
                <button disabled={busy || (kind === "native" && row.attached && !active)} onClick={() => enter(row, kind)}><ArrowRight size={14}/>{active ? "进入" : "连接"}</button>
                <button className="danger" disabled={busy} onClick={() => void end(row, kind)}><Square size={12}/>结束</button>
            </div>
        </article>
    }
    if (!open) return null
    return <>
        {dialog}
        <button className="terminal-session-scrim" aria-label="收起会话" onClick={onClose}/>
        <aside id="terminal-session-panel" className="terminal-sessions" ref={panelRef} tabIndex={-1} aria-label="终端会话"
            onKeyDown={event => {
                if (event.key === "Escape") { event.stopPropagation(); onClose() }
                if (event.key !== "Tab" || window.innerWidth >= 1024) return
                const items = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
                if (!items?.length) return
                const first = items[0], last = items[items.length - 1]
                if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus() }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
            }}>
            <header><div><strong>{mode === "native" ? "面板保持" : "tmux 会话"}</strong><small>{mode === "native" ? "仅管理已保持的普通终端" : "仅管理服务器上的 tmux 会话"}</small></div>
                <button title="刷新会话" aria-label="刷新会话" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} className={loading ? "animate-spin" : ""}/></button>
                <button title="收起会话" aria-label="收起会话" onClick={onClose}><X size={18}/></button>
            </header>
            <div className="terminal-sessions-body">
                {error && <p role="alert" className="terminal-session-error">{error}</p>}
                {mode === "native" && <section><h3>已保持的终端<button disabled={busy} onClick={() => void switchTo(() => createSessionTerminal(serverId))}><Plus size={14}/>新终端</button></h3>
                    <p className="terminal-session-hint">保持当前任务，关闭网页后可重新连接。面板或 Agent 重启后不能恢复。</p>
                    {list?.native.map(row => renderRow(row, "native"))}
                    {list && !list.native.length && <p className="terminal-session-empty">暂无已保持的终端</p>}
                </section>}
                {mode === "tmux" && <section><h3>服务器会话<button disabled={busy || !list?.installed} onClick={() => setCreating(v => !v)}><Plus size={14}/>新建</button></h3>
                    <p className="terminal-session-hint">包含节点当前系统用户的已有会话。新建会话不会接管普通终端里已运行的任务。</p>
                    {list?.tmux_error && <p role="alert" className="terminal-session-error">{list.tmux_error}</p>}
                    {list && !list.installed && !list.tmux_error && <div className="terminal-session-install">
                        <p>此节点尚未安装 tmux</p>
                        <button disabled={busy || install.state === "running"} onClick={() => void installTmux()}><Download size={14}/>{install.state === "running" ? "正在安装…" : "安装 tmux"}</button>
                    </div>}
                    {install.message && <p role="status" className={install.state === "failed" ? "terminal-session-error" : "terminal-session-hint"}>{install.message}</p>}
                    {creating && <form className="terminal-session-create" onSubmit={event => { event.preventDefault(); create() }}>
                        <label>会话名称<input aria-label="会话名称" value={name} onChange={e => setName(e.target.value)} placeholder="例如 网站维护" maxLength={60} aria-describedby="tmux-session-name-help" required/>
                            <small id="tmux-session-name-help" className="text-muted-foreground font-normal">整组终端的名字，用于在列表中识别。</small></label>
                        <label>首个窗口名称<input aria-label="首个窗口名称" value={windowName} onChange={e => setWindowName(e.target.value)} maxLength={60} aria-describedby="tmux-window-name-help" required/>
                            <small id="tmux-window-name-help" className="text-muted-foreground font-normal">会话里的第一个窗口，保留 main 即可。</small></label>
                        <div><button type="button" onClick={() => setCreating(false)}>取消</button><button type="submit" disabled={busy || !name.trim() || !windowName.trim()}>创建并进入</button></div>
                    </form>}
                    {list?.tmux.map(row => renderRow(row, "tmux"))}
                    {list?.installed && !list.tmux.length && <p className="terminal-session-empty">暂无 tmux 会话</p>}
                </section>}
            </div>
        </aside>
    </>
}
