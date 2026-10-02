import { type Page, expect, test } from "@playwright/test"

const original = {
    id: 4,
    name: "TCP超级报警",
    enable: true,
    notification_group_id: 1,
    trigger_mode: 0,
    fail_trigger_tasks: [9],
    recover_trigger_tasks: [],
    rules: [
        {
            type: "tcp_conn_count",
            max: 3000,
            duration: 60,
            cover: 0,
            ignore: { "1": true, "2": false, "99": true },
        },
    ],
}
const cycle = {
    ...original,
    id: 7,
    name: "月流量统计",
    trigger_mode: 1,
    fail_trigger_tasks: [],
    rules: [
        {
            type: "transfer_all_cycle",
            max: 1099511627776,
            cycle_start: "2025-05-31T16:00:00Z",
            cycle_interval: 1,
            cycle_unit: "month",
            cover: 0,
        },
    ],
}
async function setup(page: Page, initial: any = original) {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "zh-CN"))
    const writes: any[] = []
    let row = structuredClone(initial)
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/notification-group")
            data = [{ group: { id: 1, name: "TG" }, notifications: [5] }]
        if (path === "/api/v1/server")
            data = [
                { id: 1, name: "一号服务器" },
                { id: 2, name: "二号服务器" },
            ]
        if (path === "/api/v1/cron")
            data = [
                { id: 9, name: "重启任务", task_type: 1 },
                { id: 10, name: "定时任务", task_type: 0 },
            ]
        if (path === "/api/v1/alert-rule") data = [row]
        if (path.startsWith("/api/v1/alert-rule/") && route.request().method() === "PATCH") {
            const payload = route.request().postDataJSON()
            writes.push(payload)
            row = { ...row, ...payload }
            data = row.id
        }
        await route.fulfill({ json: { success: true, data } })
    })
    await page.goto("/dashboard/alert-rule")
    await page.getByRole("button", { name: "编辑警报规则 " + initial.name, exact: true }).click()
    return writes
}
for (const width of [360, 390, 430, 1366])
    test("visual rule editor and no-op round trip " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        const errors: string[] = []
        page.on("pageerror", (e) => errors.push(e.message))
        const writes = await setup(page)
        const dialog = page.getByRole("dialog")
        await expect(dialog.getByLabel("监控指标", { exact: true })).toHaveValue("tcp_conn_count")
        await expect(dialog.getByLabel("报警上限（高于时）")).toHaveValue("3000")
        await expect(dialog.getByLabel("检测窗口（秒）", { exact: true })).toHaveValue("180")
        await expect(dialog.getByLabel("启用此警报规则")).toBeChecked()
        await expect(dialog.getByLabel("规则实时预览")).toContainText("资源告警（告警 / 恢复）")
        await dialog.getByRole("button", { name: "高级 JSON", exact: true }).click()
        expect(JSON.parse(await dialog.getByLabel("规则 JSON").inputValue())).toEqual(
            original.rules,
        )
        await dialog.getByRole("button", { name: "可视化编辑", exact: true }).click()
        await dialog.getByRole("heading", { name: "基本设置" }).scrollIntoViewIfNeeded()
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true)
        await page.screenshot({ path: "test-results/alert-editor-" + width + ".png" })
        await dialog.getByRole("button", { name: "保存警报规则", exact: true }).click()
        await expect(dialog).toHaveCount(0)
        expect(writes).toEqual([
            {
                name: original.name,
                enable: true,
                rules: original.rules,
                notification_group_id: 1,
                trigger_mode: 0,
                fail_trigger_tasks: [9],
                recover_trigger_tasks: [],
            },
        ])
        expect(errors).toEqual([])
    })
test("visual scope, thresholds, tasks and AND conditions", async ({ page }) => {
    const writes = await setup(page)
    const d = page.getByRole("dialog")
    await d.getByLabel("报警上限（高于时）").fill("4000")
    await d.getByLabel("适用服务器", { exact: true }).selectOption("1")
    await d.getByText("选择监控服务器 · 已选 2 项", { exact: true }).click()
    await d.getByLabel("二号服务器 #2", { exact: true }).check()
    await d.getByLabel("一号服务器 #1", { exact: true }).uncheck()
    await d.getByText("报警时触发的任务 · 已选 1 项", { exact: true }).click()
    await d.getByRole("checkbox", { name: "重启任务 #9", exact: true }).uncheck()
    await expect(d.getByText("定时任务 #10", { exact: true })).toHaveCount(0)
    await d.getByLabel("快速添加条件", { exact: true }).selectOption("memory")
    await d.getByRole("button", { name: "添加条件", exact: true }).click()
    await expect(d.getByTestId("alert-condition")).toHaveCount(2)
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].rules[0]).toEqual({
        ...original.rules[0],
        max: 4000,
        cover: 1,
        ignore: { "2": true, "99": true },
    })
    expect(writes[0].rules[1]).toEqual({ type: "memory", cover: 0, duration: 10, max: 80 })
    expect(writes[0].fail_trigger_tasks).toEqual([])
})
test("invalid JSON cannot silently save old rules; cancel resets", async ({ page }) => {
    const writes = await setup(page)
    const d = page.getByRole("dialog")
    await d.getByRole("button", { name: "高级 JSON", exact: true }).click()
    await d.getByLabel("规则 JSON").fill("[null]")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toBeVisible()
    expect(writes).toEqual([])
    await d.getByRole("button", { name: "取消", exact: true }).click()
    await page.getByRole("button", { name: "编辑警报规则 TCP超级报警", exact: true }).click()
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("3000")
    await d.getByRole("button", { name: "高级 JSON", exact: true }).click()
    const custom = [{ ...original.rules[0], max: 4567, extra: { preserve: true } }]
    await d.getByLabel("规则 JSON").fill(JSON.stringify(custom))
    await d.getByRole("button", { name: "可视化编辑", exact: true }).click()
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("4567")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].rules).toEqual(custom)
})
test("cycle bytes and Beijing time retain exact values on no-op", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    const writes = await setup(page, cycle)
    const d = page.getByRole("dialog")
    await expect(d.getByLabel("周期开始时间（北京时间 UTC+8）")).toHaveValue("2025-06-01T00:00")
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("1")
    await d.getByLabel("阈值单位", { exact: true }).selectOption(String(1024 ** 3))
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("1024")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].rules).toEqual(cycle.rules)
})
test("cycle editor uses Beijing time, not the browser timezone", async ({ browser }) => {
    const context = await browser.newContext({
        timezoneId: "America/New_York",
        viewport: { width: 390, height: 900 },
    })
    const page = await context.newPage()
    const writes = await setup(page, cycle)
    const d = page.getByRole("dialog")
    await d.getByLabel("周期开始时间（北京时间 UTC+8）").fill("2025-06-01T16:25:30")
    await d.getByLabel("报警上限（高于时）").fill("2")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].rules[0]).toEqual({
        ...cycle.rules[0],
        max: 2 * 1024 ** 4,
        cycle_start: "2025-06-01T16:25:30+08:00",
    })
    await context.close()
})
test("create offline rule defaults disabled, validates empty rules and posts chosen group", async ({
    page,
}) => {
    await setup(page)
    await page.getByRole("button", { name: "取消", exact: true }).click()
    const writes: any[] = []
    await page.route("**/api/v1/alert-rule", async (route) => {
        if (route.request().method() === "POST") writes.push(route.request().postDataJSON())
        await route.fulfill({
            json: { success: true, data: route.request().method() === "POST" ? 8 : [original] },
        })
    })
    await page.getByRole("button", { name: "创建警报规则", exact: true }).click()
    const d = page.getByRole("dialog")
    await expect(d.getByLabel("启用此警报规则")).not.toBeChecked()
    await d.getByLabel("规则名称", { exact: true }).fill("离线测试")
    await d.getByLabel("通知组", { exact: true }).selectOption("1")
    await d.getByRole("button", { name: "删除条件 1", exact: true }).click()
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    expect(writes).toEqual([])
    await d.getByLabel("快速添加条件", { exact: true }).selectOption("offline")
    await d.getByRole("button", { name: "添加条件", exact: true }).click()
    await d.getByLabel("连续离线检测窗口（秒）").fill("30")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0]).toMatchObject({
        name: "离线测试",
        enable: false,
        notification_group_id: 1,
        rules: [{ type: "offline", cover: 0, duration: 10 }],
    })
})
test("server loading and save failures keep original scope and draft", async ({ page }) => {
    await setup(page)
    const d = page.getByRole("dialog")
    await page.route("**/api/v1/alert-rule/4", (r) =>
        r.fulfill({ status: 500, json: { success: false, error: "保存失败测试" } }),
    )
    await d.getByLabel("报警上限（高于时）").fill("4567")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d.getByRole("alert")).toBeVisible()
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("4567")
    await expect(d.getByRole("button", { name: "保存警报规则", exact: true })).toBeEnabled()
    await d.getByRole("button", { name: "高级 JSON", exact: true }).click()
    expect(JSON.parse(await d.getByLabel("规则 JSON").inputValue())[0].ignore).toEqual(
        original.rules[0].ignore,
    )
})

test("duration seconds are converted once and invalid intervals cannot save", async ({ page }) => {
    const writes = await setup(page)
    const d = page.getByRole("dialog")
    await d.getByLabel("检测窗口（秒）", { exact: true }).fill("31")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    expect(writes).toEqual([])
    await expect(d.getByRole("alert")).toContainText("3 秒的整数倍")
    await d.getByLabel("检测窗口（秒）", { exact: true }).fill("60")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].rules[0].duration).toBe(20)
    await page.getByRole("button", { name: "编辑警报规则 TCP超级报警", exact: true }).click()
    await expect(d.getByLabel("检测窗口（秒）", { exact: true })).toHaveValue("60")
    await d.getByRole("button", { name: "高级 JSON", exact: true }).click()
    expect(JSON.parse(await d.getByLabel("规则 JSON").inputValue())[0].duration).toBe(20)
})
test("metric switch confirms, preserves matching units and warns on incompatible units", async ({
    page,
}) => {
    const writes = await setup(page)
    const d = page.getByRole("dialog")
    await d.getByLabel("监控指标", { exact: true }).selectOption("udp_conn_count")
    await expect(d.getByLabel("监控指标", { exact: true })).toHaveValue("tcp_conn_count")
    await d.getByRole("button", { name: "取消切换", exact: true }).click()
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("3000")
    await d.getByLabel("监控指标", { exact: true }).selectOption("udp_conn_count")
    await d.getByRole("button", { name: "确认切换指标", exact: true }).click()
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("3000")
    await expect(d.getByLabel("检测窗口（秒）", { exact: true })).toHaveValue("180")
    await d.getByLabel("监控指标", { exact: true }).selectOption("cpu")
    await d.getByRole("button", { name: "确认切换指标", exact: true }).click()
    await expect(d.getByLabel("报警上限（高于时）")).toHaveValue("")
    await expect(d.getByText("尚未设置有效阈值", { exact: false })).toBeVisible()
    await d.getByLabel("报警上限（高于时）").fill("80")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].rules[0]).toEqual({ ...original.rules[0], type: "cpu", max: 80 })
})
test("contradictory thresholds blocked in visual and raw editors", async ({ page }) => {
    const writes = await setup(page)
    const d = page.getByRole("dialog")
    await d.getByLabel("报警下限（低于时）").fill("5000")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d.getByRole("alert")).toContainText("下限必须小于")
    expect(writes).toEqual([])
    await d.getByRole("button", { name: "高级 JSON", exact: true }).click()
    await d.getByLabel("规则 JSON").fill(JSON.stringify([{ ...original.rules[0], min: 3000 }]))
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    expect(writes).toEqual([])
    await d.getByLabel("规则 JSON").fill(JSON.stringify([{ ...original.rules[0], min: 100 }]))
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    await expect(d).toHaveCount(0)
    expect(writes[0].rules[0].min).toBe(100)
})

for (const normalize of [false, true]) for (const width of [390, 1366]) test(`selection count updates immediately ${width} normalize=${normalize}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const writes = await setup(page)
    const d = page.getByRole("dialog")
    const selection = d.locator("details").filter({ has: page.locator("summary", { hasText: "选择排除服务器" }) })
    const summary = selection.locator("summary")
    await expect(summary).toHaveText("选择排除服务器 · 已选 2 项")
    await summary.click()
    if (normalize) await summary.evaluate((el) => el.normalize())
    await selection.getByLabel("二号服务器 #2", { exact: true }).check()
    await expect(summary).toHaveText("选择排除服务器 · 已选 3 项")
    if (normalize) await summary.evaluate((el) => el.normalize())
    await expect(selection.locator("p").first()).toContainText("二号服务器 #2")
    await selection.getByLabel("一号服务器 #1", { exact: true }).uncheck()
    await expect(summary).toHaveText("选择排除服务器 · 已选 2 项")
    await expect(selection.locator("p").first()).not.toContainText("一号服务器 #1")
    await selection.getByRole("textbox").fill("二号")
    await expect(summary).toHaveText("选择排除服务器 · 已选 2 项")
    await selection.getByLabel("二号服务器 #2", { exact: true }).uncheck()
    await expect(summary).toHaveText("选择排除服务器 · 已选 1 项")
    await d.getByRole("button", { name: "保存警报规则", exact: true }).click()
    expect(writes[0].rules[0].ignore).toEqual({ "99": true })
    await page.getByRole("button", { name: "编辑警报规则 TCP超级报警", exact: true }).click()
    await expect(d.locator("summary", { hasText: "选择排除服务器" })).toHaveText("选择排除服务器 · 已选 1 项")
})
