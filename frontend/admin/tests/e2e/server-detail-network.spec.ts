import { type Page, expect, test } from "@playwright/test"

import { createServer } from "../../../user/src/test/fixtures"

test.use({ ignoreHTTPSErrors: true })
async function setup(page: Page, theme: string, enabled = true, offline = false) {
    const origin = theme === "doraemon" ? "https://127.0.0.1:18478" : "https://127.0.0.1:18477"
    const state = { enabled, mode: "data", periods: [] as string[] }
    const now = Date.now(),
        last = now - 3600000
    const server = createServer({
        id: 7,
        name: "主站服务器",
        last_active: offline ? "0001-01-01T00:00:00Z" : new Date(now).toISOString(),
    })
    const names = [
        "重庆电信",
        "重庆移动",
        "重庆联通",
        "上海电信",
        "上海移动",
        "上海联通",
        "浙江电信",
        "上海电信ipv6",
        "上海移动ipv6",
        "上海联通ipv6",
        "谷歌 DNS",
        "Cloudflare DNS",
        "TG DC5",
        "香港特殊监控1.neb",
        "香港特殊监控2.GO.T",
        "日本特殊监控1.GO",
        "日本特殊监控2.claw",
        "新加坡特殊监控1.yxvm",
    ]
    const monitors = names.map((name, i) => ({
        monitor_id: i + 1,
        monitor_name: name,
        display_index: 0,
        server_id: 7,
        server_name: server.name,
        created_at: Array.from({ length: 60 }, (_, j) => now - (60 - j) * 60000),
        avg_delay: Array.from({ length: 60 }, (_, j) => 80 + i * 10 + Math.sin(j) * 20),
        packet_loss: Array(60).fill(i === 7 ? 20 : 0),
    }))
    await page.addInitScript(() => {
        localStorage.setItem("language", "zh-CN")
        localStorage.setItem("vite-ui-theme", "dark")
        localStorage.setItem("doraemon-ui-theme", "dark")
        localStorage.setItem("doraemon-sky", "dark")
    })
    await page.context().addCookies([{ name: "qa-session", value: "1", url: origin }])
    await page.routeWebSocket("**/api/v1/ws/server", (ws) =>
        ws.send(JSON.stringify({ now, servers: [server], online: offline ? 0 : 1 })),
    )
    await page.route("**/*", async (route) => {
        const u = new URL(route.request().url())
        let data: any
        if (u.pathname === "/api/v1/setting")
            data = {
                tsdb_enabled: true,
                config: {
                    language: "zh-CN",
                    site_name: "网络组合测试",
                    show_network_in_detail: state.enabled,
                    appearance_config: '{"version":1,"enabled":false,"features":{}}',
                    custom_code: "",
                },
            }
        else if (u.pathname === "/api/v1/profile") data = { id: 1, role: 0, username: "qa" }
        else if (u.pathname === "/api/v1/server/7/service") {
            state.periods.push(u.searchParams.get("period") || "1d")
            if (state.mode === "error") return route.fulfill({ json: { success: false } })
            data = state.mode === "empty" ? [] : monitors
        } else if (u.pathname.endsWith("/last-report"))
            data = {
                server_id: 7,
                tsdb_enabled: true,
                history_days: 30,
                last_report_at: last,
                snapshot: { at: last, host: server.host, state: server.state },
                metrics: { cpu: 12, memory: 512, disk: 1024 },
                recent: { cpu: [{ ts: last, value: 12 }] },
            }
        else if (u.pathname === "/api/v1/service") data = { services: {}, cycle_transfer_stats: {} }
        else if (u.pathname.endsWith("/metrics")) data = { data_points: [] }
        else if (u.pathname.startsWith("/api/")) data = []
        if (data !== undefined) return route.fulfill({ json: { success: true, data } })
        if (u.origin !== origin) return route.abort()
        return route.continue()
    })
    await page.goto(origin + "/server/7")
    return state
}
for (const theme of ["default", "doraemon"])
    for (const width of [320, 390, 768, 1440])
        test(theme + " combined network layout " + width, async ({ page }, info) => {
            await page.setViewportSize({ width, height: 900 })
            const errors: string[] = []
            page.on("pageerror", (e) => errors.push(e.message))
            const state = await setup(page, theme)
            const network = page.locator("[data-server-network]")
            await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6)
            await expect(network.getByText("18 个监控服务")).toBeVisible()
            await expect(network.locator("[data-chart]")).toHaveCount(1)
            await expect(page.locator(".server-info-tab").getByText("网络", {exact:true})).toHaveCount(0)
            await expect(network.locator(".recharts-line-curve")).toHaveCount(18)
            const details = await page.locator(".server-charts").boundingBox(),
                box = await network.boundingBox()
            expect(box!.y).toBeGreaterThanOrEqual(details!.y + details!.height)
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            await network.scrollIntoViewIfNeeded()
            await page.screenshot({ path: info.outputPath("combined.png"), fullPage: true })
            if (width === 390) {
                state.enabled = false
                await page.evaluate(() => {
                    Object.defineProperty(document, "visibilityState", {value:"hidden", configurable:true}); window.dispatchEvent(new Event("visibilitychange"));
                    Object.defineProperty(document, "visibilityState", {value:"visible", configurable:true}); window.dispatchEvent(new Event("visibilitychange"));
                    delete (document as any).visibilityState;
                })
                await page.locator(".server-info-tab").getByText("网络", { exact: true }).click()
                await expect(page.locator(".server-charts")).toHaveCount(0)
                await expect(network.locator("[data-chart]")).toHaveCount(1)
                state.enabled = true
                await page.evaluate(() => {
                    Object.defineProperty(document, "visibilityState", {value:"hidden", configurable:true}); window.dispatchEvent(new Event("visibilitychange"));
                    Object.defineProperty(document, "visibilityState", {value:"visible", configurable:true}); window.dispatchEvent(new Event("visibilitychange"));
                    delete (document as any).visibilityState;
                })
                await expect(page.locator(".server-info-tab").getByText("网络", {exact:true})).toHaveCount(0)
                await expect(page.locator(".server-charts")).toHaveCount(1)
                await expect(network.locator("[data-chart]")).toHaveCount(1)
            }
            expect(errors).toEqual([])
        })
for (const theme of ["default", "doraemon"])
    test(
        theme + " disabled setting keeps separate network and sends no monitor request",
        async ({ page }) => {
            const state = await setup(page, theme, false)
            await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6)
            await expect(page.locator("[data-server-network]")).toHaveCount(0)
            expect(state.periods).toEqual([])
            await page.reload()
            await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6)
            await expect(page.locator("[data-server-network]")).toHaveCount(0)
            expect(state.periods).toEqual([])
            await page.locator(".server-info-tab").getByText("网络", { exact: true }).click()
            await expect(
                page.locator("[data-server-network]").getByText("18 个监控服务"),
            ).toBeVisible()
            await page.locator(".server-info-tab").getByText("详情", { exact: true }).click()
            await expect(page.locator("[data-server-network]")).toHaveCount(0)
        },
    )
test("empty and failed monitoring never remove detail charts", async ({ page }) => {
    const state = await setup(page, "default")
    state.mode = "empty"
    await page.reload()
    await expect(page.locator("[data-server-network] [role=status]")).toBeVisible()
    await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6)
    state.mode = "error"
    await page.reload()
    await expect(page.locator("[data-server-network] [role=alert]")).toBeVisible()
    await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6)
    state.mode = "data"
    await page.locator("[data-server-network]").getByRole("button", { name: "重新加载" }).click()
    await expect(page.locator("[data-server-network]").getByText("18 个监控服务")).toBeVisible()
})
for (const theme of ["default", "doraemon"])
    test(theme + " offline detail also follows combined setting", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 850 })
        const state = await setup(page, theme, true, true)
        await expect(page.locator("[data-offline-detail] .server-charts")).toBeVisible()
        await expect(page.locator("[data-server-network]").getByText("18 个监控服务")).toBeVisible()
        await expect(page.locator(".server-info-tab").getByText("网络", {exact:true})).toHaveCount(0)
        state.enabled = false
        await page.reload()
        await expect(page.locator("[data-offline-detail] .server-charts")).toBeVisible()
        await expect(page.locator("[data-server-network]")).toHaveCount(0)
    })

for (const width of [320, 390, 1440])
    test(
        "appearance global switch preserves state across themes " + width,
        async ({ page }, info) => {
            const origin = "http://127.0.0.1:18479"
            await page.setViewportSize({ width, height: 900 })
            await page.addInitScript(() => {
                localStorage.setItem("i18nextLng", "zh-CN")
                localStorage.setItem("vite-ui-theme", "dark")
            })
            const display = { statistics_split: true, detail_network_split: false }
            const writes: any[] = []
            await page.route("**/*", async (route) => {
                const u = new URL(route.request().url())
                let data: any = []
                if (u.origin !== origin) return route.abort()
                if (!u.pathname.startsWith("/api/")) return route.continue()
                if (u.pathname === "/api/v1/profile") data = { id: 1, username: "qa", role: 0 }
                if (u.pathname === "/api/v1/setting")
                    data = {
                        config: {
                            site_name: "测试面板",
                            language: "zh-CN",
                            user_template: "user-dist",
                            cover: 1,
                            ip_change_notification_group_id: 0,
                            show_network_in_detail: !display.detail_network_split,
                        },
                        frontend_templates: [],
                    }
                if (u.pathname === "/api/v1/setting/appearance")
                    data = {
                        config: { version: 1, enabled: false, features: {} },
                        revision: "test",
                        custom_code: "",
                        current_template: "user-dist",
                    }
                if (route.request().method() === "PATCH") {
                    expect(u.pathname).toBe("/api/v1/setting/display")
                    const body = route.request().postDataJSON()
                    writes.push(body)
                    Object.assign(display, body)
                }
                if (u.pathname === "/api/v1/setting/display") data = display
                return route.fulfill({ json: { success: true, data } })
            })
            await page.goto(origin + "/dashboard/settings")
            const toggle = page.getByRole("switch", { name: "统计显示拆分" })
            await expect(page.getByLabel("站点名称")).toBeVisible()
            await expect(toggle).toHaveCount(0)
            await page.goto(origin + "/dashboard/settings/appearance")
            await expect(toggle).toHaveAttribute("aria-checked", "true")
            await expect(toggle).toBeEnabled()
            await expect(page.getByRole("switch", { name: "启用内置美化" })).toHaveAttribute(
                "aria-checked",
                "false",
            )
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            await expect(page.getByText(/功能代码随面板内置|正在设置：/)).toHaveCount(0)
            const help = page.getByRole("button", {name:"详细网络拆分说明",exact:true})
            await help.click()
            await expect(page.locator("[data-setting-help]")).toContainText("隐藏网络标签")
            await page.keyboard.press("Escape")
            await expect(help).toBeFocused()
            await toggle.scrollIntoViewIfNeeded()
            await page.screenshot({ path: info.outputPath("appearance-global-switch.png") })
            const theme = page.getByRole("combobox", { name: "设置主题" })
            await theme.selectOption("doraemon-dist")
            await expect(toggle).toHaveAttribute("aria-checked", "true")
            await expect(theme).toBeEnabled()
            for (const [name, key] of [
                ["统计显示拆分", "statistics_split"],
                ["详细网络拆分", "detail_network_split"],
            ])
                for (const value of key === "statistics_split" ? [false, true] : [true, false]) {
                    const toggle = page.getByRole("switch", { name })
                    await toggle.click()
                    await expect.poll(() => writes.at(-1)).toEqual({ [key]: value })
                    await expect(toggle).toBeEnabled()
                    await page.reload()
                    await expect(toggle).toHaveAttribute("aria-checked", String(value))
                }
            expect(writes).toEqual([
                { statistics_split: false },
                { statistics_split: true },
                { detail_network_split: true },
                { detail_network_split: false },
            ])
        },
    )