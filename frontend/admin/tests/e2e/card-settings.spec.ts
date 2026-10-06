import { Page, expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"

const catalog = JSON.parse(
    readFileSync(new URL("../../../../service/connectivity/catalog.json", import.meta.url), "utf8"),
)
const defaults = catalog.map((row: any) => ({
    id: row.id,
    name: row.name,
    group: row.group,
    url: row.url,
    icon: row.id,
    enabled: true,
}))
async function setup(page: Page, role = 0, theme = "light") {
    const state = {
        items: structuredClone(defaults),
        revision: "r1",
        writes: 0,
        conflict: false,
        reads: 0,
        iconFetches: 0,
        iconStores: 0,
        iconError: false,
        iconDelay: 0,
    }
    await page.addInitScript((theme) => {
        localStorage.setItem("nezha-dashboard-theme", theme)
        localStorage.setItem("language", "zh-CN")
    }, theme)
    await page
        .context()
        .addCookies([{ name: "nz-csrf", value: "mock-token", url: "http://127.0.0.1:18479" }])
    await page.routeWebSocket(/\/api\/v1\/ws\//, () => {})
    await page.route("https://**/*", (route) => route.abort())
    await page.route("**/api/v1/**", async (route) => {
        const request = route.request(),
            path = new URL(request.url()).pathname
        if (path.startsWith("/api/v1/logo/assets/"))
            return route.fulfill({
                contentType: "image/png",
                body: Buffer.from(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=",
                    "base64",
                ),
            })
        if (path === "/api/v1/logo/fetch") {
            state.iconFetches++
            expect(request.headers()["x-csrf-token"]).toBe("mock-token")
            expect(request.postDataJSON().mode).toBe("image")
            if (state.iconDelay)
                await new Promise((resolve) => setTimeout(resolve, state.iconDelay))
            if (state.iconError)
                return route.fulfill({ json: { success: false, error: "图片下载失败" } })
            return route.fulfill({
                json: { success: true, data: { image: "data:image/png;base64,mock" } },
            })
        }
        if (path === "/api/v1/logo/store") {
            state.iconStores++
            expect(request.postDataJSON()).toEqual({ logo: "data:image/png;base64,mock" })
            return route.fulfill({
                json: {
                    success: true,
                    data: { logo: "/api/v1/logo/assets/" + "a".repeat(64) + ".png" },
                },
            })
        }
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, role, username: "qa" }
        if (path === "/api/v1/setting")
            data = { config: { language: "zh-CN", site_name: "测试面板" }, frontend_templates: [] }
        if (path === "/api/v1/setting/connectivity") {
            if (role !== 0) return route.fulfill({ json: { success: false, error: "denied" } })
            if (request.method() === "PUT") {
                state.writes++
                expect(request.headers()["x-csrf-token"]).toBe("mock-token")
                if (state.conflict)
                    return route.fulfill({
                        json: { success: false, error: "配置已被其他页面修改，请重新加载后再保存" },
                    })
                const body = request.postDataJSON()
                expect(body.revision).toBe(state.revision)
                state.items = body.items
                state.revision = "r" + (state.writes + 1)
            } else state.reads++
            data = { items: state.items, revision: state.revision, defaults, max_targets: 120 }
        }
        return route.fulfill({ json: { success: true, data } })
    })
    await page.goto("http://127.0.0.1:18479/dashboard/settings/cards")
    return state
}
for (const width of [390, 1440])
    for (const theme of ["light", "dark"]) {
        test(`card settings CRUD and ordering ${theme} ${width}`, async ({ page }, info) => {
            await page.setViewportSize({ width, height: 900 })
            const errors: string[] = []
            page.on("pageerror", (error) => errors.push(error.message))
            const state = await setup(page, 0, theme)
            await expect(page.getByRole("heading", { name: "卡片设置", exact: true })).toBeVisible()
            await expect(page.locator("[data-checkpoint-id]")).toHaveCount(72)
            const before = await page.locator("[data-card-settings]").boundingBox()
            await page.getByRole("button", { name: "添加检测点", exact: true }).click()
            const dialog = page.getByRole("dialog")
            await expect(dialog).toBeVisible()
            const opened = await page.locator("[data-card-settings]").boundingBox()
            expect(opened?.x).toBe(before?.x)
            expect(opened?.width).toBe(before?.width)
            await dialog.getByLabel("应用名称", { exact: true }).fill("Custom test")
            await dialog.getByLabel("检测地址", { exact: true }).fill("http://example.com/health")
            await expect(dialog.getByRole("button", { name: "保存到草稿" })).toBeDisabled()
            await dialog.getByLabel("检测地址", { exact: true }).fill("https://example.com/health")
            await dialog.getByLabel("地区", { exact: true }).selectOption("japan")
            await dialog.getByLabel("图标", { exact: true }).selectOption("sony")
            await dialog.getByRole("button", { name: "保存到草稿" }).click()
            expect(state.writes).toBe(0)
            await page.getByLabel("搜索检测点").fill("Custom test")
            const custom = page.locator("[data-checkpoint-id]").filter({ hasText: "Custom test" })
            await expect(custom).toHaveCount(1)
            await custom.getByRole("button", { name: "编辑 Custom test", exact: true }).click()
            await dialog.getByLabel("应用名称", { exact: true }).fill("Custom renamed")
            await dialog.getByRole("button", { name: "保存到草稿" }).click()
            await page.getByLabel("搜索检测点").fill("")
            await page.getByLabel("筛选地区").selectOption("japan")
            await page.getByRole("button", { name: "上移 Custom renamed", exact: true }).click()
            const japan = page.locator("[data-checkpoint-id]")
            await expect(japan.nth(6)).toContainText("Custom renamed")
            await page.getByRole("switch", { name: "启用 Sony", exact: true }).click()
            await page.getByRole("button", { name: "保存配置", exact: true }).click()
            await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeDisabled()
            expect(state.writes).toBe(1)
            expect(state.items.find((row: any) => row.id === "sony").enabled).toBe(false)
            await page.reload()
            await page.getByLabel("搜索检测点").fill("Custom renamed")
            await expect(page.locator("[data-checkpoint-id]")).toHaveCount(1)
            state.conflict = true
            await page.getByRole("button", { name: "编辑 Custom renamed", exact: true }).click()
            await dialog.getByLabel("应用名称", { exact: true }).fill("Unsaved edit")
            await dialog.getByRole("button", { name: "保存到草稿" }).click()
            await page.getByRole("button", { name: "保存配置", exact: true }).click()
            await expect(page.getByRole("alert")).toContainText("配置已被其他页面修改")
            expect(state.items.some((row: any) => row.name === "Unsaved edit")).toBe(false)
            state.conflict = false
            page.once("dialog", (dialog) => dialog.accept())
            await page.getByRole("button", { name: "重新加载", exact: true }).click()
            await page.getByLabel("搜索检测点").fill("Custom renamed")
            page.once("dialog", (dialog) => dialog.accept())
            await page.getByRole("button", { name: "删除 Custom renamed", exact: true }).click()
            await page.getByRole("button", { name: "保存配置", exact: true }).click()
            await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeDisabled()
            expect(state.items).toHaveLength(72)
            await page.getByLabel("搜索检测点").fill("")
            await page.getByLabel("筛选地区").selectOption("japan")
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            await page.screenshot({ path: info.outputPath("card-settings.png"), fullPage: true })
            await page.getByRole("button", { name: "账户菜单", exact: true }).click()
            const labels = await page.getByRole("menuitem").allTextContents()
            expect(labels.indexOf("卡片设置")).toBe(labels.indexOf("系统设置") + 1)
            await page.getByRole("menuitem", { name: "卡片设置", exact: true }).click()
            await expect(page).toHaveURL(/\/settings\/cards$/)
            expect(errors).toEqual([])
        })
    }
test("member has neither settings page nor configuration reads", async ({ page }) => {
    const state = await setup(page, 1)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.locator("[data-card-settings]")).toHaveCount(0)
    expect(state.reads).toBe(0)
    expect(state.writes).toBe(0)
})
for (const width of [320, 1440])
    test(`custom icon import persistence and recovery ${width}`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 })
        const state = await setup(page, 0, "dark"),
            dialog = page.getByRole("dialog")
        await page.getByRole("button", { name: "编辑 DeepSeek", exact: true }).click()
        await dialog.getByLabel("图标", { exact: true }).selectOption("custom")
        const save = dialog.getByRole("button", { name: "保存到草稿" })
        await expect(save).toBeDisabled()
        const input = dialog.getByLabel("图标地址", { exact: true })
        await input.fill("http://example.com/icon.png")
        await dialog.getByRole("button", { name: "使用图标地址" }).click()
        await expect(dialog.getByRole("alert")).toContainText("HTTPS")
        expect(state.iconFetches).toBe(0)
        await input.fill("https://example.com/icon.png")
        await dialog.getByRole("button", { name: "使用图标地址" }).click()
        await expect(save).toBeEnabled()
        expect(state.iconFetches).toBe(1)
        expect(state.iconStores).toBe(1)
        const asset = "/api/v1/logo/assets/" + "a".repeat(64) + ".png"
        await expect(dialog.locator("img")).toHaveAttribute("src", asset)
        await expect
            .poll(() =>
                dialog
                    .locator("img")
                    .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
            )
            .toBe(true)
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.screenshot({ path: info.outputPath("custom-icon-editor.png") })
        await save.click()
        await page.getByRole("button", { name: "保存配置", exact: true }).click()
        await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeDisabled()
        expect(state.items.find((item: any) => item.id === "deepseek")).toMatchObject({
            icon: asset,
            icon_source: "https://example.com/icon.png",
        })
        await page.reload()
        await page.getByRole("button", { name: "编辑 DeepSeek", exact: true }).click()
        await expect(input).toHaveValue("https://example.com/icon.png")
        await expect(save).toBeEnabled()
        state.iconError = true
        await input.fill("https://example.com/broken.png")
        await expect(save).toBeDisabled()
        await dialog.getByRole("button", { name: "使用图标地址" }).click()
        await expect(dialog.getByRole("alert")).toContainText("原图标未更改")
        await expect(dialog.locator("img")).toHaveAttribute("src", asset)
        expect(state.iconStores).toBe(1)
        await input.fill("https://example.com/icon.png")
        await expect(save).toBeEnabled()
        await dialog.getByLabel("图标", { exact: true }).selectOption("sony")
        await expect(input).toHaveCount(0)
        await save.click()
        await page.getByRole("button", { name: "保存配置", exact: true }).click()
        await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeDisabled()
        expect(state.items.find((item: any) => item.id === "deepseek")).toMatchObject({
            icon: "sony",
            icon_source: "",
        })
    })
test("closing an in-flight icon import cannot replace another checkpoint", async ({ page }) => {
    const state = await setup(page),
        dialog = page.getByRole("dialog")
    state.iconDelay = 700
    await page.getByRole("button", { name: "编辑 DeepSeek", exact: true }).click()
    await dialog.getByLabel("图标", { exact: true }).selectOption("custom")
    await dialog.getByLabel("图标地址", { exact: true }).fill("https://example.com/icon.png")
    await dialog.getByRole("button", { name: "使用图标地址" }).click()
    await expect(dialog.getByRole("button", { name: "保存到草稿" })).toBeDisabled()
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    await page.getByRole("button", { name: "编辑 Sony", exact: true }).click()
    await page.waitForTimeout(900)
    await expect(dialog.getByLabel("图标", { exact: true })).toHaveValue("sony")
    await expect(dialog.getByRole("button", { name: "保存到草稿" })).toBeEnabled()
    expect(state.iconStores).toBe(0)
})
