import { Page, expect, test } from "@playwright/test"
import fs from "node:fs"

const base = "/dashboard/settings"
const tabs = [
    ["美化设置", "/appearance"],
    ["后台美化设置", "/dashboard-appearance"],
    ["图标设置", "/icons"],
    ["用户", "/user"],
    ["在线用户", "/online-user"],
    ["防火墙", "/waf"],
    ["API 令牌", "/api-tokens"],
    ["系统设置", ""],
] as const
const defaults = (file: string) => ({
    version: 1,
    enabled: false,
    features: Object.fromEntries(
        JSON.parse(fs.readFileSync(new URL("../../src/lib/" + file, import.meta.url), "utf8")).map(
            (d: any) => [d.key, { ...d.defaults }],
        ),
    ),
})
export async function mockSettings(page: Page, beauty = false, role = 0) {
    const dashboard = defaults("dashboard-appearance-manifest.json")
    dashboard.enabled = beauty
    dashboard.features.font.enabled = false
    dashboard.features.brand.enabled = false
    dashboard.features.background.image = ""
    dashboard.features.effects.enabled = false
    const writes: string[] = []
    await page.addInitScript(() => localStorage.setItem("vite-ui-theme", "dark"))
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        if (route.request().method() !== "GET") writes.push(path)
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "layout-test", role }
        if (path === "/api/v1/setting")
            data = {
                config: {
                    site_name: "哪吒云监控",
                    language: "zh-CN",
                    cover: 1,
                    ip_change_notification_group_id: 0,
                    user_template: "user-dist",
                    dashboard_appearance_config: JSON.stringify(dashboard),
                },
                version: "test",
                frontend_templates: [],
            }
        if (path === "/api/v1/setting/appearance")
            data = {
                config: defaults("appearance-manifest.json"),
                custom_code: "",
                revision: "test",
                current_template: "user-dist",
            }
        if (path === "/api/v1/setting/dashboard-appearance")
            data = { config: dashboard, custom_code: "", archived_code: "", revision: "test" }
        if (path === "/api/v1/setting/display")
            data = { statistics_split: true, detail_network_split: true }
        if (path === "/api/v1/online-user") data = { count: 0, value: [] }
        if (path === "/api/v1/waf") data = { count: 0, value: [] }
        await route.fulfill({ json: { success: true, data } })
    })
    return writes
}

for (const width of [320, 390, 768, 1872])
    for (const beauty of [false, true]) {
        test(
            "shared settings navigation remains stable " + width + " beauty=" + beauty,
            async ({ page }, info) => {
                test.setTimeout(90000)
                await page.setViewportSize({ width, height: 900 })
                const errors: string[] = []
                page.on("pageerror", (e) => errors.push(e.message))
                const writes = await mockSettings(page, beauty)
                await page.goto(base + "/appearance")
                const nav = page.locator(".settings-navigation")
                await expect(nav.getByRole("tab")).toHaveCount(8)
                const original = await nav.elementHandle()
                const documentY = await nav.evaluate(
                    (el) => el.getBoundingClientRect().top + scrollY,
                )
                await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 68)), documentY)
                const baseline = (await nav.boundingBox())!
                const initialScroll = await page.evaluate(() => scrollY)
                for (const [name, path] of tabs) {
                    await nav.getByRole("tab", { name, exact: true }).click()
                    await expect(page).toHaveURL(base + path)
                    await expect(nav.getByRole("tab", { name, exact: true })).toHaveAttribute(
                        "aria-selected",
                        "true",
                    )
                    await expect.poll(() => page.evaluate(() => scrollY)).toBe(initialScroll)
                    const box = (await nav.boundingBox())!
                    expect(box).toEqual(baseline)
                    expect(
                        await original!.evaluate(
                            (el) => el === document.querySelector(".settings-navigation"),
                        ),
                    ).toBe(true)
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth),
                    ).toBeLessThanOrEqual(width)
                    if (["/appearance", "/dashboard-appearance", "/icons"].includes(path)) {
                        await page.screenshot({ path: info.outputPath(name + ".png") })
                    }
                }
                await page.goBack()
                await expect(
                    nav.getByRole("tab", { name: "API 令牌", exact: true }),
                ).toHaveAttribute("aria-selected", "true")
                await page.goForward()
                await expect(
                    nav.getByRole("tab", { name: "系统设置", exact: true }),
                ).toHaveAttribute("aria-selected", "true")
                expect(writes).toEqual([])
                expect(errors).toEqual([])
                if (width === 1872 && beauty) {
                    await nav.getByRole("tab", { name: "美化设置", exact: true }).click()
                    await page.screenshot({
                        path: "test-results/settings-reference-nav.png",
                        clip: { x: 0, y: 0, width: 1872, height: 183 },
                    })
                }
            },
        )
    }

test("settings direct link, trailing slash, keyboard and non-admin selection", async ({ page }) => {
    await mockSettings(page)
    await page.goto(base + "/")
    const nav = page.locator(".settings-navigation")
    await expect(nav.getByRole("tab", { name: "系统设置", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
    )
    await nav.getByRole("tab", { name: "系统设置", exact: true }).focus()
    await page.keyboard.press("ArrowRight")
    await expect(nav.getByRole("tab", { name: "用户", exact: true })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(base + "/user")
    await page.unroute("**/api/v1/**")
    await mockSettings(page, false, 1)
    await page.goto(base + "/appearance")
    await expect(page).toHaveURL(base + "/api-tokens")
    await expect(nav.getByRole("tab")).toHaveCount(1)
    await expect(nav.getByRole("tab")).toHaveAttribute("aria-selected", "true")
})
