import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { cancelSessionRenewal, renewSessionIfNeeded, startSessionRenewal } from "../api/session-renewal"

const fiveMinutes = 300_000
let cookies = ""
let visible = true
let online = true
let stop: (() => void) | undefined
const success = () => new Response(JSON.stringify({ success: true }), { status: 200 })
const setSession = (value = "session") => { cookies = "nz-jwt=" + value + "; nz-csrf=csrf" }
const jwt = (keyId: string, stamp: number) => "header." + btoa(JSON.stringify({ uid: "user", keyId, orig_iat: stamp })) + ".sig"

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-06T00:00:00Z"))
    cancelSessionRenewal()
    visible = true
    online = true
    Object.defineProperty(document, "cookie", { configurable: true, get: () => cookies })
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden")
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online)
    setSession()
    vi.stubGlobal("fetch", vi.fn(async () => success()))
})

afterEach(() => {
    stop?.()
    stop = undefined
    cancelSessionRenewal()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

test("renews every five minutes, well before the one-hour session expires", async () => {
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(fiveMinutes - 1)
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/refresh-token", expect.objectContaining({
        method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": "csrf" },
    }))
})

test.each(["network", "http", "application", "invalid-json", "csrf"])("retries %s failure after 30 seconds instead of consuming the success interval", async failure => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
        if (failure === "network") throw new Error("offline")
        if (failure === "invalid-json") return new Response("not json", { status: 200 })
        return new Response(JSON.stringify({ success: false, error: "temporary" }), {
            status: failure === "http" ? 503 : failure === "csrf" ? 403 : 200,
        })
    })
    await renewSessionIfNeeded()
    await vi.advanceTimersByTimeAsync(29_999)
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(2)
})

test("concurrent requests share one renewal", async () => {
    let resolve!: (r: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const requests = Array.from({ length: 20 }, () => renewSessionIfNeeded())
    expect(fetch).toHaveBeenCalledTimes(1)
    resolve(success())
    await Promise.all(requests)
})

test("a hung request is aborted and can retry", async () => {
    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
    }))
    const first = renewSessionIfNeeded()
    await vi.advanceTimersByTimeAsync(10_000)
    await first
    expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(20_000)
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(2)
})

test("guest and missing CSRF do not renew or consume cooldown", async () => {
    cookies = "nz-csrf=csrf"
    await renewSessionIfNeeded()
    cookies = "nz-jwt=session"
    await renewSessionIfNeeded()
    expect(fetch).not.toHaveBeenCalled()
    setSession()
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(1)
})

test("visible authenticated page stays alive for three hours without API polling", async () => {
    let serverExpiresAt = Date.now() + 3_600_000
    vi.mocked(fetch).mockImplementation(async () => {
        expect(Date.now()).toBeLessThan(serverExpiresAt)
        serverExpiresAt = Date.now() + 3_600_000
        return success()
    })
    stop = startSessionRenewal()
    await vi.advanceTimersByTimeAsync(3 * 3_600_000)
    expect(fetch).toHaveBeenCalledTimes(37)
})

test.each(["focus", "online", "pageshow", "visibilitychange"])("returning via %s checks renewal immediately", async event => {
    stop = startSessionRenewal()
    await vi.advanceTimersByTimeAsync(0)
    visible = false
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    visible = true
    const target = event === "visibilitychange" ? document : window
    target.dispatchEvent(new Event(event))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
})

test("offline and hidden pages do not keep sessions alive", async () => {
    online = false
    stop = startSessionRenewal()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetch).not.toHaveBeenCalled()
    online = true
    window.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    visible = false
    await vi.advanceTimersByTimeAsync(2 * 3_600_000)
    expect(fetch).toHaveBeenCalledTimes(1)
})

test.each([200, 401])("expired/revoked session (%s) stops retrying until a new login", async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
        success: false, error: "ApiErrorUnauthorized",
    }), { status }))
    stop = startSessionRenewal()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    setSession("new-login")
    window.dispatchEvent(new Event("focus"))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
})

test("unmount/logout cancels timers and an in-flight request", async () => {
    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
    }))
    stop = startSessionRenewal()
    stop()
    stop = undefined
    cookies = ""
    await vi.advanceTimersByTimeAsync(3_600_000)
    window.dispatchEvent(new Event("focus"))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(true)
})

test("another tab rotating the same session does not cause renewal ping-pong", async () => {
    setSession(jwt("same-key", 1))
    await renewSessionIfNeeded()
    setSession(jwt("same-key", 2))
    await vi.advanceTimersByTimeAsync(30_000)
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(1)
    setSession(jwt("different-login", 3))
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(2)
})

test("rotated cookie from a successful refresh retains the five-minute cooldown", async () => {
    setSession(jwt("same-key", 1))
    vi.mocked(fetch).mockImplementationOnce(async () => {
        const token = jwt("same-key", 2)
        setSession(token)
        return new Response(JSON.stringify({ success: true, data: { token } }))
    })
    await renewSessionIfNeeded()
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(1)
})

test("clock moving backwards cannot strand an otherwise valid session", async () => {
    await renewSessionIfNeeded()
    vi.setSystemTime(new Date(Date.now() - 3_600_000))
    await renewSessionIfNeeded()
    expect(fetch).toHaveBeenCalledTimes(2)
})
