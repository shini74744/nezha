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
        bgpPolicy: { enabled: true, interval_hours: 6, retention_days: 1, revision: "b1" },
        bgpWrites: 0,
        policy: { enabled: true, interval_hours: 2, retention_days: 1, revision: "p1" },
        policyWrites: 0,
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
        if (path === "/api/v1/setting/bgp/automation") {
            if (request.method() === "PUT") {
                state.bgpPolicy = request.postDataJSON()
                state.bgpWrites++
            }
            return route.fulfill({ json: { success: true, data: state.bgpPolicy } })
        }
        if (path === "/api/v1/setting/connectivity/automation") {
            if (request.method() === "PUT") {
                state.policy = request.postDataJSON()
                state.policyWrites++
            }
            return route.fulfill({ json: { success: true, data: state.policy } })
        }
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
            await expect(page.locator("[data-checkpoint-id]")).toHaveCount(defaults.length)
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
            await page.getByRole("button", { name: "拖动排序 Custom renamed", exact: true }).focus()
            await page.keyboard.press("ArrowUp")
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
            expect(state.items).toHaveLength(defaults.length)
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
for (const width of [390, 1440])
    test("drag pointer ordering and automation settings " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 950 })
        const state = await setup(page, 0, "dark")
        await expect(page.getByRole("tab", { name: "连通性", exact: true })).toHaveAttribute(
            "aria-selected",
            "true",
        )
        await expect(page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("检测间隔（小时）")).toHaveValue("2")
        await expect(page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("记录保留（天）")).toHaveValue("1")
        await page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("检测间隔（小时）").fill("0")
        await expect(
            page.getByRole("button", { name: "保存自动检测设置", exact: true }),
        ).toBeDisabled()
        await page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("检测间隔（小时）").fill("4")
        await page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("记录保留（天）").fill("3")
        await page.getByRole("button", { name: "保存自动检测设置", exact: true }).click()
        await expect.poll(() => state.policyWrites).toBe(1)
        expect(state.policy).toMatchObject({ enabled: true, interval_hours: 4, retention_days: 3 })
        await page.getByLabel("筛选地区").selectOption("singapore")
        const ids = () =>
            page
                .locator("[data-checkpoint-id]")
                .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-checkpoint-id")))
        const before = await ids()
        const handle = page.getByRole("button", { name: "拖动排序 Grab", exact: true })
        // Keep both rows away from edge auto-scroll before recording coordinates.
        // The compact settings card can otherwise leave CNA across the viewport edge.
        await page.locator('[data-checkpoint-id="cna"]').evaluate((row) => row.scrollIntoView({ block: "center" }))
        await handle.scrollIntoViewIfNeeded()
        const from = await handle.boundingBox(),
            to = await page.locator('[data-checkpoint-id="cna"]').boundingBox()
        if (!from || !to) throw Error("drag bounds")
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 })
        await page.mouse.up()
        await expect.poll(ids).toEqual([before[1], before[2], before[0]])
        expect(state.writes).toBe(0)
        await page.getByRole("button", { name: "保存配置", exact: true }).click()
        await expect.poll(() => state.writes).toBe(1)
        await page.reload()
        await page.getByLabel("筛选地区").selectOption("singapore")
        await expect.poll(ids).toEqual([before[1], before[2], before[0]])
        await expect(page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("检测间隔（小时）")).toHaveValue("4")
        await expect(page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("记录保留（天）")).toHaveValue("3")
        await page.screenshot({ path: info.outputPath("drag-automation.png"), fullPage: true })
    })

test("touch drag and explicit missing-default merge preserve custom choices", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 950 })
    const state = await setup(page)
    state.items = state.items.filter((row: any) => ["grab", "shopee", "cna"].includes(row.id))
    state.items[0] = { ...state.items[0], name: "我的 Grab", enabled: false }
    await page.reload()
    await expect(page.locator("[data-checkpoint-id]")).toHaveCount(3)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 })
    const handle = page.getByRole("button", { name: "拖动排序 我的 Grab", exact: true })
    await handle.scrollIntoViewIfNeeded()
    const from = (await handle.boundingBox())!,
        to = (await page.locator('[data-checkpoint-id="cna"]').boundingBox())!
    const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 },
        b = { x: to.x + 50, y: to.y + to.height / 2 }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] })
    for (let i = 1; i <= 12; i++)
        await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12 }],
        })
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect(page.locator("[data-checkpoint-id]").last()).toHaveAttribute(
        "data-checkpoint-id",
        "grab",
    )
    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "补充内置检测点", exact: true }).click()
    await expect(page.locator("[data-checkpoint-id]")).toHaveCount(defaults.length)
    await page.getByRole("button", { name: "保存配置", exact: true }).click()
    await expect.poll(() => state.writes).toBe(1)
    expect(state.items.slice(0, 3).map((row: any) => row.id)).toEqual(["shopee", "cna", "grab"])
    expect(state.items.find((row: any) => row.id === "grab")).toMatchObject({
        name: "我的 Grab",
        enabled: false,
    })
})
for (const width of [320, 390, 768, 1440])
    for (const theme of ["light", "dark"])
        test("independent BGP settings " + theme + " " + width, async ({ page }, info) => {
            await page.setViewportSize({ width, height: 900 })
            const state = await setup(page, 0, theme)
            const connectivitySettings = page.getByRole("region", { name: "自动检测设置", exact: true })
            await expect(connectivitySettings.locator("p")).toHaveCount(0)
            await expect(connectivitySettings.getByRole("button", { name: /说明$/ })).toHaveCount(2)
            await expect(connectivitySettings.getByRole("spinbutton").first()).toHaveValue("2")
            const compactBox = await connectivitySettings.boundingBox()
            expect(compactBox!.height).toBeLessThanOrEqual(width >= 1024 ? 110 : 230)
            expect(compactBox!.width).toBeLessThanOrEqual(1024)
            await connectivitySettings.screenshot({path:info.outputPath("connectivity-auto-compact.png")})
            const targetHelp = page.getByRole("button", { name: "连通性检测点说明", exact: true })
            await targetHelp.click()
            await expect(page.locator("[data-setting-help]")).toHaveText(/不要填写密码、令牌、私密链接或内网地址/)
            await expect(page.locator("[data-setting-help]")).toHaveText(/中国区域始终排在最后/)
            await page.keyboard.press("Escape")
            await expect(targetHelp).toBeFocused()
            await page.getByLabel("筛选地区").selectOption("hongkong")
            await expect(page.locator("[data-checkpoint-id]")).toHaveCount(4)
            await page.getByLabel("筛选地区").selectOption("macau")
            await expect(page.locator("[data-checkpoint-id]")).toHaveCount(4)
            await page.getByRole("tab", { name: "BGP", exact: true }).click()
            await expect(page.getByLabel("BGP 检测间隔（小时）", { exact: true })).toHaveValue("6")
            await expect(page.getByLabel("BGP 记录保留（天）", { exact: true })).toHaveValue("1")
            const settings = page.getByRole("region", { name: "BGP 自动检测设置", exact: true })
            await expect(settings.locator("p")).toHaveCount(0)
            await expect(settings.getByRole("button", { name: /说明$/ })).toHaveCount(2)
            await settings.screenshot({ path: info.outputPath("bgp-auto-compact.png") })
            expect((await settings.boundingBox())!.height).toBeLessThanOrEqual(width >= 1024 ? 110 : 230)
            if(width>=1024){
                for(const input of await settings.getByRole("spinbutton").all())expect((await input.boundingBox())!.width).toBeLessThanOrEqual(100)
                const boxes=await settings.locator('input,button[role="switch"]').evaluateAll(nodes=>nodes.map(el=>{const b=el.getBoundingClientRect();return {y:b.y,height:b.height}}))
                boxes.push((await settings.getByRole("button",{name:"保存自动检测设置",exact:true}).boundingBox())!)
                expect(Math.max(...boxes.map(b=>b.y+b.height/2))-Math.min(...boxes.map(b=>b.y+b.height/2))).toBeLessThan(4)
            }
            for (const label of ["BGP 自动检测与记录", "BGP 自动检测"]) {
                const help = settings.getByRole("button", { name: label + "说明", exact: true })
                await help.focus()
                await page.keyboard.press("Enter")
                const popover = page.locator("[data-setting-help]")
                await expect(popover).toBeVisible()
                await expect(popover).toHaveText(label.endsWith("记录") ? /记录到期后自动清理/ : /按北京时间整点周期/)
                const box = (await popover.boundingBox())!
                expect(box.x).toBeGreaterThanOrEqual(0)
                expect(box.x + box.width).toBeLessThanOrEqual(width)
                await page.screenshot({ path: info.outputPath(label + "-help.png") })
                await page.keyboard.press("Escape")
                await expect(help).toBeFocused()
                await expect(popover).toHaveCount(0)
                await expect(settings.getByRole("switch", { name: "BGP 自动检测", exact: true })).toBeChecked()
            }
            await expect(
                page.getByRole("button", { name: "保存配置", exact: true }),
            ).not.toBeVisible()
            await page.getByLabel("BGP 检测间隔（小时）", { exact: true }).fill("8")
            await page.getByLabel("BGP 记录保留（天）", { exact: true }).fill("2")
            await page.getByRole("button", { name: "保存自动检测设置", exact: true }).click()
            await expect.poll(() => state.bgpWrites).toBe(1)
            expect(state.policy).toMatchObject({ interval_hours: 2, retention_days: 1 })
            expect(state.policyWrites).toBe(0)
            expect(state.writes).toBe(0)
            await page.getByRole("tab", { name: "连通性", exact: true }).click()
            await expect(page.getByRole("tabpanel", { name: "连通性", exact: true }).getByLabel("检测间隔（小时）", { exact: true })).toHaveValue("2")
            await expect(page.getByLabel("筛选地区")).toHaveValue("macau")
            await page.getByRole("tab", { name: "BGP", exact: true }).click()
            await page.reload()
            await page.getByRole("tab", { name: "BGP", exact: true }).click()
            await expect(page.getByLabel("BGP 检测间隔（小时）", { exact: true })).toHaveValue("8")
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            await page.screenshot({ path: info.outputPath("bgp-settings.png"), fullPage: true })
        })