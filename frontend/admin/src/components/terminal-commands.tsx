import { FetcherMethod, fetcher } from "@/api/api"
import { useAuth } from "@/hooks/useAuth"
import { terminalCommandError, terminalCommandsURL, type SavedTerminalCommand } from "@/lib/terminal-commands"
import { Cloud, LockKeyhole, Pencil, Play, Plus, RefreshCw, TerminalSquare, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import useSWR from "swr"
import "./terminal-commands.css"

interface Props {
    open: boolean
    connected: boolean
    onClose: () => void
    onExecute: (command: string) => boolean
}

export function TerminalCommandsPanel(props: Props) {
    const { profile } = useAuth()
    return <CommandLibrary key={profile?.id ?? "guest"} {...props} ownerId={profile?.id} />
}

function CommandLibrary({ open, connected, onClose, onExecute, ownerId }: Props & { ownerId?: number }) {
    const { data, error, isLoading, mutate } = useSWR<SavedTerminalCommand[]>(
        ownerId ? [terminalCommandsURL, ownerId] : null,
        () => fetcher<SavedTerminalCommand[]>(FetcherMethod.GET, terminalCommandsURL),
    )
    const [editing, setEditing] = useState<SavedTerminalCommand | "new" | null>(null)
    const [name, setName] = useState("")
    const [command, setCommand] = useState("")
    const [busy, setBusy] = useState(false)
    const pending = useRef(false)
    const lastExecution = useRef(0)
    const panel = useRef<HTMLElement>(null)
    const [message, setMessage] = useState("")
    const [notice, setNotice] = useState("")
    const [selected, setSelected] = useState<number | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [mobile, setMobile] = useState(() => window.innerWidth < 1024)
    const [shortViewport, setShortViewport] = useState(() => (window.visualViewport?.height ?? window.innerHeight) < 460)
    const rows = data ?? []
    const active = rows.find(row => row.id === selected)

    useEffect(() => {
        const update = () => {
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight
            const viewportTop = window.visualViewport?.offsetTop ?? 0
            setMobile(window.innerWidth < 1024)
            setShortViewport(viewportHeight < 460)
            panel.current?.style.setProperty("--tc-vh", viewportHeight + "px")
            // Anchor the sheet above the keyboard, including visual-viewport panning.
            panel.current?.style.setProperty("--tc-bottom", Math.max(0, window.innerHeight - viewportHeight - viewportTop) + "px")
        }
        update()
        window.addEventListener("resize", update)
        window.visualViewport?.addEventListener("resize", update)
        window.visualViewport?.addEventListener("scroll", update)
        return () => {
            window.removeEventListener("resize", update)
            window.visualViewport?.removeEventListener("resize", update)
            window.visualViewport?.removeEventListener("scroll", update)
        }
    }, [open])

    useEffect(() => {
        if (!open || !mobile) return
        const previous = document.activeElement as HTMLElement | null
        panel.current?.querySelector<HTMLButtonElement>('[aria-label="收起快捷命令栏"]')?.focus({ preventScroll: true })
        return () => previous?.focus({ preventScroll: true })
    }, [open, mobile])

    function edit(row: SavedTerminalCommand | "new") {
        setEditing(row)
        setName(row === "new" ? "" : row.name)
        setCommand(row === "new" ? "" : row.command)
        setMessage("")
        setNotice("")
        setConfirmDelete(false)
    }

    async function save(event: FormEvent) {
        event.preventDefault()
        if (!editing || pending.current) return
        const cleanName = name.trim()
        // eslint-disable-next-line no-control-regex -- Names must not contain terminal control characters.
        const validation = !cleanName || [...cleanName].length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(cleanName)
            ? "名称需为 1–80 个字符" : terminalCommandError(command)
        if (validation) { setMessage(validation); return }
        pending.current = true
        setBusy(true)
        setMessage("")
        try {
            const saved = await fetcher<SavedTerminalCommand>(
                editing === "new" ? FetcherMethod.POST : FetcherMethod.PUT,
                editing === "new" ? terminalCommandsURL : terminalCommandsURL + "/" + editing.id,
                { name: cleanName, command: command.trim(), version: editing === "new" ? 0 : editing.version },
            )
            // The server has committed; cache revalidation must not block the editor.
            void mutate(current => editing === "new"
                ? [...(current ?? []), saved]
                : (current ?? []).map(row => row.id === saved.id ? saved : row), { revalidate: false }).catch(() => undefined)
            setEditing(null)
            setSelected(saved.id)
            setNotice("已保存到当前账号")
            void mutate().catch(() => undefined)
        } catch (failure) {
            setMessage(failure instanceof Error ? failure.message : "保存失败，请重试")
        } finally {
            pending.current = false
            setBusy(false)
        }
    }

    async function remove() {
        if (!active || !confirmDelete || pending.current) return
        pending.current = true
        setBusy(true)
        setMessage("")
        try {
            await fetcher(FetcherMethod.DELETE, terminalCommandsURL + "/" + active.id, { version: active.version })
            void mutate(current => (current ?? []).filter(row => row.id !== active.id), { revalidate: false }).catch(() => undefined)
            setSelected(null)
            setConfirmDelete(false)
            setNotice("快捷命令已删除")
            void mutate().catch(() => undefined)
        } catch (failure) {
            setMessage(failure instanceof Error ? failure.message : "删除失败，请重试")
        } finally {
            pending.current = false
            setBusy(false)
        }
    }

    function execute() {
        if (!active || !connected || busy || error || Date.now() - lastExecution.current < 700) return
        const validation = terminalCommandError(active.command)
        if (validation) { setMessage(validation); return }
        if (onExecute(active.command)) {
            lastExecution.current = Date.now()
            setNotice("已发送到当前终端并回车")
            setMessage("")
            if (mobile) onClose()
        } else setMessage("终端已断开，请重新连接后再执行")
    }

    if (!open) return null
    return <>
        <button className="terminal-command-scrim" aria-label="收起快捷命令" tabIndex={-1} onClick={onClose} />
        <aside ref={panel} className="terminal-commands" aria-label="快捷命令" id="terminal-command-panel"
            role={mobile ? "dialog" : "complementary"} aria-modal={mobile ? true : undefined}
            data-mode={editing ? "editor" : "library"} data-short-viewport={shortViewport || undefined}
            onKeyDown={event => {
                if (event.key === "Escape") { event.stopPropagation(); onClose() }
                if (mobile && event.key === "Tab") {
                    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? [])
                    const first = items[0], last = items[items.length - 1]
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
                }
            }}>
            <div className="tc-heading">
                <div><span className="tc-eyebrow">云端同步</span><h2>快捷命令</h2></div>
                <button className="tc-new" onClick={() => edit("new")} disabled={!ownerId || isLoading || !!error || rows.length >= 100 || busy || editing !== null}>
                    <Plus size={14} aria-hidden />新建
                </button>
                <button className="tc-icon" aria-label="收起快捷命令栏" title="收起" onClick={onClose}><X size={16} aria-hidden /></button>
            </div>
            <p className="tc-description">保存常用命令，随时发送到当前终端</p>
            <div className="tc-meta"><span><Cloud size={12} aria-hidden />云端保存</span><span title="命令内容在服务端加密存储，仅当前账号可读取"><LockKeyhole size={12} aria-hidden />加密存储</span><small>共 {rows.length} 条</small></div>
            {editing ? <form className="tc-editor" onSubmit={save} aria-label={editing === "new" ? "新建快捷命令" : "编辑快捷命令"}>
                <h3>{editing === "new" ? "新建快捷命令" : "编辑快捷命令"}</h3>
                <label htmlFor="tc-name">名称</label>
                <input id="tc-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} autoFocus disabled={busy} placeholder="例如：查看磁盘" autoComplete="off" />
                <label htmlFor="tc-command">命令内容</label>
                <textarea id="tc-command" value={command} onChange={event => setCommand(event.target.value)} rows={mobile ? 3 : 5} maxLength={8192} disabled={busy} placeholder="df -h" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
                <p className="tc-help">仅支持单行命令，长内容自动折行展示。请勿保存密码、密钥等敏感信息。</p>
                {message && <p role="alert" className="tc-error">{message}</p>}
                <div className="tc-actions">
                    <button type="button" onClick={() => { setEditing(null); setMessage(""); void mutate().catch(() => undefined) }} disabled={busy}>取消</button>
                    <button className="tc-primary" type="submit" disabled={busy}>{busy ? "处理中…" : "保存命令"}</button>
                </div>
            </form> : <div className="tc-list">
                {!ownerId ? <p className="tc-empty">登录后可使用账号快捷命令</p>
                : isLoading ? <p className="tc-empty" role="status">正在加载快捷命令…</p>
                : error ? <div className="tc-empty"><p role="alert">加载失败，请重试</p><button className="tc-new" onClick={() => void mutate().catch(() => undefined)}><RefreshCw size={14} aria-hidden />重新加载</button></div>
                : rows.length === 0 ? <div className="tc-empty"><TerminalSquare size={28} aria-hidden /><h3>还没有快捷命令</h3><p>点击上方“新建”，保存第一条常用命令。</p></div>
                : rows.map(row => <article key={row.id} className={"tc-card" + (selected === row.id ? " is-selected" : "")}>
                    <button type="button" className="tc-insert" aria-label={"选择命令：" + row.name} aria-pressed={selected === row.id} disabled={busy}
                        onClick={() => { setSelected(row.id); setConfirmDelete(false); setMessage(""); setNotice("") }}>
                        <h3><span className="tc-dot" aria-hidden />{row.name}</h3><code>{row.command}</code>
                    </button>
                    <button type="button" className="tc-icon tc-edit" aria-label={"编辑命令：" + row.name} title="编辑命令" disabled={busy} onClick={() => edit(row)}><Pencil size={14} aria-hidden /></button>
                </article>)}
            </div>}
            <div className="tc-footer" hidden={mobile && !!editing && connected && !notice}>
                {!editing && <>
                    <p className="tc-selection" title={active?.name}>已选中：{active?.name ?? "未选择命令"}</p>
                    {confirmDelete && active ? <div className="tc-confirm">
                        <p>确定删除“{active.name}”？删除后无法恢复。</p>
                        <div className="tc-actions"><button disabled={busy} onClick={() => setConfirmDelete(false)}>取消删除</button><button className="tc-danger" disabled={busy} onClick={() => void remove()}>确认删除</button></div>
                    </div> : <div className="tc-actions tc-bottom-actions">
                        <button className="tc-execute" aria-describedby="tc-execution-warning" disabled={!active || !connected || busy || !!error} onClick={execute}><Play size={13} aria-hidden />执行</button>
                        <button className="tc-delete-button" disabled={!active || busy || !!error} onClick={() => { setConfirmDelete(true); setMessage("") }}><Trash2 size={13} aria-hidden />删除</button>
                    </div>}
                    {message && <p role="alert" className="tc-error">{message}</p>}
                    <p className="tc-warning" id="tc-execution-warning">{mobile ? "执行会发送命令并回车。" : "会直接发送到当前终端并立即回车执行。"}</p>
                </>}
                <p role="status">{notice || (!connected ? "终端未连接，仍可管理命令" : "")}</p>
            </div>
        </aside>
    </>
}
