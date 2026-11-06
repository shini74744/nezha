import { test, expect, type Page } from "@playwright/test"

const originTime = new Date("2026-11-06T00:00:00Z")
const jwt = (issued: number) => "header." + Buffer.from(JSON.stringify({
    uid: "fixture-user", keyId: "fixture-session", orig_iat: issued, exp: issued + 3600,
})).toString("base64url") + ".signature"

async function setup(page: Page, width = 1440) {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.install({ time: originTime })
    // Observe response consumption before jumping the clock again. A server-side
    // request counter alone can advance while the browser is still reading JSON.
    await page.addInitScript(() => {
        ;(window as any).__renewalResponsesRead = 0
        const nativeFetch = window.fetch.bind(window)
        window.fetch = async (...args) => {
            const response = await nativeFetch(...args)
            if (String(args[0]).includes("/api/v1/refresh-token")) {
                const json = response.json.bind(response)
                response.json = async () => {
                    try { return await json() }
                    finally { (window as any).__renewalResponsesRead++ }
                }
            }
            return response
        }
    })
    const baseURL = test.info().project.use.baseURL as string
    await page.context().addCookies([
        { name: "nz-jwt", value: jwt(originTime.getTime() / 1000), url: baseURL },
        { name: "nz-csrf", value: "fixture-csrf", url: baseURL },
    ])
    const state = { attempts: 0, renewed: 0, rejected: 0, expires: originTime.getTime() + 3600000,
        fail: false, documents: 0, mutations: [] as string[], errors: [] as string[] }
    page.on("request", r => { if (r.resourceType() === "document") state.documents++ })
    page.on("pageerror", error => state.errors.push(error.message))
    await page.route("**/api/v1/**", async route => {
        const path = new URL(route.request().url()).pathname
        const now = await page.evaluate(() => Date.now())
        if (path === "/api/v1/refresh-token") {
            state.attempts++
            expect(route.request().method()).toBe("POST")
            expect(route.request().headers()["x-csrf-token"]).toBe("fixture-csrf")
            if (state.fail) return route.fulfill({ status: 503, json: { success: false, error: "temporary" } })
            if (now >= state.expires) {
                state.rejected++
                return route.fulfill({ status: 401, json: { success: false, error: "ApiErrorUnauthorized" } })
            }
            state.renewed++
            state.expires = now + 3600000
            const token = jwt(Math.floor(now / 1000))
            return route.fulfill({ headers: { "Set-Cookie": "nz-jwt=" + token + "; Path=/; SameSite=Lax" },
                json: { success: true, data: { token, expire: new Date(state.expires).toISOString() } } })
        }
        if (route.request().method() !== "GET") state.mutations.push(path)
        let data: any = []
        if (path === "/api/v1/profile") {
            if (now >= state.expires) return route.fulfill({ json: { success: false, error: "ApiErrorUnauthorized" } })
            data = { id: 1, username: "admin", role: 0 }
        }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/server") data = [{ id: 7, name: "续期测试机器", uuid: "fixture-7",
            display_index: 7, user_id: 1, host: { version: "1.0.9" }, note: "原备注", public_note: "" }]
        if (path === "/api/v1/server/nic-change-reminders") data = {}
        await route.fulfill({ json: { success: true, data } })
    })
    await page.goto("/dashboard")
    await expect(page.locator(".server-list-table tbody")).toContainText("续期测试机器", { timeout: 15000 })
    await expect.poll(() => state.renewed).toBe(1)
    await expect.poll(() => page.evaluate(() => (window as any).__renewalResponsesRead)).toBe(1)
    return state
}

for (const width of [390, 1440]) test("visible admin survives three hours and preserves unsaved edit " + width, async ({ page }) => {
    const state = await setup(page, width)
    await page.getByRole("button", { name: "编辑服务器", exact: true }).click()
    const dialog = page.getByRole("dialog")
    const name = dialog.locator('input[name="name"]')
    await name.fill("尚未提交的名称")
    for (let i = 0; i < 36; i++) {
        const count = state.renewed
        // The heartbeat checks every 30s; include one tick beyond the 5m cooldown.
        await page.clock.fastForward(330_100)
        await expect.poll(() => state.renewed).toBe(count + 1)
        await expect.poll(() => page.evaluate(() => (window as any).__renewalResponsesRead)).toBe(count + 1)
    }
    await expect(name).toHaveValue("尚未提交的名称")
    expect(state.rejected).toBe(0)
    expect(state.documents).toBe(1)
    expect(state.mutations).toEqual([])
    expect(state.errors).toEqual([])
})

test("temporary renewal failure retries after 30 seconds without losing the page", async ({ page }) => {
    const state = await setup(page)
    state.fail = true
    await page.clock.fastForward(330_100)
    await expect.poll(() => state.attempts).toBe(2)
    expect(state.renewed).toBe(1)
    state.fail = false
    await page.clock.fastForward(30_100)
    await expect.poll(() => state.renewed).toBe(2)
    await expect(page.locator(".server-list-table tbody")).toContainText("续期测试机器", { timeout: 15000 })
    expect(state.documents).toBe(1)
    expect(state.errors).toEqual([])
})

test("return before expiry renews immediately, return after expiry cannot revive login", async ({ page }) => {
    const state = await setup(page)
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }))
    await page.clock.fastForward(40 * 60_000)
    expect(state.renewed).toBe(1)
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
        document.dispatchEvent(new Event("visibilitychange"))
    })
    await expect.poll(() => state.renewed).toBe(2)
    await expect.poll(() => page.evaluate(() => (window as any).__renewalResponsesRead)).toBe(2)
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }))
    await page.clock.fastForward(61 * 60_000)
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
        window.dispatchEvent(new Event("focus"))
    })
    await expect.poll(() => state.rejected).toBe(1)
    await expect(page).toHaveURL(/login\?reason=expired/)
    await expect(page.getByRole("status")).toContainText("登录已过期")
    await page.clock.fastForward(10 * 60_000)
    expect(state.rejected).toBe(1)
    expect(state.renewed).toBe(2)
    expect(state.errors).toEqual([])
})

test("logging out stops renewal and removes the browser cookie", async ({ page }) => {
    const state = await setup(page)
    await page.getByRole("button", { name: "账户菜单" }).click()
    await page.getByRole("menuitem", { name: /登出|退出|Log out|Logout/ }).click()
    await expect(page).toHaveURL(/login/)
    const before = state.attempts
    await page.clock.fastForward(70 * 60_000)
    expect(state.attempts).toBe(before)
    expect((await page.context().cookies()).some(c => c.name === "nz-jwt")).toBe(false)
})

test("returning after the browser removes the expired cookie opens login with a clear prompt", async ({ page }) => {
    const state = await setup(page)
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }))
    await page.clock.fastForward(61 * 60_000)
    await page.context().clearCookies({ name: "nz-jwt" })
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
        document.dispatchEvent(new Event("visibilitychange"))
    })
    await expect(page).toHaveURL(/login\?reason=expired/)
    await expect(page.getByRole("status")).toContainText("登录已过期，请重新登录")
    const attempts = state.attempts
    await page.clock.fastForward(60_100)
    expect(state.attempts).toBe(attempts)
    expect(state.errors).toEqual([])
})
