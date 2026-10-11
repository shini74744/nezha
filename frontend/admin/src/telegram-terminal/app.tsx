import { createRoot } from "react-dom/client"
import { useEffect, useState } from "react"
import { MemoryRouter } from "react-router-dom"
import { SWRConfig } from "swr"
import { Toaster } from "sonner"
import { RefreshCw, Search, ArrowLeft, ShieldCheck } from "lucide-react"
import { TerminalPage } from "@/components/terminal"
import { Button } from "@/components/ui/button"
import { useTerminalConfirm } from "@/components/terminal-confirm"
import { setTelegramTerminalAccess, telegramRequest } from "@/lib/terminal-transport"
import { searchTerminalServers, type TerminalServer } from "./search"
import "../index.css"
import "../lib/i18n"
import "./style.css"

type WebApp = {
    initData: string; colorScheme?: string; ready(): void; expand(): void
    enableClosingConfirmation?(): void; disableClosingConfirmation?(): void
    onEvent?(event: string, listener: () => void): void
}
const tg = (window as Window & { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp
const launch = new URLSearchParams(location.hash.slice(1)).get("launch") || ""
history.replaceState(null, "", location.pathname)
let expire: () => void = () => {}
setTelegramTerminalAccess({ token: "", onExpired: () => expire() })
const cache = new Map()
function App() {
    const [status, setStatus] = useState("正在验证 TG 身份…")
    const [authorized, setAuthorized] = useState(false)
    const [expired, setExpired] = useState(false)
    const [rows, setRows] = useState<TerminalServer[]>([])
    const [selected, setSelected] = useState<TerminalServer | null>(null)
    const [query, setQuery] = useState("")
    const [online, setOnline] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [theme, setTheme] = useState<"light" | "dark">("light")
    const { confirm, dialog } = useTerminalConfirm(String(selected?.id ?? "picker"))
    useEffect(() => {
        let active = true
        let timer: ReturnType<typeof setTimeout>
        const revoke = () => {
            setTelegramTerminalAccess({ token: "", onExpired: () => {} })
            cache.clear()
            if (active) { setExpired(true); setAuthorized(false); setSelected(null); setStatus("授权已过期，请从 TG 网页终端菜单重新打开。") }
        }
        expire = revoke
        const applyTheme = () => {
            const dark = tg?.colorScheme === "dark" || (!tg?.colorScheme && matchMedia("(prefers-color-scheme: dark)").matches)
            document.documentElement.classList.toggle("dark", dark)
            setTheme(dark ? "dark" : "light")
        }
        applyTheme(); tg?.onEvent?.("themeChanged", applyTheme)
        tg?.ready(); tg?.expand()
        void (async () => {
            if (!tg?.initData || !launch) { setStatus("请从 TG 机器人里的「网页终端」菜单打开。"); return }
            try {
                const response = await fetch("/api/v1/telegram-terminal/bootstrap", {
                    method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ launch, init_data: tg.initData }), signal: AbortSignal.timeout(15000),
                })
                const data = await response.json()
                if (!response.ok || !data.token || !Number.isSafeInteger(data.user_id)) throw new Error(data.error || "身份验证失败，请从 TG 菜单重新打开。")
                if (!active) return
                setTelegramTerminalAccess({ token: data.token, ownerId: data.user_id, onExpired: revoke })
                timer = setTimeout(revoke, Math.min(900, Math.max(1, data.expires_in || 900)) * 1000)
                const result = await telegramRequest<{ servers: TerminalServer[] }>("servers", {})
                if (active) { setRows(result.servers); setAuthorized(true); setStatus("请选择要连接的服务器") }
            } catch (e) { if (active) setStatus(e instanceof Error ? e.message : "授权失败") }
        })()
        window.addEventListener("pagehide", revoke)
        return () => { active = false; clearTimeout(timer); window.removeEventListener("pagehide", revoke) }
    }, [])
    useEffect(() => {
        if (selected) tg?.enableClosingConfirmation?.()
        else tg?.disableClosingConfirmation?.()
    }, [selected])
    const refresh = async () => {
        setRefreshing(true)
        try { setRows((await telegramRequest<{ servers: TerminalServer[] }>("servers", {})).servers); setStatus("请选择要连接的服务器") }
        catch (e) { setStatus(e instanceof Error ? e.message : "刷新失败") }
        finally { setRefreshing(false) }
    }
    const back = async () => {
        if (await confirm({ kind: "keep", title: "断开并选择其他服务器？", description: "普通终端内的任务将结束；tmux 会话只会断开，任务继续运行。", cancelLabel: "继续操作", confirmLabel: "断开 / 换服务器" })) setSelected(null)
    }
    const visible = searchTerminalServers(rows, query, online)
    return <SWRConfig value={{ provider: () => cache, revalidateOnFocus: false, shouldRetryOnError: false }}>
        <MemoryRouter>
            <main className="tg-terminal">
                {dialog}
                <header className="tg-header">
                    <div className="flex items-center gap-2 min-w-0"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden/><strong>TG 网页终端</strong></div>
                    {selected && <Button variant="outline" onClick={() => void back()}><ArrowLeft className="h-4 w-4 mr-1" aria-hidden/>换服务器</Button>}
                </header>
                {!selected && <section className="tg-picker">
                    <h1 className="text-xl font-bold mb-2">选择服务器</h1>
                    <p role={expired ? "alert" : "status"} className="text-sm text-muted-foreground mb-4">{status}</p>
                    {authorized && <>
                        <label className="tg-search"><Search className="h-4 w-4 shrink-0" aria-hidden/><input aria-label="搜索服务器" placeholder="输入名称关键词或服务器 ID" value={query} onChange={e => setQuery(e.target.value)}/></label>
                        <div className="flex items-center justify-between gap-2 my-3">
                            <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)}/>仅显示在线</label>
                            <Button variant="outline" disabled={refreshing} onClick={() => void refresh()} aria-label="刷新服务器"><RefreshCw className="h-4 w-4 mr-1" aria-hidden/>刷新</Button>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{visible.length} / {rows.length} 台</p>
                        <div className="tg-servers">{visible.map(row => <button className="tg-server" key={row.id} disabled={!row.online} onClick={() => setSelected(row)}>
                            <span className={"tg-dot " + (row.online ? "online" : "")}/><span className="min-w-0 flex-1 text-left"><strong className="block break-words">{row.name}</strong><small>#{row.id} · {row.online ? "在线" : "离线"}</small></span><span className="shrink-0">{row.online ? "连接 →" : "暂不可用"}</span>
                        </button>)}</div>
                        {!visible.length && <p className="p-6 text-center text-muted-foreground">没有匹配的服务器，试试其他关键词。</p>}
                    </>}
                    <p className="text-xs text-muted-foreground mt-5">仅绑定的 TG 账号可用。授权有效期 15 分钟；长期任务请使用 tmux，授权过期后可重新进入。</p>
                </section>}
                {authorized && selected && <TerminalPage key={selected.id} targetServerId={selected.id} telegram/>}
            </main>
            <Toaster theme={theme} richColors position="top-center"/>
        </MemoryRouter>
    </SWRConfig>
}
createRoot(document.getElementById("root")!).render(<App/>)
