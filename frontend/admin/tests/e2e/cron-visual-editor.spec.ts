import { type Page, expect, test } from "@playwright/test"

const original = {
    id: 7,
    name: "每日巡检",
    task_type: 0,
    scheduler: "0 0 3 * * *",
    command: "df -h",
    servers: [1, 99],
    cover: 0,
    notification_group_id: 4,
    push_successful: true,
    last_executed_at: "0001-01-01T00:00:00Z",
    last_result: false,
}
async function setup(page: Page, initial = original) {
    const writes: { path: string; body: any }[] = []
    const previews: string[] = []
    let row = { ...initial }
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "zh-CN"))
    await page.route("**/api/v1/**", async (route) => {
        const request = route.request(),
            path = new URL(request.url()).pathname
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "preview", role: 0 }
        if (path === "/api/v1/setting")
            data = { config: { language: "zh-CN", site_name: "测试面板" }, version: "preview" }
        if (path === "/api/v1/server")
            data = [
                { id: 1, name: "香港服务器" },
                { id: 2, name: "日本服务器" },
            ]
        if (path === "/api/v1/notification-group")
            data = [{ group: { id: 4, name: "运维通知" }, notifications: [] }]
        if (path === "/api/v1/cron/preview") {
            const spec = request.postDataJSON().scheduler
            previews.push(spec)
            if (spec === "invalid") {
                await route.fulfill({ json: { success: false, error: "无效 Cron" } })
                return
            }
            data = {
                timezone: "Asia/Shanghai",
                next: [
                    "2026-10-05T03:00:00+08:00",
                    "2026-10-06T03:00:00+08:00",
                    "2026-10-07T03:00:00+08:00",
                    "2026-10-08T03:00:00+08:00",
                    "2026-10-09T03:00:00+08:00",
                ],
            }
        } else if (request.method() !== "GET" && path !== "/api/v1/refresh-token") {
            const body = request.postDataJSON()
            writes.push({ path, body })
            if (path === "/api/v1/cron/7") row = { ...row, ...body }
            data = 7
        }
        if (path === "/api/v1/cron" && request.method() === "GET") data = [row]
        await route.fulfill({ json: { success: true, data } })
    })
    await page.goto("/dashboard/cron")
    await expect(page.getByRole("button", { name: "编辑任务 " + initial.name })).toBeVisible()
    return { writes, previews }
}

for (const width of [320, 390, 768, 1366])
    test("responsive visual editor and lossless save " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 850 })
        const errors: string[] = []
        page.on("pageerror", (e) => errors.push(e.message))
        const { writes } = await setup(page)
        await page.screenshot({ path: "test-results/cron-list-" + width + ".png" })
        await page.getByRole("button", { name: "编辑任务 每日巡检" }).click()
        const d = page.getByRole("dialog")
        await expect(d.getByLabel("执行周期")).toHaveValue("daily")
        await expect(d.getByLabel("执行时刻")).toHaveValue("03:00")
        await expect(d.getByText(/Asia\/Shanghai/)).toBeVisible()
        await expect(d.getByText("未加载或已移除的服务器", { exact: false }).first()).toBeVisible()
        expect(writes).toEqual([])
        expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        )
        const save = d.getByRole("button", { name: "保存任务" })
        await expect(save).toBeInViewport()
        await d.locator(".cron-form-scroll").evaluate((el) => {
            el.scrollTop = 0
        })
        await page.screenshot({ path: "test-results/cron-editor-" + width + ".png" })
        await save.click()
        await expect(d).toHaveCount(0)
        expect(writes).toEqual([
            {
                path: "/api/v1/cron/7",
                body: {
                    name: original.name,
                    task_type: 0,
                    scheduler: original.scheduler,
                    command: original.command,
                    servers: [1, 99],
                    cover: 0,
                    notification_group_id: 4,
                    push_successful: true,
                },
            },
        ])
        expect(errors).toEqual([])
    })

test("advanced schedule stays exact; invalid schedule blocks save and preserves draft", async ({
    page,
}) => {
    const spec = "CRON_TZ=UTC 30 0 3 * * 1-5"
    const { writes } = await setup(page, { ...original, scheduler: spec })
    await page.getByRole("button", { name: "编辑任务 每日巡检" }).click()
    const d = page.getByRole("dialog")
    await expect(d.getByLabel("执行周期")).toHaveValue("advanced")
    await expect(d.getByLabel("Cron 表达式")).toHaveValue(spec)
    await d.getByRole("button", { name: "保存任务" }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].body.scheduler).toBe(spec)
    await page.getByRole("button", { name: "编辑任务 每日巡检" }).click()
    await d.getByLabel("Cron 表达式").fill("invalid")
    await d.getByRole("button", { name: "保存任务" }).click()
    await expect(d.getByRole("alert")).toContainText("无效 Cron")
    expect(writes).toHaveLength(1)
    await expect(d.getByLabel("Cron 表达式")).toHaveValue("invalid")
    await d.getByRole("button", { name: "取消", exact: true }).click()
    await page.getByRole("button", { name: "编辑任务 每日巡检" }).click()
    await expect(d.getByLabel("Cron 表达式")).toHaveValue(spec)
})

test("visual weekly editing and exclude scope preserve meaning", async ({ page }) => {
    const { writes } = await setup(page)
    await page.getByRole("button", { name: "编辑任务 每日巡检" }).click()
    const d = page.getByRole("dialog")
    await d.getByLabel("执行周期").selectOption("weekly")
    await d.getByLabel("执行时刻").fill("08:30")
    await d.getByRole("button", { name: "周五", exact: true }).click()
    await d.getByLabel("覆盖范围").selectOption("1")
    await expect(d.getByText("可授权服务器，排除选中的 2 台", { exact: true })).toBeVisible()
    await d.getByRole("checkbox", { name: /日本服务器/ }).check()
    await d.getByRole("button", { name: "保存任务" }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].body).toMatchObject({
        scheduler: "0 30 8 * * 1,5",
        cover: 1,
        servers: [1, 99, 2],
    })
})

test("trigger tasks do not validate or overwrite their stored scheduler", async ({ page }) => {
    const { writes, previews } = await setup(page, {
        ...original,
        task_type: 1,
        cover: 2,
        scheduler: "legacy-unused",
    })
    await expect(page.getByRole("button", { name: "执行一次", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "编辑任务 每日巡检" }).click()
    const d = page.getByRole("dialog")
    await expect(d.getByLabel("执行周期")).toHaveCount(0)
    await d.getByRole("button", { name: "保存任务" }).click()
    await expect(d).toHaveCount(0)
    expect(previews).toEqual([])
    expect(writes[0].body).toMatchObject({ scheduler: "legacy-unused", cover: 2, servers: [1, 99] })
})

test("run and delete require explicit confirmation; browsing and cancellation never mutate", async ({
    page,
}) => {
    const { writes } = await setup(page)
    await page.getByRole("button", { name: "执行一次", exact: true }).click()
    await expect(page.getByRole("dialog")).toContainText("df -h")
    expect(writes).toEqual([])
    await page.getByRole("button", { name: "取消", exact: true }).click()
    expect(writes).toEqual([])
    await page.getByRole("button", { name: "执行一次", exact: true }).click()
    await page.getByRole("button", { name: "确认执行一次", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(writes).toEqual([{ path: "/api/v1/cron/7/manual", body: null }])
    await page.getByRole("button", { name: "删除任务 每日巡检" }).click()
    await expect(page.getByRole("dialog")).toContainText("无法撤销")
    expect(writes).toHaveLength(1)
    await page.getByRole("button", { name: "取消", exact: true }).click()
    await page.getByLabel("选择任务 每日巡检", { exact: true }).check()
    await page.getByRole("button", { name: "删除所选" }).click()
    await page.getByRole("button", { name: "确认删除", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(writes[1]).toEqual({ path: "/api/v1/batch-delete/cron", body: [7] })
})

test("new tasks validate server selection, retain failed save draft and never execute", async ({
    page,
}) => {
    const { writes } = await setup(page)
    await page.getByRole("button", { name: "新建任务", exact: true }).click()
    const d = page.getByRole("dialog")
    await d.getByLabel("任务名称", { exact: true }).fill("每小时巡检")
    await d.getByLabel("执行命令", { exact: true }).fill("df -h")
    await d.getByRole("button", { name: "保存任务" }).click()
    await expect(d.getByRole("alert")).toContainText("至少选择")
    expect(writes).toEqual([])
    await d.getByLabel("执行周期").selectOption("hourly")
    await d.getByLabel("每小时第几分钟").fill("15")
    await d.getByRole("checkbox", { name: /香港服务器/ }).check()
    await page.route("**/api/v1/cron", async (route) => {
        if (route.request().method() === "POST")
            await route.fulfill({ json: { success: false, error: "保存失败测试" } })
        else await route.fallback()
    })
    await d.getByRole("button", { name: "保存任务" }).click()
    await expect(d.getByRole("alert")).toContainText("保存失败测试")
    await expect(d.getByLabel("任务名称", { exact: true })).toHaveValue("每小时巡检")
    await expect(d.getByLabel("每小时第几分钟")).toHaveValue("15")
    await page.unroute("**/api/v1/cron")
    await d.getByRole("button", { name: "保存任务" }).click()
    await expect(d).toHaveCount(0)
    expect(writes).toEqual([
        {
            path: "/api/v1/cron",
            body: {
                name: "每小时巡检",
                task_type: 0,
                command: "df -h",
                scheduler: "0 15 * * * *",
                cover: 0,
                servers: [1],
                notification_group_id: 0,
                push_successful: false,
            },
        },
    ])
})

test("dark mode, short viewport, many servers and scoped search remain usable", async ({
    page,
}) => {
    await page.addInitScript(() => localStorage.setItem("nezha-dashboard-theme", "dark"))
    await page.setViewportSize({ width: 844, height: 390 })
    const { writes } = await setup(page)
    await page.route("**/api/v1/server", (route) =>
        route.fulfill({
            json: {
                success: true,
                data: Array.from({ length: 100 }, (_, i) => ({
                    id: i + 1,
                    name: "测试服务器" + (i + 1),
                })),
            },
        }),
    )
    await page.getByRole("button", { name: "编辑任务 每日巡检" }).click()
    const d = page.getByRole("dialog")
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expect(d.getByRole("button", { name: "保存任务" })).toBeInViewport()
    await expect(d.getByRole("checkbox", { name: /测试服务器100#100/ })).toHaveCount(1)
    await d.getByLabel(/选择服务器 · 已选/).fill("测试服务器100")
    await d.getByRole("checkbox", { name: /测试服务器100#100/ }).check()
    await expect(
        d.getByText(/已选：.*测试服务器1 #1.*测试服务器99 #99.*测试服务器100 #100/),
    ).toBeVisible()
    await page.screenshot({ path: "test-results/cron-dark-short.png" })
    expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.setViewportSize({ width: 390, height: 600 })
    await d.getByLabel("执行周期").selectOption("monthly")
    await d.getByLabel("每月几号").fill("31")
    await expect(d.getByText("没有该日期的月份会跳过执行，不会自动改为月末。")).toBeVisible()
    await page.screenshot({ path: "test-results/cron-dark-mobile.png" })
    await expect(d.getByRole("button", { name: "保存任务" })).toBeInViewport()
    await d.getByRole("button", { name: "取消", exact: true }).click()
    expect(writes).toEqual([])
})
