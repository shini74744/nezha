import { type Page, expect, test } from "@playwright/test"
import fs from "node:fs"

import { createServer } from "../../../user/src/test/fixtures"

// Keep classic scrollbars visible; headless Chromium otherwise hides this regression.
test.use({
    ignoreHTTPSErrors: true,
    launchOptions: {
        ignoreDefaultArgs: ["--hide-scrollbars"],
        args: ["--disable-features=OverlayScrollbar,OverlayScrollbars"],
    },
})
const defs = JSON.parse(
    fs.readFileSync(new URL("../../../user/src/appearance/manifest.json", import.meta.url), "utf8"),
)
async function mock(
    page: Page,
    theme: string,
    dark: boolean,
    trafficOnly = false,
    serverCount = 3,
    split = true,
) {
    const origin = theme === "doraemon" ? "https://127.0.0.1:5190" : "https://127.0.0.1:5189"
    const now = Date.now()
    const servers = Array.from({ length: serverCount }, (_, i) => i + 1).map((id) =>
        createServer({
            id,
            name: id === 1 ? "香港家宽母鸡1-香港海创前置长名称网络节点测试" : "测试服务器 " + id,
            last_active: new Date(now).toISOString(),
        }),
    )
    const config = {
        version: 1,
        enabled: true,
        features: Object.fromEntries(
            defs.map((d: any) => [d.key, { ...d.defaults, enabled: d.key === "traffic" }]),
        ),
    }
    const cycle = {
        name: "月流量统计",
        from: "2026-10-01T00:00:00+08:00",
        to: "2026-11-01T00:00:00+08:00",
        max: 1024 ** 4,
        min: 0,
        server_name: Object.fromEntries(servers.map((s) => [s.id, s.name])),
        transfer: { "1": 1.67 * 1024 ** 4, "2": 400 * 1024 ** 3, "3": 0 },
        next_update: Object.fromEntries(servers.map((s) => [s.id, "2026-10-05T23:30:54+08:00"])),
    }
    const services = Object.fromEntries(
        ["重庆电信", "上海电信IPv6-国际网络长名称连通性检测", "浙江移动"].map((service_name, i) => [
            i,
            {
                service_name,
                current_up: 1,
                current_down: 0,
                total_up: 29,
                total_down: 1,
                up: Array.from({ length: 30 }, (_, j) => (j ? 100 : 0)),
                down: Array.from({ length: 30 }, (_, j) => (j ? 0 : 100)),
                delay: Array(30).fill(i ? 312 : 231),
            },
        ]),
    )
    await page.addInitScript(
        ({ dark }) => {
            localStorage.setItem("language", "zh-CN")
            localStorage.setItem("vite-ui-theme", dark ? "dark" : "light")
            localStorage.setItem("doraemon-ui-theme", dark ? "dark" : "light")
            localStorage.setItem("doraemon-sky", dark ? "dark" : "light")
            localStorage.setItem("showMap", "0")
        },
        { dark },
    )
    await page.routeWebSocket("**/api/v1/ws/server", (ws) =>
        ws.send(JSON.stringify({ now, servers, online: 3 })),
    )
    await page.route("**/*", async (route) => {
        const u = new URL(route.request().url())
        let data: any
        if (u.pathname === "/api/v1/setting")
            data = {
                config: {
                    statistics_split: split,
                    site_name: "统计视图测试",
                    language: "zh-CN",
                    custom_code: "",
                    appearance_config: JSON.stringify(config),
                    doraemon_appearance_config: JSON.stringify({
                        version: 1,
                        enabled: true,
                        features: { traffic: { enabled: true, toggleInterval: 5000 } },
                    }),
                },
                version: "test",
            }
        else if (u.pathname === "/api/v1/profile")
            return route.fulfill({ json: { success: false } })
        else if (u.pathname === "/api/v1/server-group") data = []
        else if (u.pathname === "/api/v1/service")
            data = {
                services: trafficOnly ? {} : services,
                cycle_transfer_stats: { monthly: cycle },
            }
        else if (u.pathname === "/api/v1/server-traffic")
            data = Object.fromEntries(
                servers.map((s) => [
                    s.id,
                    {
                        name: "quota",
                        quota_type: "limited",
                        max: 1024 ** 4,
                        from: cycle.from,
                        to: cycle.to,
                        direction: "3",
                        used: 500 * 1024 ** 3,
                    },
                ]),
            )
        else if (u.pathname.startsWith("/api/")) data = []
        if (data !== undefined) return route.fulfill({ json: { success: true, data } })
        if (u.origin !== origin) return route.abort()
        return route.continue()
    })
    await page.goto(origin)
    return origin
}
for (const theme of ["default", "doraemon"])
    for (const width of [320, 390, 768, 1440]) {
        test(theme + " statistics menu responsive " + width, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 })
            const errors: string[] = []
            page.on("pageerror", (e) => errors.push(e.message))
            await mock(page, theme, false)
            const trigger = page.getByRole("button", { name: "选择统计视图", exact: true })
            await expect(trigger).toBeVisible()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
            await trigger.click()
            const menu = page.getByRole("menu")
            await expect(menu).toBeVisible()
            await expect(menu).toHaveCSS("opacity", "1")
            expect(await menu.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(
                "rgba(0, 0, 0, 0)",
            )
            const box = await menu.boundingBox()
            expect(box!.width).toBeLessThanOrEqual(140)
            expect(box!.height).toBeLessThanOrEqual(90)
            await expect(menu.getByRole("menuitemradio")).toHaveCount(2)
            await expect(
                menu.getByRole("menuitemradio", { name: "收起统计", exact: true }),
            ).toHaveCount(0)
            await expect(menu.getByText("选择统计视图", { exact: true })).toHaveCount(0)
            expect(box!.x).toBeGreaterThanOrEqual(0)
            expect(box!.x + box!.width).toBeLessThanOrEqual(width)
            await page.screenshot({
                path: "test-results/statistics-menu-" + theme + "-" + width + ".png",
            })
            await page.getByRole("menuitemradio", { name: "流量统计", exact: true }).click()
            await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(3)
            await expect(page.locator('[data-statistics-card="uptime"]')).toHaveCount(0)
            await expect(page.getByText("167.0%", { exact: true })).toBeVisible()
            await expect(page.getByRole("progressbar").first()).toHaveAttribute(
                "aria-valuenow",
                "100",
            )
            // Native server-card traffic remains independent of the selected statistics category.
            await expect(page.locator("[data-native-traffic],.dora-traffic").first()).toBeVisible()
            await page.locator("[data-statistics-view]").scrollIntoViewIfNeeded()
            await page.screenshot({
                path: "test-results/statistics-traffic-" + theme + "-" + width + ".png",
            })
            await trigger.click()
            await expect(
                page.getByRole("menuitemradio", { name: "流量统计", exact: true }),
            ).toHaveAttribute("aria-checked", "true")
            await page.getByRole("menuitemradio", { name: "流量统计", exact: true }).click()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
            await expect(menu).toHaveCount(0)
            await expect(trigger).toBeFocused()
            await page.reload()
            await expect(trigger).toBeVisible()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
            await trigger.click()
            await expect(menu.locator('[aria-checked="true"]')).toHaveCount(0)
            await page.getByRole("menuitemradio", { name: "流量统计", exact: true }).click()
            await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(3)
            await trigger.click()
            await page.getByRole("menuitemradio", { name: "在线率", exact: true }).click()
            await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(0)
            await expect(page.locator('[data-statistics-card="uptime"]')).toHaveCount(3)
            await page
                .locator('[data-statistics-card="uptime"]')
                .first()
                .locator("button")
                .first()
                .click()
            await expect(page.locator("[data-day-detail]")).toBeVisible()
            await page.getByRole("button", { name: "收起当天详情", exact: true }).click()
            await expect(page.locator("[data-day-detail]")).toHaveCount(0)
            await page.locator("[data-statistics-view]").scrollIntoViewIfNeeded()
            await page.screenshot({
                path: "test-results/statistics-uptime-" + theme + "-" + width + ".png",
            })
            expect(
                await page
                    .locator("[data-statistics-card]")
                    .evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1)),
            ).toBe(true)
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            await page.reload()
            await expect(page.locator('[data-statistics-view="uptime"]')).toBeVisible()
            await trigger.click()
            const selectedUptime = page.getByRole("menuitemradio", { name: "在线率", exact: true })
            await expect(selectedUptime).toHaveAttribute("aria-checked", "true")
            await selectedUptime.focus()
            await page.keyboard.press("Enter")
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
            await expect(trigger).toBeFocused()
            await page.reload()
            await expect(trigger).toBeVisible()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
            await trigger.focus()
            await page.keyboard.press("Enter")
            await expect(menu).toBeVisible()
            await page.keyboard.press("Escape")
            await expect(menu).toHaveCount(0)
            await expect(trigger).toBeFocused()
            expect(errors).toEqual([])
        })
    }
for (const theme of ["default", "doraemon"])
    test(theme + " traffic-only and dark mobile", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 740 })
        await mock(page, theme, true, true)
        await page.getByRole("button", { name: "选择统计视图", exact: true }).click()
        await page.getByRole("menuitemradio", { name: "流量统计", exact: true }).click()
        await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(3)
        await page.locator("[data-statistics-view]").scrollIntoViewIfNeeded()
        await page.screenshot({ path: "test-results/statistics-dark-" + theme + ".png" })
        await page.getByRole("button", { name: "选择统计视图", exact: true }).click()
        expect(
            await page.getByRole("menu").evaluate((e) => {
                const probe = document.createElement("div")
                probe.className = "dark:bg-stone-900/95"
                document.body.append(probe)
                const same =
                    getComputedStyle(e).backgroundColor === getComputedStyle(probe).backgroundColor
                probe.remove()
                return same
            }),
        ).toBe(true)
        await expect(page.getByRole("menu")).toHaveCSS("opacity", "1")
        await page.screenshot({
            path:
                "/srv/nezha-builder/qa-statistics-toggle-20261005/statistics-dark-menu-" +
                theme +
                ".png",
        })
        await page.getByRole("menuitemradio", { name: "在线率", exact: true }).click()
        await expect(page.getByText("暂无在线率数据，请先配置服务监控。")).toBeVisible()
        await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(0)
    })
for (const theme of ["default", "doraemon"])
    test(theme + " compact touch menu", async ({ browser }) => {
        const context = await browser.newContext({
            viewport: { width: 320, height: 740 },
            hasTouch: true,
            ignoreHTTPSErrors: true,
        })
        const page = await context.newPage()
        try {
            await mock(page, theme, true)
            await page.getByRole("button", { name: "选择统计视图", exact: true }).tap()
            const menu = page.getByRole("menu")
            await expect(menu).toBeVisible()
            const b = await menu.boundingBox()
            expect(b!.width).toBeLessThanOrEqual(140)
            expect(b!.height).toBeLessThanOrEqual(110)
            await expect(menu.getByRole("menuitemradio")).toHaveCount(2)
            for (const item of await menu.getByRole("menuitemradio").all())
                await expect(item).toHaveCSS("min-height", "44px")
            await menu.getByRole("menuitemradio", { name: "在线率", exact: true }).tap()
            await expect(page.locator('[data-statistics-card="uptime"]')).toHaveCount(3)
            await page.getByRole("button", { name: "选择统计视图", exact: true }).tap()
            await menu.getByRole("menuitemradio", { name: "在线率", exact: true }).tap()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
            await page.getByRole("button", { name: "选择统计视图", exact: true }).tap()
            await menu.getByRole("menuitemradio", { name: "流量统计", exact: true }).tap()
            await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(3)
            await page.getByRole("button", { name: "选择统计视图", exact: true }).tap()
            await menu.getByRole("menuitemradio", { name: "流量统计", exact: true }).tap()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
        } finally {
            await context.close()
        }
    })

test.describe("statistics menu scroll stability", () => {
    for (const theme of ["default", "doraemon"])
        for (const width of [390, 1366])
            test(theme + " keeps scrollbars and layout stable " + width, async ({ page }) => {
                await page.setViewportSize({ width, height: 850 })
                await mock(page, theme, true, false, 30)
                // Wait for the configured theme and server cards, not its initial loading toolbar.
                await expect(page.locator("[data-native-traffic]")).toHaveCount(30)
                const trigger = page.getByRole("button", { name: "选择统计视图", exact: true }),
                    menu = page.getByRole("menu")
                await expect(trigger).toBeVisible()
                await trigger.scrollIntoViewIfNeeded()
                expect(
                    await page.evaluate(() => document.documentElement.scrollHeight > innerHeight),
                ).toBe(true)
                const geometry = () =>
                    page.locator("[data-statistics-trigger]").evaluate((e) => {
                        const body = document.body,
                            style = getComputedStyle(body),
                            rect = e.getBoundingClientRect()
                        return {
                            left: rect.left,
                            top: rect.top,
                            bodyWidth: body.getBoundingClientRect().width,
                            viewport: document.documentElement.clientWidth,
                            scrollY,
                            overflow: style.overflow,
                            paddingRight: style.paddingRight,
                            marginRight: style.marginRight,
                            pointerEvents: style.pointerEvents,
                            scrollLock: body.getAttribute("data-scroll-locked"),
                        }
                    })
                const before = await geometry()
                expect(before.scrollLock).toBeNull()
                expect(before.viewport).toBeLessThan(width) // A real, non-overlay scrollbar is present.
                await page.screenshot({
                    path:
                        "/srv/nezha-builder/qa-statistics-scroll-20261005/" +
                        theme +
                        "-" +
                        width +
                        "-before.png",
                })
                for (let i = 0; i < 3; i++) {
                    await trigger.click()
                    await expect(menu).toBeVisible()
                    await expect(menu).toHaveCSS("opacity", "1")
                    const opened = await geometry()
                    console.log(JSON.stringify({ theme, width, before, opened }))
                    expect(opened).toEqual(before)
                    if (i === 0)
                        await page.screenshot({
                            path:
                                "/srv/nezha-builder/qa-statistics-scroll-20261005/" +
                                theme +
                                "-" +
                                width +
                                "-open.png",
                        })
                    await page.keyboard.press("Escape")
                    await expect(menu).toHaveCount(0)
                    await expect(trigger).toBeFocused()
                    expect(await geometry()).toEqual(before)
                }
                await trigger.click()
                await expect(menu).toBeVisible()
                await trigger.click()
                await expect(menu).toHaveCount(0)
                expect(await geometry()).toEqual(before)
                await trigger.focus()
                await page.keyboard.press("Enter")
                await expect(menu).toBeVisible()
                expect(await geometry()).toEqual(before)
                await page.keyboard.press("Escape")
                await expect(menu).toHaveCount(0)
                await trigger.click()
                await expect(menu).toBeVisible()
                await page.mouse.move(width - 30, 800)
                await page.mouse.wheel(0, 180)
                await expect
                    .poll(() => page.evaluate(() => scrollY))
                    .toBeGreaterThan(before.scrollY)
                await page.keyboard.press("Escape")
                await expect(menu).toHaveCount(0)
                await trigger.scrollIntoViewIfNeeded()
                await trigger.click()
                await expect(menu).toBeVisible()
                await page.mouse.click(4, 100)
                await expect(menu).toHaveCount(0)
                expect(await page.locator("body").getAttribute("data-scroll-locked")).toBeNull()
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
            })
})
for (const theme of ["default", "doraemon"])
    for (const width of [320, 390, 1440])
        test(theme + " combined statistics toggle " + width, async ({ page }, info) => {
            await page.setViewportSize({ width, height: 850 })
            await mock(page, theme, true, false, 3, false)
            const trigger = page.getByRole("button", { name: "显示或收起统计" })
            await expect(trigger).toBeVisible()
            await trigger.click()
            await expect(page.getByRole("menu")).toHaveCount(0)
            await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(3)
            await expect(page.locator('[data-statistics-card="uptime"]')).toHaveCount(3)
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            await page.screenshot({ path: info.outputPath("combined-statistics.png") })
            await page.reload()
            await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(3)
            await expect(page.locator('[data-statistics-card="uptime"]')).toHaveCount(3)
            await trigger.click()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
            await page.reload()
            await expect(trigger).toBeVisible()
            await expect(page.locator("[data-statistics-view]")).toHaveCount(0)
        })
