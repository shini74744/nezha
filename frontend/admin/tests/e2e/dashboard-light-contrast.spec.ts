import { test, expect, Page, Locator } from "@playwright/test"
import fs from "node:fs"

const manifest = JSON.parse(fs.readFileSync(new URL("../../src/lib/dashboard-appearance-manifest.json", import.meta.url), "utf8"))
const imageURL = "https://fixture.invalid/dashboard-background.jpg"
// Opaque black is the worst case for the white safety surface. A real wallpaper may
// be supplied for screenshots; neither case contacts production or external APIs.
const blackPNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
async function setup(page: Page, mode: string | null = "light", variant = "normal") {
    const config = { version: 1, enabled: variant !== "disabled", features: Object.fromEntries(manifest.map((d: any) => [d.key, { ...d.defaults }])) }
    config.features.background.image = variant === "empty-image" ? "" : imageURL
    config.features.background.enabled = variant !== "background-off"
    config.features.font.enabled = false
    config.features.brand.enabled = false
    config.features.effects.enabled = false
    if (variant === "low-opacity")
        for (const key of ["lightBackgroundOpacity", "lightCardOpacity", "lightPopoverOpacity", "lightMutedOpacity"]) config.features.appearance[key] = 0
    if (variant === "appearance-off") config.features.appearance.enabled = false
    const writes: string[] = [], errors: string[] = []
    page.on("pageerror", e => errors.push(e.message))
    await page.addInitScript(mode => {
        if (mode) localStorage.setItem("nezha-dashboard-theme", mode)
        localStorage.setItem("language", "zh-CN")
    }, mode)
    await page.route("https://**/*", route => {
        if (route.request().url() === imageURL) {
            const file = process.env.E2E_DASHBOARD_BACKGROUND
            return route.fulfill({ contentType: file ? "image/jpeg" : "image/png", body: file ? fs.readFileSync(file) : blackPNG })
        }
        return route.abort()
    })
    await page.route("**/api/v1/**", route => {
        const path = new URL(route.request().url()).pathname
        if (route.request().method() !== "GET") writes.push(path)
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, role: 0, username: "contrast-test", login_ip: "192.0.2.1" }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN", site_name: "哪吒监控", dashboard_appearance_config: JSON.stringify(config) }, version: "contrast-test" }
        if (path === "/api/v1/server") data = Array.from({ length: 8 }, (_, i) => ({
            id: i + 1, name: i ? "香港备用节点 " + i : "主站服务器", uuid: "fixture-" + i, display_index: 20 - i,
            owner: { id: 1, username: "contrast-test" }, host: { version: "2.3.6" },
            geoip: { ip: { ipv4_addr: "192.0.2." + (i + 1), ipv6_addr: "2001:db8::" + (i + 1) } },
            enable_ddns: true, hide_for_guest: false,
        }))
        if (path === "/api/v1/ddns") data = [{ id: 7, name: "家庭服务器", provider: "cloudflare", domains: ["home.example.com"], enable_ipv4: true, enable_ipv6: true, max_retries: 3, notification_group_id: 0 }]
        if (path === "/api/v1/ddns/providers") data = ["cloudflare", "he", "dummy", "webhook", "tencentcloud"]
        if (path === "/api/v1/setting/dashboard-appearance") data = { config, custom_code: "", archived_code: "", revision: "fixture" }
        if (path === "/api/v1/waf/unknown-reports") data = { pagination: { total: 0 }, value: [] }
        if (path === "/api/v1/waf") data = { count: 1, value: [{ ip: "192.0.2.9", count: 2, block_reason: 1, block_identifier: "grpc", block_timestamp: 1791200000 }] }
        if (path === "/api/v1/waf/deleted-servers") data = { pagination: { total: 1 }, value: [{
            uuid: "00000000-0000-4000-8000-000000000001", name: "测试删除节点", original_id: 9,
            created_at: "2026-10-05T08:00:00Z", deleted_by_name: "test-admin", report_count: 3, last_report_at: Math.floor(Date.now() / 1000),
            block_version: 1, released_at: 0, cleanup_state: "disabled",
        }] }
        return route.fulfill({ json: { success: true, data } })
    })
    return { writes, errors }
}
// Composite ancestor backgrounds on an assumed wallpaper color, then compare
// the browser's actual text/border color. This tests colors, not screenshot OCR.
export async function contrast(locator: Locator, prop = "color", wallpaper = 0) {
    return locator.evaluate((el, { prop, wallpaper }) => {
        const parse = (s: string) => {
            const canvas = document.createElement("canvas")
            canvas.width = canvas.height = 1
            const ctx = canvas.getContext("2d")!
            ctx.fillStyle = s; ctx.fillRect(0, 0, 1, 1)
            return Array.from(ctx.getImageData(0, 0, 1, 1).data).map((n, i) => i === 3 ? n / 255 : n)
        }
        const over = (fg: number[], bg: number[]) => [0,1,2].map(i => fg[i]*fg[3]+bg[i]*(1-fg[3]))
        const nodes: Element[] = []
        for (let node: Element | null = el; node; node = node.parentElement) nodes.unshift(node)
        let bg = [wallpaper, wallpaper, wallpaper]
        for (const node of nodes) {
            // Body background-color is behind its image, so begin with the wallpaper.
            if (node === document.body || node === document.documentElement) continue
            bg = over(parse(getComputedStyle(node).backgroundColor), bg)
        }
        const style = getComputedStyle(el)
        const fg = parse(style.getPropertyValue(prop))
        fg[3] *= Number(style.opacity)
        const rendered = over(fg, bg)
        const lum = (rgb: number[]) => rgb.map(x => { x /= 255; return x <= .04045 ? x / 12.92 : ((x+.055)/1.055)**2.4 }).reduce((a,x,i) => a + x*[.2126,.7152,.0722][i],0)
        const a = lum(rendered), b = lum(bg)
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
    }, { prop, wallpaper })
}
for (const width of [390, 1920]) test("readable light server list, DDNS and settings " + width, async ({ page }, info) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 900 })
    const state = await setup(page)
    await page.goto("/dashboard")
    const rows = page.locator("table tbody tr")
    await expect(rows).toHaveCount(8)
    await expect(page.locator(".dashboard-page-surface")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.64)")
    for (const target of [page.getByRole("heading", { name: "服务器", exact: true }), rows.first().locator('[data-column="name"]'), page.locator('thead [data-column="name"]')])
        expect(await contrast(target)).toBeGreaterThanOrEqual(4.5)
    expect(await contrast(rows.first().getByRole("checkbox"), "border-top-color")).toBeGreaterThanOrEqual(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: info.outputPath("01-server.png") })
    await page.getByRole("checkbox", { name: "Select all", exact: true }).click()
    await expect(rows.first().getByRole("checkbox")).toBeChecked()
    await expect(rows.first()).toHaveAttribute("data-state", "selected")
    expect(await contrast(rows.first().locator('[data-column="name"]'))).toBeGreaterThanOrEqual(4.5)
    await page.goto("/dashboard/ddns")
    await expect(page.locator("[data-ddns-id='7']")).toBeVisible()
    expect(await contrast(page.locator(".ddns-retries"))).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({ path: info.outputPath("02-ddns.png") })
    await page.getByRole("button", { name: "编辑 DDNS", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    expect(await contrast(dialog.getByLabel("名称", { exact: true }))).toBeGreaterThanOrEqual(4.5)
    expect(await contrast(dialog.getByLabel("名称", { exact: true }), "border-top-color")).toBeGreaterThanOrEqual(3)
    await page.screenshot({ path: info.outputPath("03-ddns-dialog.png") })
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    await page.goto("/dashboard/settings/waf?tab=deleted")
    await expect(page.getByText("测试删除节点", { exact: false })).toBeVisible()
    expect(await contrast(page.getByText("UUID 已拉黑", { exact: true }))).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({ path: info.outputPath("04-deleted.png") })
    await page.goto("/dashboard/settings/dashboard-appearance")
    await expect(page.getByRole("heading", { name: "后台美化设置", exact: true })).toBeVisible()
    expect(await contrast(page.getByRole("heading", { name: "后台美化设置", exact: true }))).toBeGreaterThanOrEqual(4.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: info.outputPath("05-settings.png") })
    expect(state.writes).toEqual([])
    expect(state.errors).toEqual([])
})
test("switching light dark and system preserves geometry and dark opacity", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await setup(page)
    await page.goto("/dashboard")
    await expect(page.locator("tbody tr")).toHaveCount(8)
    const region = page.locator(".server-list-scroll"), before = await region.boundingBox()
    await page.getByRole("button", { name: "Toggle theme" }).click()
    await page.getByRole("menuitem", { name: "暗色", exact: true }).click()
    await expect(page.locator("html")).toHaveClass("dark")
    await expect(page.locator(".dashboard-page-surface")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    expect(await page.locator("html").evaluate(el => getComputedStyle(el).getPropertyValue("--background").trim())).toBe("0 0% 5% / 0.58")
    expect(await region.boundingBox()).toEqual(before)
    await page.emulateMedia({ colorScheme: "light" })
    await page.getByRole("button", { name: "Toggle theme" }).click()
    await page.getByRole("menuitem", { name: "跟随系统", exact: true }).click()
    await expect(page.locator(".dashboard-page-surface")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.64)")
    expect(await region.boundingBox()).toEqual(before)
})
for (const variant of ["disabled", "background-off", "empty-image", "low-opacity", "appearance-off"])
test("light contrast guard " + variant, async ({ page }) => {
    await setup(page, "light", variant)
    await page.goto("/dashboard")
    await expect(page.locator("tbody tr")).toHaveCount(8)
    const surface = page.locator(".dashboard-page-surface")
    const active = variant === "low-opacity" || variant === "appearance-off"
    await expect(surface).toHaveCSS("background-color", !active ? "rgba(0, 0, 0, 0)" : variant === "appearance-off" ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.64)")
    if (active) expect(await contrast(page.locator('thead [data-column="name"]'))).toBeGreaterThanOrEqual(4.5)
})

for (const width of [320, 390, 454]) test("mobile settings compact grid and visible wallpaper " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 })
    const state = await setup(page)
    await page.goto("/dashboard/settings")
    const nav = page.locator(".settings-navigation")
    const tabs = nav.getByRole("tab")
    await expect(tabs).toHaveCount(8)
    const boxes = await tabs.evaluateAll(els => els.map(el => {
        const { x, y, width, height } = el.getBoundingClientRect()
        return { x, y, width, height }
    }))
    expect(new Set(boxes.map(b => b.y)).size).toBe(4)
    for (let i = 0; i < 8; i += 2) {
        expect(boxes[i].y).toBe(boxes[i+1].y)
        expect(boxes[i].height).toBeGreaterThanOrEqual(44)
    }
    await expect(page.locator(".dashboard-page-surface")).toHaveCSS("backdrop-filter", "none")
    await expect(page.locator(".dashboard-page-surface")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.64)")
    const background = await page.locator("body").evaluate(el => {
        const s = getComputedStyle(el, "::before")
        return { position: s.position, image: s.backgroundImage, height: parseFloat(s.height), scrollHeight: el.scrollHeight }
    })
    expect(background.position).toBe("fixed")
    expect(background.image).toContain(imageURL)
    expect(background.height).toBe(850)
    expect(background.scrollHeight).toBeGreaterThan(background.height)
    for (const tab of await tabs.all()) expect(await contrast(tab)).toBeGreaterThanOrEqual(4.5)
    expect(await contrast(page.locator('form label').first())).toBeGreaterThanOrEqual(4.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: info.outputPath("settings-mobile.png") })
    await page.evaluate(() => scrollTo(0, 600))
    expect(await page.locator("body").evaluate(el => getComputedStyle(el,"::before").height)).toBe("850px")
    expect(state.writes).toEqual([])
    expect(state.errors).toEqual([])
})

test("dashboard and public theme storage are independent across reloads", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await setup(page, null, "disabled")
    await page.addInitScript(() => {
        if (!localStorage.getItem("vite-ui-theme")) localStorage.setItem("vite-ui-theme", "dark")
        if (!localStorage.getItem("doraemon-ui-theme")) localStorage.setItem("doraemon-ui-theme", "dark")
    })
    await page.goto("/dashboard")
    await expect(page.locator("tbody tr")).toHaveCount(8)
    await expect(page.locator("html")).toHaveClass("light")
    async function choose(label: string) {
        await page.getByRole("button", { name: "Toggle theme" }).click()
        await page.getByRole("menuitem", { name: label, exact: true }).click()
    }
    await choose("暗色")
    await expect(page.locator("html")).toHaveClass("dark")
    await choose("亮色")
    await expect(page.locator("html")).toHaveClass("light")
    expect(await page.evaluate(() => [localStorage.getItem("vite-ui-theme"), localStorage.getItem("doraemon-ui-theme")])).toEqual(["dark","dark"])
    await page.reload()
    await expect(page.locator("tbody tr")).toHaveCount(8)
    await expect(page.locator("html")).toHaveClass("light")
    await choose("暗色")
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "light"))
    await page.reload()
    await expect(page.locator("tbody tr")).toHaveCount(8)
    await expect(page.locator("html")).toHaveClass("dark")
    expect(await page.evaluate(() => localStorage.getItem("vite-ui-theme"))).toBe("light")
    await choose("跟随系统")
    await expect(page.locator("html")).toHaveClass("light")
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass("dark")
    expect(await page.evaluate(() => localStorage.getItem("vite-ui-theme"))).toBe("light")
})


for (const width of [320, 390, 1920]) test("firewall contextual help follows tabs " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 })
    const state = await setup(page)
    await page.goto("/dashboard/settings/waf?tab=unknown")
    await expect(page.getByText("暂无认证异常记录", { exact: false })).toBeVisible()
    const title = "认证防火墙说明"
    const help = page.getByRole("button", { name: title, exact: true })
    const tabs = page.getByRole("tablist", { name: "防火墙分类" })
    const a = (await tabs.boundingBox())!, b = (await help.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
    expect(b.x + b.width).toBeLessThanOrEqual(width)
    await expect(page.getByText(/记录已有\/未登记 UUID 认证失败/)).toHaveCount(0)
    if (width === 1920) {
        await help.hover()
        await expect(page.getByRole("dialog", { name: title })).toBeVisible()
        await page.mouse.move(0, 0)
        await expect(page.getByRole("dialog", { name: title })).toHaveCount(0)
    }
    await help.click()
    let popup = page.getByRole("dialog", { name: title })
    await expect(popup).toBeVisible()
    await expect(popup).toContainText("新 UUID 携带有效密钥正常注册，不计入异常")
    await expect(popup).not.toContainText("不要求再次上报")
    const box = (await popup.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(await contrast(popup.locator("p").last())).toBeGreaterThanOrEqual(4.5)
    await expect(popup).toHaveCSS("opacity", "1")
    await page.screenshot({ path: info.outputPath("auth-help.png") })
    await page.keyboard.press("Escape")
    await expect(popup).toHaveCount(0)
    await help.focus()
    await page.keyboard.press("Enter")
    await expect(popup).toBeVisible()
    await page.keyboard.press("Escape")
    await page.getByRole("tab", { name: "已删除服务器", exact: true }).click()
    await expect(page.getByRole("button", { name: title })).toHaveCount(0)
    const deletedHelp = page.getByRole("button", { name: "已删除服务器说明", exact: true })
    await deletedHelp.click()
    popup = page.getByRole("dialog", { name: "已删除服务器说明" })
    await expect(popup).toBeVisible()
    await expect(popup).toContainText("不要求再次上报")
    await expect(popup).not.toContainText("新 UUID 携带")
    await expect(popup).toHaveCSS("opacity", "1")
    await page.screenshot({ path: info.outputPath("deleted-help.png") })
    await page.getByRole("tab", { name: "Web 防火墙", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /防火墙说明|已删除服务器说明/ })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(state.writes).toEqual([])
    expect(state.errors).toEqual([])
})


test("touch help toggles and outside dismissal preserve the page width", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 850 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    try {
        const state = await setup(page)
        await page.goto((test.info().project.use.baseURL || "http://localhost:5173") + "/dashboard/settings/waf?tab=unknown")
        const help = page.getByRole("button", { name: "认证防火墙说明" })
        await expect(help).toBeVisible()
        const width = await page.evaluate(() => document.documentElement.clientWidth)
        await help.tap()
        const popup = page.getByRole("dialog", { name: "认证防火墙说明" })
        await expect(popup).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(width)
        await help.tap()
        await expect(popup).toHaveCount(0)
        await help.tap()
        await expect(popup).toBeVisible()
        await page.getByRole("tab", { name: "已删除服务器", exact: true }).tap()
        await expect(popup).toHaveCount(0)
        await page.getByRole("button", { name: "已删除服务器说明" }).tap()
        await expect(page.getByRole("dialog")).toContainText("不要求再次上报")
        expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(width)
        expect(state.writes).toEqual([])
        expect(state.errors).toEqual([])
    } finally {
        await context.close()
    }
})
