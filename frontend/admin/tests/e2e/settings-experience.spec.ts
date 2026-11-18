import { type Page, expect, test } from "@playwright/test"
import fs from "node:fs"

const config = (name: string) => ({
    version: 1,
    enabled: true,
    features: Object.fromEntries(
        JSON.parse(
            fs.readFileSync(
                new URL("../../src/lib/" + name + "-manifest.json", import.meta.url),
                "utf8",
            ),
        ).map((d: any) => [d.key, structuredClone(d.defaults)]),
    ),
})
async function setup(page: Page, role = 0) {
    const errors: string[] = [],
        writes: any[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.addInitScript(() => localStorage.setItem("vite-ui-theme", "light"))
    let delay: Promise<void> | undefined,
        release = () => {},
        fail = false
    const state: Record<string, any> = {
        "/api/v1/setting/appearance": {
            config: config("appearance"),
            custom_code: "",
            revision: "front",
            current_template: "user-dist",
        },
        "/api/v1/setting/dashboard-appearance": {
            config: config("dashboard-appearance"),
            custom_code: "",
            archived_code: "",
            revision: "back",
        },
    }
    let icons: any[] = [1, 2, 3].map((i) => ({
        id: "provider-" + i,
        kind: "provider",
        name: "测试厂商" + i,
        regions: [],
        aliases: "",
        groupId: "",
        version: 1,
        logo: "",
        logoOriginal: "",
        logoWebsite: "",
        background: "",
    }))
    let groups = [{ id: "g1", name: "常用", version: 1 }]
    await page.routeWebSocket("**/api/v1/**", () => {})
    await page.route("**/*", async (r) => {
        const u = new URL(r.request().url())
        if (!["127.0.0.1", "localhost"].includes(u.hostname)) return r.abort()
        if (!u.pathname.startsWith("/api/v1/")) return r.continue()
        const path = u.pathname,
            method = r.request().method()
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role }
        if (path === "/api/v1/setting")
            data = { config: { site_name: "测试面板", language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/setting/display")
            data = { statistics_split: false, detail_network_split: false }
        if (method !== "GET") {
            const body = r.request().postDataJSON()
            writes.push({ path, method, body })
            if (delay) await delay
            if (fail)
                return r.fulfill({
                    json: { success: false, error: "configuration changed; reload settings" },
                })
            if (state[path])
                state[path] = {
                    ...state[path],
                    config: body.config,
                    revision: state[path].revision + "x",
                }
            if (path.startsWith("/api/v1/logo/library/")) {
                icons = icons.map((v) =>
                    v.id === path.split("/").pop() ? { ...body, version: v.version + 1 } : v,
                )
                data = { updated_servers: 2 }
            }
            if (path === "/api/v1/logo/batch-group")
                icons = icons.map((v) =>
                    body.entries.some((e: any) => e.id === v.id)
                        ? { ...v, groupId: body.group_id, version: v.version + 1 }
                        : v,
                )
            if (path === "/api/v1/logo/groups") {
                const g = { ...body, id: "g2", version: 1 }
                groups.push(g)
                data = g
            }
        }
        if (state[path]) data = state[path]
        if (path === "/api/v1/logo/library") data = icons
        if (path === "/api/v1/logo/groups" && method === "GET") data = groups
        if (path === "/api/v1/logo/usage")
            data = {
                "provider-1": [
                    { id: 19, name: "香港示例" },
                    { id: 20, name: "日本示例" },
                ],
            }
        await r.fulfill({ json: { success: true, data } })
    })
    return {
        errors,
        writes,
        state,
        pause: () => {
            delay = new Promise<void>((r) => (release = r))
        },
        release: () => {
            release()
            delay = undefined
        },
        fail: (v: boolean) => (fail = v),
    }
}
test.setTimeout(90000)
const editors = [
    {
        route: "appearance",
        section: "站点品牌",
        label: "站点说明",
        save: "保存美化设置",
        group: "品牌与文字",
        preview: "专业服务，技术先行",
    },
    {
        route: "dashboard-appearance",
        section: "标题、Logo 与头像",
        label: "后台标题",
        save: "保存后台美化设置",
        group: "品牌与文字",
        preview: "哪吒云监控",
    },
]
for (const width of [390, 1440]) {
    for (const e of editors) {
        test(
            e.route + " protects navigation, pending save, errors and undo " + width,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 900 })
                const s = await setup(page)
                await page.goto("/dashboard/settings/icons")
                await page
                    .getByRole("tab", {
                        name: e.route === "appearance" ? "美化设置" : "后台美化设置",
                        exact: true,
                    })
                    .click()
                await page.getByRole("button", { name: e.section, exact: true }).click()
                const input = page.getByLabel(e.label, { exact: true }),
                    original = await input.inputValue()
                await input.fill("尚未保存")
                await page.getByRole("tab", { name: "图标设置", exact: true }).click()
                await expect(page.getByRole("dialog", { name: "有未保存的修改" })).toBeVisible()
                await page.getByRole("button", { name: "继续编辑", exact: true }).click()
                await expect(input).toHaveValue("尚未保存")
                await page.evaluate(() => history.back())
                await expect(page.getByRole("dialog", { name: "有未保存的修改" })).toBeVisible()
                // Cancelling a browser POP restores history and native focus asynchronously.
                // Wait for that traversal before typing into another field.
                await expect(page).toHaveURL(new RegExp(e.route + "$"))
                await page.getByRole("button", { name: "继续编辑", exact: true }).click()
                await expect(page.getByRole("dialog", { name: "有未保存的修改" })).toHaveCount(0)
                await expect(input).toHaveValue("尚未保存")
                await page.getByLabel("搜索设置").fill("完全不存在的设置")
                await expect(page.getByText("没有匹配的设置，请尝试其他关键词。")).toBeVisible()
                await page.getByLabel("搜索设置").fill("")
                await expect(input).toHaveValue("尚未保存")
                await page.getByRole("button", { name: "撤销本次修改", exact: true }).click()
                await expect(input).toHaveValue(original)
                await input.fill("保存中的值")
                s.pause()
                await page.getByRole("button", { name: e.save, exact: true }).click()
                await expect.poll(() => s.writes.length).toBe(1)
                await expect(input).toBeDisabled()
                await page.getByRole("tab", { name: "图标设置", exact: true }).click()
                await expect(page).toHaveURL(new RegExp(e.route + "$"))
                s.release()
                await expect(input).toBeEnabled()
                await expect(input).toHaveValue("保存中的值")
                await input.fill("冲突时保留")
                s.fail(true)
                await page.getByRole("button", { name: e.save, exact: true }).click()
                await expect(input).toBeEnabled()
                await expect(input).toHaveValue("冲突时保留")
                await expect(page.getByRole("button", { name: e.save, exact: true })).toBeEnabled()
                await page.getByRole("tab", { name: "图标设置", exact: true }).click()
                await page.getByRole("button", { name: "放弃修改并离开", exact: true }).click()
                await expect(page).toHaveURL(/icons$/)
                expect(s.errors).toEqual([])
            },
        )
        test(
            e.route + " isolated preview, section defaults and responsive layout " + width,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 900 })
                const s = await setup(page)
                await page.goto("/dashboard/settings/" + e.route)
                await page.getByRole("button", { name: e.section, exact: true }).click()
                const input = page.getByLabel(e.label, { exact: true })
                await input.fill("预览测试文字")
                const before = await page.evaluate(() => ({
                    storage: { ...localStorage },
                    className: document.documentElement.className,
                }))
                await page.getByRole("button", { name: "展开预览", exact: true }).click()
                const frame = page.frameLocator('iframe[title="外观示例预览"]')
                await expect(frame.getByText("预览测试文字", { exact: true })).toBeVisible()
                for (const mode of ["深色", "浅色"])
                    for (const device of ["手机", "电脑"]) {
                        await page.getByRole("button", { name: mode, exact: true }).click()
                        await page.getByRole("button", { name: device, exact: true }).click()
                        await expect(frame.locator("html")).toHaveClass(
                            mode === "深色" ? "dark" : "",
                        )
                        await expect(frame.locator(".server")).toHaveCount(3)
                        expect(
                            await page.evaluate(
                                () => document.documentElement.scrollWidth <= innerWidth,
                            ),
                        ).toBe(true)
                    }
                expect(
                    await page.evaluate(() => ({
                        storage: { ...localStorage },
                        className: document.documentElement.className,
                    })),
                ).toEqual(before)
                expect(s.writes).toHaveLength(0)
                await page.screenshot({
                    path: "test-results/" + e.route + "-experience-" + width + ".png",
                    fullPage: true,
                })
                const section = page
                    .locator("section")
                    .filter({ has: page.getByRole("button", { name: e.section, exact: true }) })
                    .last()
                await section.getByRole("button", { name: "恢复本项默认", exact: true }).click()
                await expect(input).toHaveValue(e.preview)
                if (e.route === "dashboard-appearance") {
                    await page.getByRole("button", { name: "透明度与毛玻璃", exact: true }).click()
                    const slider = page.getByRole("slider", { name: "浅色卡片不透明度" })
                    await slider.fill("37")
                    await expect(slider).toHaveValue("37")
                    await page
                        .getByRole("button", { name: "保存后台美化设置", exact: true })
                        .click()
                    await expect.poll(() => s.writes.length).toBe(1)
                    expect(s.writes[0].body.config.features.appearance.lightCardOpacity).toBe(0.37)
                }
                expect(s.errors).toEqual([])
            },
        )
    }
    test("icon drafts, association preview and batch grouping " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        const s = await setup(page)
        await page.goto("/dashboard/settings/icons")
        await page.getByRole("button", { name: "修改 测试厂商1", exact: true }).click()
        await expect(page.getByText("当前关联 2 台服务器，保存图标后将同步更新。")).toBeVisible()
        await page.getByText("查看服务器", { exact: true }).click()
        await expect(page.getByText("香港示例", { exact: false })).toBeVisible()
        await page.getByLabel("图标名称", { exact: true }).fill("新名称")
        await page.getByRole("dialog").press("Escape")
        await page.getByRole("button", { name: "继续编辑", exact: true }).click()
        await expect(page.getByLabel("图标名称", { exact: true })).toHaveValue("新名称")
        await page.getByRole("button", { name: "取消", exact: true }).click()
        await page.getByRole("button", { name: "继续编辑", exact: true }).click()
        await expect(page.getByLabel("明暗图标预览")).toBeVisible()
        s.pause()
        await page.getByRole("button", { name: "保存", exact: true }).click()
        await expect.poll(() => s.writes.length).toBe(1)
        await expect(page.getByLabel("图标名称", { exact: true })).toBeDisabled()
        await page.getByRole("dialog").press("Escape")
        await expect(page.getByRole("dialog")).toHaveCount(1)
        s.release()
        await expect(page.getByRole("dialog")).toHaveCount(0)
        await page.getByLabel("选择本页图标", { exact: true }).check()
        await page.getByRole("combobox", { name: "批量移动到分组", exact: true }).click()
        await page.getByRole("option", { name: "常用", exact: true }).click()
        page.once("dialog", (d) => d.accept())
        await page.getByRole("button", { name: "移动分组", exact: true }).click()
        await expect.poll(() => s.writes.length).toBe(2)
        expect(s.writes[1].body).toEqual({
            group_id: "g1",
            entries: [
                { id: "provider-1", version: 2 },
                { id: "provider-2", version: 1 },
                { id: "provider-3", version: 1 },
            ],
        })
        await expect(page.getByText("已选 0 项", { exact: true })).toBeVisible()
        await page.getByRole("button", { name: "修改 新名称", exact: true }).click()
        await page.screenshot({
            path: "test-results/icons-experience-" + width + ".png",
            fullPage: true,
        })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        )
        expect(s.errors).toEqual([])
    })
    test(
        "group dialog discard and batch conflict preserve selection " + width,
        async ({ page }) => {
            await page.setViewportSize({ width, height: 900 })
            const s = await setup(page)
            await page.goto("/dashboard/settings/icons")
            for (let cycle = 0; cycle < 4; cycle++) {
            await page.getByRole("button", { name: "新建分组", exact: true }).click()
            await page.getByLabel("分组名称", { exact: true }).fill("未保存分组")
            await page.getByRole("dialog").press("Escape")
            await page.getByRole("button", { name: "继续编辑", exact: true }).click()
            await expect(page.getByLabel("分组名称", { exact: true })).toHaveValue("未保存分组")
            await page.getByRole("dialog").press("Escape")
            await page.getByRole("button", { name: "放弃修改并离开", exact: true }).click()
            await expect(page.getByRole("dialog")).toHaveCount(0)
            }
            await page.getByLabel("选择 测试厂商1", { exact: true }).check()
            s.fail(true)
            page.once("dialog", (d) => d.accept())
            await page.getByRole("button", { name: "移动分组", exact: true }).click()
            await expect(page.getByRole("alert")).toContainText("configuration changed")
            await expect(page.getByLabel("选择 测试厂商1", { exact: true })).toBeChecked()
            await expect(page.getByRole("button", { name: "移动分组", exact: true })).toBeEnabled()
            expect(s.errors).toEqual([])
        },
    )
}
test("member cannot open privileged appearance or icon editor", async ({ page }) => {
    const s = await setup(page, 1)
    for (const route of ["appearance", "dashboard-appearance", "icons"]) {
        await page.goto("/dashboard/settings/" + route)
        await expect(page).toHaveURL(/api-tokens$/)
    }
    expect(s.writes).toHaveLength(0)
})
