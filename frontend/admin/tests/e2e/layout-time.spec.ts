import { Page, expect, test } from "@playwright/test"

async function mockDashboard(page: Page, beauty: any = undefined, count = 2) {
    await page.addInitScript(() => localStorage.setItem("language", "zh-CN"))
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        const rows = [
            {
                id: 63,
                name: "主站服务器",
                display_index: 20001,
                uuid: "fixture-63",
                owner: { id: 1, username: "adminUiopmnb11/2/s/i/+.hy" },
                geoip: { ip: { ipv4_addr: "85.149.219.219", ipv6_addr: "2602:fa02:33:103::a" } },
                host: { version: "2.3.5" },
                enable_ddns: false,
                hide_for_guest: false,
            },
            {
                id: 47,
                name: "HK.监控主机",
                display_index: 20000,
                uuid: "fixture-47",
                owner: { id: 1, username: "adminUiopmnb11/2/s/i/+.hy" },
                geoip: {
                    ip: {
                        ipv4_addr: "47.82.76.213",
                        ipv6_addr: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
                    },
                },
                host: { version: "2.3.5" },
                enable_ddns: true,
                hide_for_guest: true,
            },
        ]
        let data: unknown = []
        if (path === "/api/v1/profile")
            data = { id: 1, username: "adminUiopmnb11/2/s/i/+.hy", role: 0 }
        if (path === "/api/v1/setting")
            data = {
                config: {
                    site_name: "哪吒监控",
                    language: "zh-CN",
                    dashboard_appearance_config: beauty ? JSON.stringify(beauty) : "",
                },
                version: "layout-test",
            }
        if (path === "/api/v1/server")
            data =
                count === 2
                    ? rows
                    : Array.from({ length: count }, (_, i) => ({
                          ...rows[i % 2],
                          id: 100 + i,
                          uuid: "mobile-" + i,
                      }))
        if (path === "/api/v1/service/list")
            data = [{ id: 1, name: "重庆电信", target: "cq-ct-v4.ip.zstaticcdn.com:80", cover: 0, skip_servers: {}, type: 1, duration: 30, notification_group_id: 0, enable_trigger_task: false, fail_trigger_tasks: [], recover_trigger_tasks: [] }]
        if (path === "/api/v1/server-group")
            data = [{ group: { id: 1, name: "测试组" }, servers: [63, 47] }]
        if (path === "/api/v1/online-user")
            data = {
                count: 1,
                value: [
                    { ip: "127.0.0.1", user_id: 1, connected_at: "2026-09-25T14:06:52.049Z" },
                    { ip: "127.0.0.2", user_id: 1, connected_at: "invalid" },
                ],
            }
        await route.fulfill({ json: { success: true, data } })
    })
}

test("server page and header fill the viewport with matching side margins", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await mockDashboard(page)
    await page.goto("/dashboard")
    const table = page.locator("table")
    await expect(table.locator("tbody tr")).toHaveCount(2)
    const box = (await table.boundingBox())!,
        nav = (await page.locator("header > nav").boundingBox())!
    expect(box.width).toBeGreaterThan(1800)
    expect(box.x).toBeGreaterThanOrEqual(32)
    expect(box.x).toBeLessThanOrEqual(48)
    expect(Math.abs(box.x - nav.x - 13)).toBeLessThan(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        1920,
    )
    await page.screenshot({
        path: "test-results/server-wide-desktop.png",
    })
})

for (const [zone, expected] of [
    ["Asia/Shanghai", "2026-09-25 22:06:52"],
    ["America/New_York", "2026-09-25 10:06:52"],
    ["UTC", "2026-09-25 14:06:52"],
]) {
    test(`online-user local time ${zone}`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({
            timezoneId: zone,
            baseURL: testInfo.project.use.baseURL,
        })
        const page = await context.newPage()
        await mockDashboard(page)
        await page.goto("/dashboard/settings/online-user")
        await expect(page.locator("time")).toHaveText(expected)
        await expect(page.locator("time")).toHaveAttribute("datetime", "2026-09-25T14:06:52.049Z")
        await expect(page.locator("tbody tr").nth(1)).toContainText("-")
        await expect(page.locator("body")).not.toContainText("Invalid DateTime")
        await page.screenshot({ path: testInfo.outputPath("time.png"), fullPage: true })
        await context.close()
    })
}

test("compact buttons preserve dialogs, selection, and sorting", async ({ page }) => {
    await mockDashboard(page)
    await page.goto("/dashboard")
    const rows = page.locator("table tbody tr")
    await expect(rows).toHaveCount(2)
    await page.getByRole("checkbox", { name: "Select all", exact: true }).click()
    for (const row of await rows.all()) await expect(row.getByRole("checkbox")).toBeChecked()
    await rows.first().locator("td").last().locator("button").last().click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await page.getByRole("alertdialog").getByRole("button", { name: "关闭", exact: true }).click()
    await expect(rows).toHaveCount(2)
    await page.getByRole("button", { name: "服务器排序", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(
        page.getByRole("button", { name: "按当前排序重新分配系统 ID", exact: true }),
    ).toBeVisible()
    const sortRows = page.getByRole("dialog").locator("[draggable=true]")
    await sortRows.nth(1).dragTo(sortRows.nth(0), { targetPosition: { x: 40, y: 4 } })
    await expect(sortRows.first()).toContainText("HK.监控主机")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).not.toBeVisible()
})

for (const [width, beautify] of [
    [320, false],
    [390, true],
    [768, true],
    [844, true],
] as const) {
    test(
        "mobile server table scrolls internally at " + width + " beauty=" + beautify,
        async ({ page }) => {
            await page.setViewportSize({ width, height: 844 })
            const manifest = (
                await import("../../src/lib/dashboard-appearance-manifest.json", {
                    with: { type: "json" },
                })
            ).default
            const beauty = {
                version: 1,
                enabled: true,
                features: Object.fromEntries(manifest.map((d) => [d.key, { ...d.defaults }])),
            }
            beauty.features.font.cssUrl = ""
            beauty.features.brand.logo = ""
            beauty.features.brand.avatar = ""
            beauty.features.background.image = ""
            beauty.features.effects.clickEffect = false
            await page.addInitScript(() => localStorage.setItem("vite-ui-theme", "dark"))
            await mockDashboard(page, beautify ? beauty : undefined, 12)
            await page.goto("/dashboard")
            const rows = page.locator("table tbody tr")
            await expect(rows).toHaveCount(12)
            await page.screenshot({
                path: "test-results/mobile-server-" + width + ".png",
            })
            const table = page.locator("table"),
                region = page.getByRole("region", { name: "服务器列表，可左右滑动" })
            await expect(region).toBeVisible()
            expect((await table.boundingBox())!.width).toBeGreaterThanOrEqual(1400)
            expect((await rows.first().boundingBox())!.height).toBeLessThan(220)
            expect(
                (await rows.first().locator("td").nth(5).boundingBox())!.width,
            ).toBeGreaterThanOrEqual(220)
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(width)
            expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
            if (beautify)
                expect(
                    await page.evaluate(() => document.body.getBoundingClientRect().height),
                ).toBeGreaterThan(844)
            await page.getByRole("checkbox", { name: "Select all", exact: true }).click()
            await expect(rows.first().getByRole("checkbox")).toBeChecked()
            await region.evaluate((el) => (el.scrollLeft = el.scrollWidth))
            const button = rows.first().locator("td").last().locator("button").last()
            await button.click()
            await expect(page.getByRole("alertdialog")).toBeVisible()
            await page
                .getByRole("alertdialog")
                .getByRole("button", { name: "关闭", exact: true })
                .click()
            await expect(rows).toHaveCount(12)
            await page.screenshot({
                path:
                    "test-results/mobile-server-actions-" +
                    width +
                    ".png",
            })
        },
    )
}

for (const width of [1366, 1920]) {
    test("every dashboard route shares the same desktop gutter at " + width, async ({ page }) => {
        test.setTimeout(120_000)
        await page.setViewportSize({ width, height: 900 })
        await mockDashboard(page)
        for (const route of ["", "/service", "/cron", "/notification", "/ddns", "/nat", "/server-group", "/notification-group", "/alert-rule", "/transfer", "/settings", "/settings/user", "/settings/online-user", "/settings/waf", "/settings/api-tokens"]) {
            await page.goto("/dashboard" + route, { waitUntil: "domcontentloaded" })
            const shell = page.locator(".dashboard-content")
            await expect(shell).toBeVisible()
            await expect(shell.locator(":scope > div").first()).toBeVisible()
            const content = (await shell.boundingBox())!
            const nav = (await page.locator("header > nav").boundingBox())!
            const child = (await shell.locator(":scope > div").first().boundingBox())!
            expect(Math.abs(content.x - nav.x), route).toBeLessThan(1)
            expect(Math.abs(content.width - nav.width), route).toBeLessThan(1)
            expect(Math.abs(child.width - content.width), route).toBeLessThan(1)
            expect(content.x, route).toBeGreaterThanOrEqual(25)
            expect(content.x, route).toBeLessThanOrEqual(33)
            expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(width)
            if (route === "/service") await page.screenshot({ path: "test-results/service-gutters-" + width + ".png" })
        }
    })
}
