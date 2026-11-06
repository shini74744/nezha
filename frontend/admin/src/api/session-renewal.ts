// Browser-session renewal only. Authentication and expiry remain enforced by the server.
const RENEW_INTERVAL = 5 * 60_000
const RETRY_INTERVAL = 30_000
const REQUEST_TIMEOUT = 10_000

export function readCookie(name: string): string {
    const prefix = name + "="
    for (const part of document.cookie.split(";")) {
        const cookie = part.trim()
        if (cookie.startsWith(prefix)) return cookie.slice(prefix.length)
    }
    return ""
}

// Used only to share the cooldown across cookie rotations, never to authorize a request.
function sessionIdentity(token: string): string {
    try {
        const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
        const claims = JSON.parse(atob(payload))
        if (typeof claims.keyId === "string" && typeof claims.uid === "string") {
            return JSON.stringify([claims.uid, claims.keyId])
        }
    } catch { /* Opaque or legacy cookie: use its full value as the identity. */ }
    return token
}

let session = ""
let lastSuccess: number | undefined
let lastAttempt: number | undefined
let rejectedSession = ""
let pending: { controller: AbortController; promise: Promise<void> } | undefined

export function cancelSessionRenewal() {
    pending?.controller.abort()
    pending = undefined
    session = ""
    lastSuccess = undefined
    lastAttempt = undefined
    rejectedSession = ""
}

export function renewSessionIfNeeded(): Promise<void> {
    const token = readCookie("nz-jwt")
    const identity = sessionIdentity(token)
    if (identity !== session) {
        cancelSessionRenewal()
        session = identity
    }
    const csrf = readCookie("nz-csrf")
    if (!token || !csrf || document.visibilityState === "hidden" || navigator.onLine === false) {
        return Promise.resolve()
    }
    if (rejectedSession === identity) return Promise.resolve()
    if (pending) return pending.promise

    const now = Date.now()
    const sinceSuccess = lastSuccess === undefined ? Infinity : now - lastSuccess
    const sinceAttempt = lastAttempt === undefined ? Infinity : now - lastAttempt
    // A backwards clock correction must not postpone renewal indefinitely.
    if (sinceSuccess >= 0 && sinceSuccess < RENEW_INTERVAL) return Promise.resolve()
    if (sinceAttempt >= 0 && sinceAttempt < RETRY_INTERVAL) return Promise.resolve()

    lastAttempt = now
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    const flight = { controller, promise: Promise.resolve() }
    pending = flight
    flight.promise = (async () => {
        try {
            const response = await fetch("/api/v1/refresh-token", {
                method: "POST",
                credentials: "same-origin",
                headers: { "X-CSRF-Token": csrf },
                signal: controller.signal,
            })
            const body = await response.json().catch(() => null)
            if (controller.signal.aborted || pending !== flight) return
            const currentToken = readCookie("nz-jwt")
            // A login/logout in another tab must win over an old response.
            // A successful refresh can itself rotate this cookie.
            if (!currentToken || (currentToken !== token && currentToken !== body?.data?.token)) return
            if (response.ok && body?.success === true) {
                session = identity
                lastSuccess = Date.now()
            } else if (response.status === 401 || body?.error === "ApiErrorUnauthorized") {
                rejectedSession = identity
            }
        } catch {
            // Network/timeout errors retain the session and retry after the short cooldown.
        } finally {
            window.clearTimeout(timeout)
            if (pending === flight) pending = undefined
        }
    })()
    return flight.promise
}

// Owned by the authenticated admin provider; no background timer on the login page.
export function startSessionRenewal(): () => void {
    const check = () => { void renewSessionIfNeeded() }
    const timer = window.setInterval(check, RETRY_INTERVAL)
    document.addEventListener("visibilitychange", check)
    window.addEventListener("focus", check)
    window.addEventListener("online", check)
    window.addEventListener("pageshow", check)
    check()
    return () => {
        window.clearInterval(timer)
        document.removeEventListener("visibilitychange", check)
        window.removeEventListener("focus", check)
        window.removeEventListener("online", check)
        window.removeEventListener("pageshow", check)
        cancelSessionRenewal()
    }
}
