import { test, expect } from "@playwright/test"
import { createServer } from "../../../user/src/test/fixtures"

test.use({ ignoreHTTPSErrors: true, reducedMotion: "reduce" })
for (const theme of ["default", "doraemon"])
    for (const color of ["light", "dark"])
        for (const width of [390, 1440])
            test("expiry continuous color " + theme + " " + color + " " + width, async ({ page }, info) => {
                const origin = process.env.E2E_NETWORK_ORIGIN || (theme === "default" ? "https://127.0.0.1:18477" : "https://127.0.0.1:18478")
                const now = Date.parse("2026-10-10T04:00:00Z"), day = 86400000
                const values = [95, 75, 50, 25, 5]
                await page.clock.setFixedTime(new Date(now))
                await page.setViewportSize({ width, height: 900 })
                await page.addInitScript((color) => {
                    localStorage.setItem("language", "zh-CN")
                    for (const key of ["vite-ui-theme", "doraemon-ui-theme", "doraemon-sky"]) localStorage.setItem(key, color)
                    localStorage.setItem("inline", "0")
                    localStorage.setItem("showMap", "0")
                    localStorage.setItem("showServices", "0")
                }, color)
                const servers = values.map((value, i) => createServer({
                    id: i + 1, name: "剩余比例 " + value + "%", last_active: new Date(now).toISOString(),
                    public_note: JSON.stringify({ billingDataMod: {
                        startDate: new Date(now - (100 - value) * day).toISOString(),
                        endDate: new Date(now + value * day).toISOString(),
                        autoRenewal: "0", cycle: "monthly", amount: "10",
                    } }),
                }))
                await page.routeWebSocket("**/api/v1/ws/server", ws => ws.send(JSON.stringify({ now, servers, online: servers.length })))
                await page.route("**/*", route => {
                    const url = new URL(route.request().url())
                    if (url.origin !== origin) return route.abort()
                    if (!url.pathname.startsWith("/api/")) return route.continue()
                    let data: any = []
                    if (url.pathname === "/api/v1/setting") data = { config: {
                        language: "zh-CN", site_name: "到期条验证",
                        appearance_config: '{"version":1,"enabled":false,"features":{}}',
                    } }
                    if (url.pathname.includes("/service")) data = { services: {}, cycle_transfer_stats: {} }
                    if (url.pathname === "/api/v1/server-traffic") data = {}
                    return route.fulfill({ json: { success: true, data } })
                })
                await page.goto(origin + "/")
                const bars = page.locator("[data-expiry-progress]:visible")
                await expect(bars).toHaveCount(values.length)
                await expect.poll(() => bars.evaluateAll(nodes => nodes.map(e => getComputedStyle(e).color).filter(Boolean).length)).toBe(values.length)
                const actual = await bars.evaluateAll(nodes => nodes.map(e => ({
                    color: getComputedStyle(e).color,
                    fill: getComputedStyle(e.firstElementChild!).backgroundColor,
                    transform: (e.firstElementChild as HTMLElement).style.transform,
                })))
                const expected = await page.evaluate(values => values.map(value => {
                    const e = document.createElement("div")
                    e.style.color = `hsl(${value * 1.2} 70% 45%)`
                    return { color: e.style.color, transform: `translateX(-${100-value}%)` }
                }), values)
                expect(new Set(actual.map(item => item.fill)).size, JSON.stringify(actual)).toBe(values.length)
                for (const item of actual) {
                    expect(item.fill).toBe(item.color)
                    expect(expected).toContainEqual({ color: item.color, transform: item.transform })
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
                await page.screenshot({ path: info.outputPath("expiry-colors.png") })
            })
