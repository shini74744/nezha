import { expect, test } from "@playwright/test"

for (const width of [320, 390, 844, 1440]) for (const theme of ["light", "dark"]) {
    test("visual Agent config " + width + " " + theme, async ({ page }, info) => {
        await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
        await page.addInitScript(theme => localStorage.setItem("nezha-dashboard-theme", theme), theme)
        const writes: any[] = []
        const errors: string[] = []
        page.on("pageerror", error => errors.push(error.message))
        await page.route("**/api/v1/**", async route => {
            const path = new URL(route.request().url()).pathname
            let data: any = []
            if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
            if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
            if (path === "/api/v1/server") data = [7, 8].map(id => ({ id, name: "测试节点" + id, uuid: "test-" + id, display_index: 20-id, user_id: 1, host: {} }))
            if (route.request().method() === "POST") {
                expect(path).toBe("/api/v1/server/config")
                writes.push(route.request().postDataJSON())
                await new Promise(resolve => setTimeout(resolve, 150))
                data = { success: [7], offline: [8], failure: [] }
            }
            return route.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard")
        await page.getByRole("checkbox", { name: "Select all", exact: true }).check()
        await page.getByRole("button", { name: "批量配置 Agent", exact: true }).click()
        const dialog = page.getByRole("dialog")
        await expect(dialog.getByRole("heading", { name: "批量配置 Agent" })).toBeVisible()
        await expect(dialog.getByRole("button", { name: "检查改动" })).toBeDisabled()
        expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT")
        await dialog.evaluate(async el => {
            await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined)))
        })
        const first = dialog.locator('[data-config-field="gpu"]')
        const second = dialog.locator('[data-config-field="temperature"]')
        const firstBox = await first.boundingBox()
        const secondBox = await second.boundingBox()
        expect(firstBox).not.toBeNull()
        expect(secondBox).not.toBeNull()
        expect(firstBox!.height).toBeLessThanOrEqual(112)
        if (width >= 640) {
            expect(Math.abs(firstBox!.y - secondBox!.y)).toBeLessThan(2)
            expect(secondBox!.x).toBeGreaterThan(firstBox!.x + firstBox!.width)
        } else {
            expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThan(2)
            expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height)
            expect(await first.locator("label").evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
        }
        await expect(dialog.getByRole("button", { name: "检查改动" })).toBeInViewport()
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.screenshot({ animations: "disabled", path: info.outputPath("compact-overview.png") })
        const search = dialog.getByRole("textbox", { name: "搜索配置项" })
        await search.fill("上报")
        await dialog.getByRole("checkbox", { name: "修改状态上报间隔", exact: true }).check()
        const interval = dialog.getByRole("spinbutton", { name: "状态上报间隔", exact: true })
        await interval.fill("5")
        await expect(dialog.getByRole("alert")).toContainText("1–4")
        await expect(dialog.getByRole("button", { name: "检查改动" })).toBeDisabled()
        await interval.fill("2")
        await search.fill("终端")
        await dialog.getByRole("checkbox", { name: "修改允许远程终端与文件管理", exact: true }).check()
        await dialog.getByRole("switch", { name: "允许远程终端与文件管理", exact: true }).uncheck()
        await expect(dialog.getByText(/需要通过其他 SSH/)).toBeVisible()
        await expect(dialog.getByRole("button", { name: "检查改动" })).toBeInViewport()
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.screenshot({ animations: "disabled", path: info.outputPath("visual-form.png") })
        await dialog.getByRole("button", { name: "检查改动" }).click()
        expect(writes).toHaveLength(0)
        await expect(dialog.getByText("状态上报间隔", { exact: true })).toBeVisible()
        await expect(dialog.getByRole("button", { name: "确认下发" })).toBeDisabled()
        await dialog.getByRole("checkbox", { name: "我已了解这些影响，确认修改" }).check()
        await expect(dialog.getByRole("button", { name: "确认下发" })).toBeInViewport()
        await page.screenshot({ animations: "disabled", path: info.outputPath("visual-review.png") })
        await dialog.getByRole("button", { name: "确认下发" }).click()
        await expect(dialog.getByText("节点离线：1 台")).toBeVisible()
        expect(writes).toEqual([{ servers: [7, 8], config: '{"report_delay":2,"disable_command_execute":true}' }])
        expect(errors).toEqual([])
        await page.screenshot({ animations: "disabled", path: info.outputPath("visual-result.png") })
        await dialog.getByRole("button", { name: "关闭", exact: true }).click()
        await page.getByRole("button", { name: "批量配置 Agent", exact: true }).click()
        await expect(dialog.getByText("已选 0 项")).toBeVisible()
        expect(writes).toHaveLength(1)
        await search.fill("")
        await page.screenshot({ animations: "disabled", path: info.outputPath("visual-overview.png") })
    })
}

test("NIC rows, lists and deselection generate only explicit edits", async ({ page }) => {
    const writes: any[] = []
    await page.route("**/api/v1/**", route => {
        const path = new URL(route.request().url()).pathname
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/server") data = [{ id: 7, name: "测试节点", uuid: "test", display_index: 1, user_id: 1, host: {} }]
        if (route.request().method() === "POST") {
            writes.push(route.request().postDataJSON()); data = { success: [7] }
        }
        return route.fulfill({ json: { success: true, data } })
    })
    await page.goto("/dashboard")
    await page.getByRole("checkbox", { name: "Select all", exact: true }).check()
    await page.getByRole("button", { name: "批量配置 Agent", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("checkbox", { name: "修改监控网卡", exact: true }).check()
    await dialog.getByRole("button", { name: "添加网卡" }).click()
    await expect(dialog.getByRole("button", { name: "检查改动" })).toBeDisabled()
    await dialog.getByRole("textbox", { name: "网卡名称 1" }).fill("eth0")
    await dialog.getByRole("switch", { name: "监控网卡 1" }).uncheck()
    await dialog.getByRole("checkbox", { name: "修改监控磁盘分区", exact: true }).check()
    await dialog.getByRole("textbox", { name: "监控磁盘分区", exact: true }).fill("/\n/data")
    await dialog.getByRole("checkbox", { name: "修改GPU 监控", exact: true }).check()
    await dialog.getByRole("checkbox", { name: "修改GPU 监控", exact: true }).uncheck()
    await dialog.getByRole("button", { name: "检查改动" }).click()
    await dialog.getByRole("button", { name: "确认下发" }).click()
    await expect(dialog.getByText("已下发：1 台")).toBeVisible()
    expect(JSON.parse(writes[0].config)).toEqual({ hard_drive_partition_allowlist: ["/", "/data"], nic_allowlist: { eth0: false } })
})

test.describe("compact touch layout", () => {
    test.use({ hasTouch: true, isMobile: true })
    test("landscape keeps 44px targets and expands complex fields", async ({ page }, info) => {
        await page.setViewportSize({ width: 844, height: 390 })
        await page.route("**/api/v1/**", route => {
            const path = new URL(route.request().url()).pathname
            let data: any = []
            if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
            if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
            if (path === "/api/v1/server") data = [{ id: 7, name: "测试节点", uuid: "test", display_index: 1, user_id: 1, host: {} }]
            expect(route.request().method()).toBe("GET")
            return route.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard")
        await page.getByRole("checkbox", { name: "Select all", exact: true }).check()
        await page.getByRole("button", { name: "批量配置 Agent", exact: true }).click()
        const dialog = page.getByRole("dialog")
        await dialog.evaluate(async el => {
            await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined)))
        })
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
        expect(await dialog.locator('[data-config-field="gpu"] label').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
        expect(await dialog.getByRole("textbox", { name: "搜索配置项" }).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
        await dialog.getByRole("checkbox", { name: "修改监控网卡", exact: true }).check()
        const card = dialog.locator('[data-config-field="nic_allowlist"]')
        expect(await card.evaluate(el => getComputedStyle(el).gridColumn)).toBe("span 2 / span 2")
        await dialog.getByRole("button", { name: "添加网卡" }).click()
        await expect(dialog.getByRole("textbox", { name: "网卡名称 1" })).toBeVisible()
        await expect(dialog.getByRole("button", { name: "检查改动" })).toBeInViewport()
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.screenshot({ animations: "disabled", path: info.outputPath("touch-landscape.png") })
    })
})
