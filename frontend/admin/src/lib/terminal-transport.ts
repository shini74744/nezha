// The TG shell opts in before rendering. Dashboard callers keep their existing
// cookie transport; a TG failure must never fall back to that transport.
type TGAccess = { token: string; ownerId?: number; onExpired: () => void }
let tgAccess: TGAccess | null = null
export function setTelegramTerminalAccess(access: TGAccess) { tgAccess = access }
export function telegramTerminalOwner() { return tgAccess?.ownerId }
export function isTelegramTerminal() { return tgAccess !== null }
export async function telegramRequest<T>(path: string, data: unknown): Promise<T> {
    const access = tgAccess
    if (!access?.token) throw new Error("授权无效或已过期，请从 TG 网页终端菜单重新打开。")
    const response = await fetch("/api/v1/telegram-terminal/" + path, {
        method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + access.token },
        body: JSON.stringify(data), signal: AbortSignal.timeout(20000),
    })
    const body = await response.json().catch(() => ({}))
    if (response.status === 403) { access.token = ""; access.onExpired() }
    if (!response.ok) throw new Error(body.error || "请求失败，请重试")
    return body as T
}
export async function telegramUIRequest<T>(method: string, path: string, data?: unknown): Promise<T> {
    const result = await telegramRequest<{ success: boolean; error: string; data: T }>("ui", { method, path, data })
    if (!result.success) throw new Error(result.error || "操作失败")
    return result.data
}
export type TerminalSocket = Pick<WebSocket, "onopen" | "onmessage" | "onerror" | "onclose" | "readyState" | "binaryType" | "bufferedAmount" | "send" | "close">
export function createTerminalSocket(url: URL): TerminalSocket {
    if (!tgAccess) return new WebSocket(url)
    let inner: WebSocket | null = null
    let closed = false
    let ready = false
    const socket: TerminalSocket = {
        onopen: null, onmessage: null, onerror: null, onclose: null,
        binaryType: "arraybuffer",
        get bufferedAmount() { return inner?.bufferedAmount ?? 0 },
        get readyState() { return closed ? WebSocket.CLOSED : ready ? inner?.readyState ?? WebSocket.CONNECTING : WebSocket.CONNECTING },
        send(data) { if (ready && !closed) inner?.send(data) },
        close() { closed = true; inner?.close() },
    }
    // One-use tickets travel in the first frame, never URLs, cookies or storage.
    void telegramRequest<{ ticket: string }>("ui-ticket", { path: url.pathname + url.search }).then(({ ticket }) => {
        if (closed) return
        const endpoint = new URL("/api/v1/telegram-terminal/ui-ws", window.location.origin)
        endpoint.protocol = endpoint.protocol.replace("http", "ws")
        const ws = new WebSocket(endpoint)
        inner = ws; ws.binaryType = socket.binaryType
        ws.onopen = () => ws.send(JSON.stringify({ ticket }))
        ws.onmessage = event => {
            if (closed) return
            if (!ready) {
                if (event.data !== '{"ready":true}') { ws.close(); return }
                ready = true
                socket.onopen?.call(ws, new Event("open"))
            } else socket.onmessage?.call(ws, event)
        }
        ws.onerror = event => { if (!closed) socket.onerror?.call(ws, event) }
        ws.onclose = event => { if (!closed) { closed = true; socket.onclose?.call(ws, event) } }
    }).catch(() => {
        if (closed) return
        closed = true
        socket.onerror?.call(inner as WebSocket, new Event("error"))
        socket.onclose?.call(inner as WebSocket, new CloseEvent("close"))
    })
    return socket
}
