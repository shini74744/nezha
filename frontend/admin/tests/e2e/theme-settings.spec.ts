import { expect, test, Page } from "@playwright/test"
const templates = [
    { path: "admin-dist", name: "OfficialAdmin", is_admin: true, is_official: true },
    { path: "user-dist", name: "Official", is_official: true },
    { path: "nezha-pixel-dist", name: "Nezha-Pixel" },
    { path: "nazhua-dist", name: "Nazhua" },
    { path: "aobobo-dist", name: "Aobobo" },
    { path: "nezha-ascii-dist", name: "Nezha-ASCII" },
    { path: "doraemon-dist", name: "哆啦 A 梦" },
].map(t => ({ ...t, author: "fixture", repository: "https://example.com/theme", version: "test" }))
async function setup(page: Page, loggedIn: boolean, userTemplate = "user-dist") {
    await page.addInitScript(() => localStorage.setItem("language", "zh-CN"))
    let admin = loggedIn
    await page.route("**/api/v1/**", async route => {
        const path = new URL(route.request().url()).pathname
        if (path === "/api/v1/login") { admin = true; return route.fulfill({ json: { success: true, data: {} } }) }
        if (path === "/api/v1/profile") return route.fulfill({ json: admin ? { success: true, data: { id: 1, role: 0, username: "admin" } } : { success: false, error: "Unauthorized" } })
        const config = { site_name: "主题测试", language: "zh-CN", ...(admin ? { user_template: userTemplate, cover: 1, ip_change_notification_group_id: 0 } : {}) }
        const data = path === "/api/v1/setting" ? { config, ...(admin ? { frontend_templates: templates } : {}) } : []
        await route.fulfill({ json: { success: true, data } })
    })
}
async function expectThemes(page: Page) {
    const select = page.getByRole("combobox", { name: "主题", exact: true })
    await expect(select).toContainText("Official")
    await select.click()
    await expect(page.getByRole("option")).toHaveCount(6)
    await expect(page.getByRole("option").last()).toContainText("哆啦 A 梦")
    for (const name of ["Official", "Nezha-Pixel", "Nazhua", "Aobobo", "Nezha-ASCII", "哆啦 A 梦"]) await expect(page.getByRole("option", { name: new RegExp(name) })).toBeVisible()
    await page.keyboard.press("Escape")
}
test("all bundled themes remain selectable on an authenticated settings page", async ({ page }) => {
    await setup(page, true)
    await page.goto("/dashboard/settings")
    await expectThemes(page)
})
test("login refreshes guest settings before displaying the theme selector", async ({ page }) => {
    await setup(page, false)
    await page.goto("/dashboard/login")
    await page.locator('input[name="username"]').fill("admin")
    await page.locator('input[name="password"]').fill("admin")
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.locator('header [aria-haspopup="menu"]').last().click()
    await page.getByRole("menuitem", { name: "系统设置", exact: true }).click()
    await expectThemes(page)
})


test("missing current template defaults to a real template path, not array index", async ({ page }) => {
    await setup(page, true, "")
    await page.goto("/dashboard/settings")
    await expectThemes(page)
    await expect(page.getByText("正在使用社区主题", { exact: true })).toHaveCount(0)
})

test("Doraemon is the last theme and persists a selectable real path", async ({ page }) => {
    await setup(page, true)
    let saved: any
    await page.route("**/api/v1/setting", async (route, request) => {
        if (request.method() !== "PATCH") return route.fallback()
        saved = request.postDataJSON()
        await route.fulfill({ json: { success: true, data: {} } })
    })
    await page.goto("/dashboard/settings")
    await page.getByRole("combobox", { name: "主题", exact: true }).click()
    await expect(page.getByRole("option").last()).toContainText("哆啦 A 梦")
    await page.getByRole("option", { name: /哆啦 A 梦/ }).click()
    await expect(page.getByRole("combobox", { name: "主题", exact: true })).toContainText("哆啦 A 梦")
    await page.locator('button[type="submit"]').click()
    await expect.poll(() => saved?.user_template).toBe("doraemon-dist")
})
