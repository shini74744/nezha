import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { controlSequenceForInput, terminalKeySequence, type TerminalKey } from "../lib/terminal-keys"
import { searchTerminalServers, type TerminalServer } from "./search"
import "./style.css"

type WebApp = {
    initData: string
    ready(): void
    expand(): void
    enableClosingConfirmation?(): void
    disableClosingConfirmation?(): void
    onEvent?(name: string, listener: () => void): void
}
const tg = (window as Window & { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = el("status"), badge = el("badge"), picker = el("picker"), shell = el("shell")
const search = el<HTMLInputElement>("search"), online = el<HTMLInputElement>("online")
const list = el("servers"), screen = el("screen"), keys = el("keys")
let token = "", rows: TerminalServer[] = [], busy = false
let cleanup: (() => void) | undefined
let sequence = 0
function message(text: string, error = false) {
    status.textContent = text
    status.classList.toggle("error", error)
}
async function api<T>(path: string, body: object): Promise<T> {
    const response = await fetch("/api/v1/telegram-terminal/" + path, {
        method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || "请求失败，请从 TG 菜单重新打开。")
    return data as T
}
function render() {
    const selected = searchTerminalServers(rows, search.value, online.checked)
    el("count").textContent = selected.length + " / " + rows.length + " 台"
    list.replaceChildren()
    for (const row of selected) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "server"
        button.disabled = !row.online || busy
        const dot = document.createElement("span")
        dot.className = "dot" + (row.online ? " online" : "")
        const meta = document.createElement("span"); meta.className = "meta"
        const name = document.createElement("strong"); name.textContent = row.name
        const detail = document.createElement("small"); detail.textContent = "#" + row.id + " · " + (row.online ? "在线" : "离线")
        meta.append(name, detail)
        const action = document.createElement("span"); action.className = "connect-label"
        action.textContent = row.online ? "连接 →" : "暂不可用"
        button.append(dot, meta, action)
        button.addEventListener("click", () => void connect(row))
        list.append(button)
    }
    if (!selected.length) {
        const empty = document.createElement("p"); empty.className = "empty"
        empty.textContent = rows.length ? "没有匹配的服务器，试试其他关键词。" : "暂无可访问的服务器。"
        list.append(empty)
    }
}
async function reload() {
    el<HTMLButtonElement>("refresh").disabled = true
    try {
        const result = await api<{ servers: TerminalServer[] }>("servers", {})
        rows = result.servers
        render()
    } catch (e) { message((e as Error).message, true) }
    finally { el<HTMLButtonElement>("refresh").disabled = false }
}
function chooseAgain() {
    sequence++
    cleanup?.(); cleanup = undefined
    busy = false; shell.hidden = true; picker.hidden = false
    badge.textContent = "选择服务器"
    message("选择要连接的服务器。支持名称、ID 和多个关键词搜索。")
    tg?.disableClosingConfirmation?.()
    render()
}
async function connect(server: TerminalServer) {
    if (busy || !server.online) return
    busy = true; render()
    const current = ++sequence
    message("正在连接 " + server.name + "…")
    try {
        const result = await api<{ ticket: string }>("connect", { server_id: server.id })
        if (sequence !== current) return
        picker.hidden = true; shell.hidden = false
        el("server-name").textContent = server.name + " · #" + server.id
        badge.textContent = "连接中"
        screen.replaceChildren(); keys.replaceChildren()
        const terminal = new Terminal({ cursorBlink: true, fontSize: innerWidth < 640 ? 13 : 15,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            scrollback: 5000, theme: { background: "#080c12" } })
        const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(screen)
        const url = new URL("/api/v1/telegram-terminal/ws", location.origin)
        url.protocol = "wss:"
        const ws = new WebSocket(url); ws.binaryType = "arraybuffer"
        let ready = false, ctrl = false
        const ctrlButton = document.createElement("button")
        ctrlButton.textContent = "Ctrl"; ctrlButton.setAttribute("aria-pressed", "false")
        function resetCtrl() { ctrl = false; ctrlButton.classList.remove("active"); ctrlButton.setAttribute("aria-pressed", "false") }
        function send(data: string, applyControl = true) {
            if (!ready || ws.readyState !== WebSocket.OPEN) return
            ws.send(applyControl && ctrl ? controlSequenceForInput(data) ?? data : data)
            resetCtrl(); terminal.focus()
        }
        const data = terminal.onData((text) => send(text))
        const binary = terminal.onBinary((text) => {
            if (!ready || ws.readyState !== WebSocket.OPEN) return
            const buffer = new Uint8Array(text.length + 1)
            for (let i = 0; i < text.length; i++) buffer[i + 1] = text.charCodeAt(i) & 255
            ws.send(buffer)
        })
        const resize = () => {
            if (sequence !== current) return
            const bottom = (visualViewport?.height ?? innerHeight) + (visualViewport?.offsetTop ?? 0)
            screen.style.setProperty("--screen-height", Math.max(150, bottom - screen.getBoundingClientRect().top - 102) + "px")
            try { fit.fit() } catch { return }
            if (ready && ws.readyState === WebSocket.OPEN && terminal.cols >= 2 && terminal.rows >= 2) {
                const data = new TextEncoder().encode(JSON.stringify({ Rows: terminal.rows, Cols: terminal.cols }))
                const frame = new Uint8Array(data.length + 1); frame[0] = 1; frame.set(data, 1); ws.send(frame)
            }
        }
        const observer = new ResizeObserver(resize); observer.observe(screen)
        window.addEventListener("resize", resize); visualViewport?.addEventListener("resize", resize)
        ctrlButton.onclick = () => { ctrl = !ctrl; ctrlButton.classList.toggle("active", ctrl); ctrlButton.setAttribute("aria-pressed", String(ctrl)); terminal.focus() }
        keys.append(ctrlButton)
        for (const [key, label] of [["escape","Esc"],["tab","Tab"],["arrowLeft","←"],["arrowUp","↑"],["arrowDown","↓"],["arrowRight","→"]] as [TerminalKey,string][]) {
            const button = document.createElement("button"); button.textContent = label
            button.onclick = () => send(terminalKeySequence(key, ctrl), false)
            keys.append(button)
        }
        const interrupt = document.createElement("button"); interrupt.textContent = "Ctrl+C"; interrupt.onclick = () => send("\x03", false); keys.append(interrupt)
        const enter = document.createElement("button"); enter.textContent = "Enter"; enter.onclick = () => send("\r", false); keys.append(enter)
        ws.onopen = () => { ws.send(JSON.stringify({ ticket: result.ticket })); result.ticket = "" }
        ws.onmessage = (event) => {
            if (sequence !== current) return
            if (!ready) {
                if (typeof event.data !== "string" || event.data !== '{"ready":true}') { ws.close(); return }
                ready = true; badge.textContent = "已连接"
                message("终端最长连接 30 分钟；断开后可重新选择服务器。")
                tg?.enableClosingConfirmation?.()
                resize(); terminal.focus(); return
            }
            terminal.write(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data)
        }
        ws.onclose = () => {
            if (sequence !== current) return
            ready = false; badge.textContent = "已断开"
            message("连接已断开。若未能连接，请检查 Agent 是否在线、是否允许终端。", true)
            tg?.disableClosingConfirmation?.()
        }
        ws.onerror = () => message("终端连接失败，请检查网络后重试。", true)
        cleanup = () => {
            ready = false; ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.onopen = null; ws.close()
            observer.disconnect(); window.removeEventListener("resize", resize); visualViewport?.removeEventListener("resize", resize)
            data.dispose(); binary.dispose(); terminal.dispose()
        }
        resize()
    } catch (e) {
        if (sequence !== current) return
        busy = false; render(); message((e as Error).message, true)
    }
}
search.addEventListener("input", render); online.addEventListener("change", render)
el("refresh").addEventListener("click", () => void reload())
el("disconnect").addEventListener("click", chooseAgain)
window.addEventListener("pagehide", () => { sequence++; cleanup?.(); token = "" })
async function start() {
    const params = new URLSearchParams(location.hash.slice(1))
    const launch = params.get("launch") || ""
    // Telegram may append its own fragment parameters. Preserve initData only
    // in memory and immediately remove the launch from history.
    history.replaceState(null, "", location.pathname)
    if (!tg?.initData || !launch) {
        badge.textContent = "无法验证"
        message("请在绑定账号的 TG 私聊中，使用“网页终端”菜单打开。", true); return
    }
    tg.ready(); tg.expand()
    try {
        const result = await api<{ token: string }>("bootstrap", { launch, init_data: tg.initData })
        token = result.token
        chooseAgain(); await reload()
    } catch (e) { badge.textContent = "无法验证"; message((e as Error).message, true) }
}
void start()
