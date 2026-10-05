import { test, expect, Page, Locator } from "@playwright/test"
import fs from "node:fs"

// Headless Chromium normally hides classic scrollbars, masking this regression.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--disable-features=OverlayScrollbar,OverlayScrollbars"] } })
test.setTimeout(60000)
const manifest = JSON.parse(fs.readFileSync(new URL("../../src/lib/dashboard-appearance-manifest.json", import.meta.url), "utf8"))
const blackPNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const routes = [
    "", "/service", "/cron", "/server-expiry", "/alert-rule", "/ddns", "/nat",
    "/server-group", "/notification-group", "/notification", "/profile", "/transfer",
    "/settings", "/settings/user", "/settings/online-user", "/settings/waf",
    "/settings/waf?tab=unknown", "/settings/waf?tab=deleted", "/settings/api-tokens",
    "/settings/appearance", "/settings/dashboard-appearance", "/settings/icons",
]
async function setup(page: Page, theme = "light", beauty = true) {
    const errors: string[] = [], writes: string[] = [], covered: string[] = []
    const config = { version: 1, enabled: beauty, features: Object.fromEntries(manifest.map((x: any) => [x.key, { ...x.defaults }])) }
    for (const key of ["font", "effects", "brand"]) config.features[key].enabled = false
    config.features.background.image = "https://fixture.invalid/background.png"
    await page.addInitScript(theme => {
        localStorage.setItem("nezha-dashboard-theme", theme)
        localStorage.setItem("language", "zh-CN")
    }, theme)
    page.on("pageerror", e => errors.push(e.message))
    await page.route("https://**/*", r => r.request().url().startsWith("https://fixture.invalid/")
        ? r.fulfill({ contentType: "image/png", body: blackPNG }) : r.abort())
    await page.routeWebSocket(/\/api\/v1\/ws\//, () => { /* Isolated UI only: never connect to a node. */ })
    await page.route("**/api/v1/**", r => {
        const path = new URL(r.request().url()).pathname
        if (r.request().method() !== "GET" && path !== "/api/v1/cron/preview") writes.push(path)
        let data: any = []
        if (path === "/api/v1/cron/preview") data = { timezone: "Asia/Shanghai", next: ["2026-10-06T00:00:00+08:00"] }
        if (path === "/api/v1/profile") data = { id: 1, role: 0, username: "scroll-fixture" }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN", site_name: "滚动测试", user_template: "user-dist", cover: 1, ip_change_notification_group_id: 0, dashboard_appearance_config: JSON.stringify(config) }, frontend_templates: [], version: "fixture" }
        if (path === "/api/v1/server") data = Array.from({ length: 30 }, (_, i) => ({
            id: i + 1, name: "测试节点 " + i, uuid: "fixture-" + i,
            owner: { id: 1, username: "fixture" }, host: { version: "2.3.6" },
            geoip: { ip: { ipv4_addr: "192.0.2." + (i + 1) } }, enable_ddns: false, hide_for_guest: false,
        }))
        if (path === "/api/v1/ddns") data = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: "测试解析 " + i, provider: "cloudflare", domains: ["node" + i + ".example.com"], enable_ipv4: true, enable_ipv6: true, max_retries: 3, notification_group_id: 0 }))
        if (path === "/api/v1/ddns/providers") data = ["cloudflare", "he", "dummy", "webhook", "tencentcloud"]
        if (path === "/api/v1/server-expiry") data = { config: { enabled: false, notification_group_id: 0, days: [7, 3, 1, 0] }, servers: [] }
        if (path.includes("/setting/") && path.includes("appearance")) data = { config: path.endsWith("dashboard-appearance") ? config : {}, revision: "fixture", custom_code: "", archived_code: "", current_template: "user-dist" }
        if (["/api/v1/online-user", "/api/v1/server/operations", "/api/v1/waf", "/api/v1/waf/unknown-reports", "/api/v1/waf/deleted-servers"].includes(path)) data = { pagination: { total: 0 }, value: [] }
        if (path === "/api/v1/waf/deleted-servers") data = { pagination: { total: 1 }, value: [{
            uuid: "00000000-0000-4000-8000-000000000001", name: "测试删除节点", original_id: 9,
            created_at: "2026-10-05T08:00:00Z", deleted_by_name: "fixture", report_count: 3,
            last_report_at: Math.floor(Date.now() / 1000), block_version: 1, released_at: 0, cleanup_state: "disabled", owner_id: 1,
        }] }
        return r.fulfill({ json: { success: true, data } })
    })
    return { errors, writes, covered }
}
async function prepare(page: Page, route: string, tall = true) {
    await page.goto("/dashboard" + route)
    await expect(page.locator("header")).toBeVisible()
    await expect(page.getByRole("button", { name: "Toggle theme" })).toBeVisible()
    await page.waitForTimeout(150)
    await expect(page.getByRole("heading", { name: "Oops!" })).toHaveCount(0)
    // Force a long page even for empty fixture lists. Fixed probes catch viewport
    // changes which body margin compensation alone can conceal.
    await page.evaluate(tall => {
        if (tall) {
            const spacer = document.createElement("div")
            spacer.style.height = "1200px"; spacer.dataset.testSpacer = ""
            document.getElementById("root")!.append(spacer)
        }
        const probe = document.createElement("div")
        probe.id = "scroll-viewport-probe"
        probe.style.cssText = "position:fixed;inset:0;pointer-events:none;visibility:hidden"
        document.body.append(probe)
    }, tall)
}
async function geometry(page: Page) {
    return page.evaluate(() => {
        const box = (s: string) => {
            const r = document.querySelector(s)?.getBoundingClientRect()
            return r ? [r.x, r.width] : null
        }
        return { body: box("body"), root: box("#root"), header: box("header"), content: box(".dashboard-content"), fixed: box("#scroll-viewport-probe") }
    })
}
async function unlocked(page: Page) {
    await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked")
    await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none")
}
async function stable(page: Page, before: Awaited<ReturnType<typeof geometry>>) {
    expect(await geometry(page)).toEqual(before)
}
async function closeOverlay(page: Page, type: string) {
    if (type === "drawer") await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click()
    else {
        const close = page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })
        if (await close.count()) await close.click()
        else await page.keyboard.press("Escape")
    }
    await expect(page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible, [role="listbox"]:visible, [role="menu"]:visible')).toHaveCount(0)
    await unlocked(page)
}
async function roundTrip(page: Page, trigger: Locator, label: string, covered: string[]) {
    await trigger.scrollIntoViewIfNeeded()
    const before = await geometry(page)
    await trigger.click()
    const popup = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible, [role="listbox"]:visible, [role="menu"]:visible').last()
    await expect(popup, label).toBeVisible()
    await stable(page, before)
    const role = await popup.getAttribute("role")
    if (role === "menu") await unlocked(page)
    else if (await page.locator("body").getAttribute("data-scroll-locked")) {
        await expect(page.locator("body")).toHaveCSS("overflow", "hidden")
        const y = await page.evaluate(() => scrollY)
        await page.mouse.move(1, 100)
        await page.mouse.wheel(0, 350)
        await page.waitForTimeout(50)
        expect(await page.evaluate(() => scrollY)).toBe(y)
    }
    // Select inside a modal must not add a second scrollbar-width margin.
    if (role === "dialog" || role === "alertdialog") {
        const nested = popup.locator('button[role="combobox"]:visible:not([disabled])').first()
        if (await nested.count()) {
            await nested.click()
            await expect(page.getByRole("listbox")).toBeVisible()
            await stable(page, before)
            await page.keyboard.press("Escape")
            await expect(page.getByRole("listbox")).toHaveCount(0)
            await expect(popup).toBeVisible()
            await stable(page, before)
            covered.push(label + " / nested select")
        }
        if (await page.locator("body").getAttribute("data-scroll-locked")) {
            // Some custom confirmation forms choose no initial focus. Verify
            // the existing focus trap starting from an explicit in-dialog focus.
            const focusable = popup.locator("button:not([disabled]), input:not([disabled])").first()
            if (await focusable.count()) await focusable.focus()
            else await popup.focus()
            for (let i = 0; i < 3; i++) {
                await page.keyboard.press("Tab")
                expect(await popup.evaluate(el => el.contains(document.activeElement))).toBe(true)
            }
        }
    }
    await closeOverlay(page, "other")
    await stable(page, before)
    covered.push(label)
}
for (const theme of ["light", "dark"]) for (const route of routes) {
    test("stable admin overlays " + theme + " " + (route || "/servers"), async ({ page }, info) => {
        test.setTimeout(90000)
        await page.setViewportSize({ width: 1366, height: 850 })
        const state = await setup(page, theme)
        await prepare(page, route)
        await roundTrip(page, page.getByRole("button", { name: "Toggle theme" }), "theme menu", state.covered)
        // Deduplicate repeated row actions; exercise every distinct top-level
        // Radix menu/dialog/select trigger on this page without submitting it.
        const selector = '[aria-haspopup="dialog"],[aria-haspopup="listbox"],[aria-haspopup="menu"]'
        const candidates = page.locator(selector)
        const indices = await candidates.evaluateAll(nodes => {
            const seen = new Set<string>()
            return nodes.flatMap((n, i) => {
                if (!(n instanceof HTMLElement) || !n.offsetWidth || n.hasAttribute("disabled") || n.getAttribute("aria-label") === "Toggle theme") return []
                const key = [n.getAttribute("aria-haspopup"), n.getAttribute("aria-label"), n.textContent, ...Array.from(n.querySelectorAll("svg")).map(s => s.getAttribute("class"))].join("|")
                if (seen.has(key)) return []
                seen.add(key); return [i]
            })
        })
        for (const i of indices) {
            const trigger = candidates.nth(i)
            if (!(await trigger.isVisible()) || !(await trigger.isEnabled())) continue
            const label = await trigger.evaluate(el => el.getAttribute("aria-label") || el.textContent?.trim() || el.querySelector("svg")?.getAttribute("class") || "trigger")
            await roundTrip(page, trigger, label, state.covered)
        }
        await info.attach("overlay-coverage", { body: JSON.stringify(state, null, 2), contentType: "application/json" })
        expect(state.errors).toEqual([])
        expect(state.writes).toEqual([])
    })
}
for (const width of [320, 390, 767]) for (const theme of ["light", "dark"]) {
    test("mobile drawer and nested modal " + width + " " + theme, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 850 })
        const state = await setup(page, theme)
        await prepare(page, "")
        const before = await geometry(page)
        for (let i = 0; i < 3; i++) {
            await page.getByRole("button", { name: "Toggle Menu" }).click()
            await expect(page.getByRole("dialog")).toBeVisible()
            await stable(page, before)
            await closeOverlay(page, "drawer")
            await stable(page, before)
        }
        await page.getByRole("button", { name: "Toggle Menu" }).click()
        await page.getByRole("dialog").getByRole("link", { name: "动态域名解析", exact: true }).click()
        await expect(page).toHaveURL(/\/dashboard\/ddns$/)
        await unlocked(page)
        await roundTrip(page, page.getByRole("button", { name: "编辑 DDNS", exact: true }).first(), "mobile DDNS dialog", state.covered)
        await page.screenshot({ path: info.outputPath("mobile-restored.png") })
        expect(state.errors).toEqual([])
        expect(state.writes).toEqual([])
    })
}
for (const beauty of [false, true]) for (const tall of [false, true]) {
    test("short/long page repeated lock " + beauty + " " + tall, async ({ page }) => {
        const state = await setup(page, "light", beauty)
        await prepare(page, "/settings", tall)
        const trigger = page.getByRole("combobox").first()
        for (let i = 0; i < 5; i++) await roundTrip(page, trigger, "language", state.covered)
        await prepare(page, "/ddns", tall)
        for (let i = 0; i < 3; i++) {
            await roundTrip(page, page.getByRole("button", { name: "编辑 DDNS", exact: true }).first(), "edit", state.covered)
            await roundTrip(page, page.getByRole("button", { name: "删除 DDNS", exact: true }).first(), "delete confirmation", state.covered)
        }
        expect(state.errors).toEqual([])
        expect(state.writes).toEqual([])
    })
}

for (const width of [390, 1366]) test("additional controlled dialogs and terminal " + width, async ({ page }) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 850 })
    const state = await setup(page)
    await prepare(page, "/settings/api-tokens", false)
    await roundTrip(page, page.getByRole("button", { name: /创建.*令牌/ }), "create API token", state.covered)
    await prepare(page, "/settings/icons")
    await roundTrip(page, page.getByRole("button", { name: "添加厂商", exact: true }), "add provider icon", state.covered)
    await roundTrip(page, page.getByRole("button", { name: "新建分组", exact: true }), "add icon group", state.covered)
    // Only these two mocked session endpoints are permitted in this terminal test.
    await page.route("**/api/v1/terminal", r => r.fulfill({ json: { success: true, data: { session_id: "fixture-terminal" } } }))
    await page.route("**/api/v1/file?*", r => r.fulfill({ json: { success: true, data: { session_id: "fixture-file" } } }))
    await prepare(page, "/terminal/1", false)
    await expect(page.locator(".terminal-shell")).toBeVisible()
    const before = await geometry(page)
    const toggle = page.getByRole("button", { name: "快捷命令", exact: true }).first()
    for (let i = 0; i < 4; i++) {
        if (width < 1024 && await page.getByRole("button", { name: "收起快捷命令栏", exact: true }).isVisible())
            await page.getByRole("button", { name: "收起快捷命令栏", exact: true }).click()
        else await toggle.click()
        await stable(page, before)
        await unlocked(page)
    }
    const panelClose = page.getByRole("button", { name: "收起快捷命令栏", exact: true })
    if (await panelClose.isVisible()) await panelClose.click()
    await page.locator("button").filter({ has: page.locator("svg.lucide-folder-closed") }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await stable(page, before)
    if (width >= 640) await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).locator("svg").click()
    else await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await unlocked(page)
    await stable(page, before)
    expect(state.errors).toEqual([])
    expect(state.writes).toEqual([])
})
test("menu keyboard, outside dismissal and frame-level geometry", async ({ page }) => {
    const state = await setup(page)
    await prepare(page, "")
    const before = await geometry(page)
    await page.evaluate(() => {
        const frames: number[][] = []
        ;(window as any).scrollFrames = frames
        ;(window as any).sampleScrollFrames = true
        const sample = () => {
            frames.push([document.body.getBoundingClientRect().width, document.querySelector("#scroll-viewport-probe")!.getBoundingClientRect().width])
            if ((window as any).sampleScrollFrames) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
    })
    const theme = page.getByRole("button", { name: "Toggle theme" })
    await theme.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("menu")).toBeVisible()
    await unlocked(page)
    await page.keyboard.press("End")
    await page.keyboard.press("Escape")
    await expect(theme).toBeFocused()
    await theme.click()
    await page.mouse.click(5, 300)
    await expect(page.getByRole("menu")).toHaveCount(0)
    const install = page.getByRole("button", { name: "安装命令", exact: true }).first()
    await install.click()
    const scrollbar = await page.evaluate(() => innerWidth - document.documentElement.clientWidth)
    expect(scrollbar).toBeGreaterThan(0)
    await page.mouse.move(5, 300)
    await page.mouse.wheel(0, 250)
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
    await page.keyboard.press("Escape")
    await unlocked(page)
    const frames = await page.evaluate(() => { (window as any).sampleScrollFrames = false; return (window as any).scrollFrames as number[][] })
    expect(frames.length).toBeGreaterThan(3)
    for (const frame of frames) expect(frame).toEqual([before.body![1], before.fixed![1]])
    expect(state.errors).toEqual([])
    expect(state.writes).toEqual([])
})

test("bulk server dialogs never dispatch operations", async ({ page }) => {
    const state = await setup(page)
    await prepare(page, "")
    await page.getByRole("checkbox", { name: "Select all", exact: true }).click()
    await roundTrip(page, page.getByRole("button", { name: "批量设置", exact: true }), "bulk visibility", state.covered)
    const triggers = page.locator('button[aria-haspopup="dialog"]')
    const indices = await triggers.evaluateAll(nodes => nodes.flatMap((n, i) => {
        const table = document.querySelector("tbody")!
        return (n.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) && !n.hasAttribute("disabled") ? [i] : []
    }))
    for (const i of indices) await roundTrip(page, triggers.nth(i), "server toolbar " + i, state.covered)
    expect(state.writes).toEqual([])
    expect(state.errors).toEqual([])
})
test.describe("touchscreen", () => {
    test.use({ viewport: { width: 390, height: 850 }, isMobile: true, hasTouch: true })
    test("touch menu and drawer keep geometry and release scroll lock", async ({ page }) => {
        const state = await setup(page)
        await prepare(page, "")
        const before = await geometry(page)
        await page.getByRole("button", { name: "Toggle theme" }).tap()
        await expect(page.getByRole("menu")).toBeVisible()
        await unlocked(page)
        await stable(page, before)
        await page.getByRole("heading", { name: "服务器", exact: true }).tap()
        await expect(page.getByRole("menu")).toHaveCount(0)
        await page.getByRole("button", { name: "Toggle Menu" }).tap()
        await expect(page.getByRole("dialog")).toBeVisible()
        await stable(page, before)
        await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).tap()
        await expect(page.getByRole("dialog")).toHaveCount(0)
        await unlocked(page)
        await stable(page, before)
        expect(state.errors).toEqual([])
        expect(state.writes).toEqual([])
    })
})
