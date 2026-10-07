import { Locator, Page, expect, test } from "@playwright/test"

async function selectEvent(modules: Locator, kind: string) {
    const paired: Record<string, [string, string]> = {
        offline: ["server", "离线"],
        online: ["server", "上线"],
        alert: ["resource", "告警"],
        alert_recovery: ["resource", "恢复"],
        service_alert: ["service", "异常"],
        service_recovery: ["service", "恢复"],
        task_success: ["task", "成功"],
        task_failure: ["task", "失败"],
        ddns_success: ["ddns", "成功"],
        ddns_failure: ["ddns", "失败"],
    }
    const pair = paired[kind]
    await modules.getByLabel("事件类型", { exact: true }).selectOption(pair?.[0] ?? kind)
    if (pair)
        await modules
            .getByRole("group", { name: "通知状态" })
            .getByRole("button", { name: pair[1], exact: true })
            .click()
}

const token = "123:fixture_token"
const notification = {
    id: 7,
    name: "TG 测试",
    url: "https://api.telegram.org/bot" + token + "/sendMessage",
    request_method: 2,
    request_type: 1,
    request_header: '{"X-Preserve":"fixture"}',
    request_body: JSON.stringify({
        chat_id: "-100123",
        text: "#NEZHA#",
        custom: "keep",
        reply_markup: { inline_keyboard: [] },
    }),
    verify_tls: true,
    format_metric_units: true,
}
async function fixture(page: Page, deny = false, failSave = false, raw = false) {
    let current = {
            ...notification,
            ...(raw
                ? { url: "https://hooks.example/notify", request_body: '{"custom":"#NEZHA#"}' }
                : {}),
        },
        reads = 0
    const writes: any[] = [],
        errors: string[] = [],
        external: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.route("https://api.telegram.org/**", (route) => {
        external.push(route.request().url())
        return route.abort()
    })
    let ddnsProfile = {
        id: 9,
        name: "DDNS fixture",
        provider: "dummy",
        domains: ["example.com"],
        enable_ipv4: true,
        enable_ipv6: false,
        max_retries: 3,
        notification_group_id: 0,
        access_id: "",
        access_secret: "",
        webhook_url: "",
        webhook_headers: "",
        webhook_request_body: "",
    }
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname,
            method = route.request().method()
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
        if (path === "/api/v1/server") data = [{ id: 12, name: "指定测试服务器" }]
        if (path === "/api/v1/ddns") data = [ddnsProfile]
        if (path === "/api/v1/ddns/providers") data = ["dummy", "cloudflare"]
        if (path === "/api/v1/ddns/9" && method === "PATCH") {
            const body = route.request().postDataJSON()
            writes.push(body)
            ddnsProfile = { ...ddnsProfile, ...body }
            data = 9
        }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/notification")
            data = [{ ...current, url: "", request_header: "", request_body: "" }]
        if (path === "/api/v1/notification/7/editor") {
            reads++
            if (deny) return route.fulfill({ json: { success: false, error: "permission denied" } })
            data = current
        }
        if (path === "/api/v1/notification-group")
            data = [{ group: { id: 3, name: "运维通知组" }, notifications: [7] }]
        if (path === "/api/v1/alert-rule")
            data = [
                {
                    id: 4,
                    name: "CPU 高负载",
                    notification_group_id: 3,
                    enable: true,
                    trigger_mode: 1,
                },
            ]
        if (
            (path === "/api/v1/notification" && method === "POST") ||
            (path === "/api/v1/notification/7" && method === "PATCH")
        ) {
            writes.push(route.request().postDataJSON())
            if (failSave)
                return route.fulfill({
                    json: {
                        success: false,
                        error: "400@Bad Request https://api.telegram.org/bot123:SECRET/sendMessage",
                    },
                })
            current = { ...current, ...writes.at(-1) }
            data = 7
        }
        await route.fulfill({ json: { success: true, data } })
    })
    return { writes, errors, external, reads: () => reads }
}
for (const width of [1366, 390]) {
    test("Telegram visual editor roundtrip " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 950 })
        const state = await fixture(page)
        await page.goto("/dashboard/notification")
        expect(state.reads()).toBe(0)
        await page.getByRole("button", { name: "编辑通知", exact: true }).click()
        const dialog = page.getByRole("dialog")
        await expect(dialog.getByLabel("Bot Token", { exact: true })).toHaveValue(token)
        await expect(dialog.getByLabel("Bot Token", { exact: true })).toHaveAttribute(
            "type",
            "password",
        )
        await expect(dialog.getByLabel("Chat ID / 频道", { exact: true })).toHaveValue("-100123")
        await expect(dialog.getByLabel("TG 发送逻辑")).toContainText("运维通知组")
        await expect(dialog.getByLabel("TG 发送逻辑")).toContainText(
            "CPU 高负载 · 已启用 · 单次触发",
        )
        await dialog
            .getByLabel("TG 消息模板")
            .fill("🔔 #NEZHA#\n#SERVER.NAME# #SERVER.MEM# #UNKNOWN#")
        await expect(dialog.locator("[data-telegram-message]")).toContainText("示例服务器")
        await expect(dialog.locator("[data-telegram-message]")).not.toContainText("#SERVER.NAME#")
        await dialog.getByRole("button", { name: "保存测试", exact: true }).click()
        await expect(dialog.locator("[data-telegram-message]")).toContainText("#SERVER.NAME#")
        await expect(dialog.getByLabel("TG 通知预览")).toContainText("未识别变量")
        await dialog.getByRole("button", { name: "恢复", exact: true }).click()
        await expect(dialog.locator("[data-telegram-message]")).toContainText("恢复正常")
        await dialog.getByLabel("TG 消息格式").selectOption("HTML")
        await dialog
            .getByLabel("TG 消息模板")
            .fill(
                '<b>#NEZHA#</b><img src="https://api.telegram.org/leak"><script>window.__xss=1</script>',
            )
        await expect(dialog.locator("[data-telegram-message] img")).toHaveCount(0)
        expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
        await dialog.getByLabel("TG 消息格式").selectOption("")
        await dialog.getByLabel("TG 消息模板").fill("↓#SERVER.NETINSPEED# | ↑#SERVER.NETOUTSPEED#")
        await dialog.getByRole("button", { name: "改用 Mbps 网速", exact: true }).click()
        await expect(dialog.getByLabel("TG 消息模板")).toHaveValue(
            "↓#SERVER.SPEEDIN# | ↑#SERVER.SPEEDOUT#",
        )
        await expect(dialog.locator("[data-telegram-message]")).toContainText("8.39 Mbps")
        await dialog.getByLabel("TG 消息模板").fill("通知：#NEZHA#\n时间：#DATETIME#")
        expect(state.writes).toHaveLength(0)
        expect(state.external).toHaveLength(0)
        await dialog.getByLabel("TG 消息模板").scrollIntoViewIfNeeded()
        await page.screenshot({
            path: "test-results/tg-editor-" + width + ".png",
            animations: "disabled",
        })
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
        await dialog.getByRole("button", { name: "仅保存", exact: true }).click()
        await expect(dialog).toHaveCount(0)
        expect(state.writes).toHaveLength(1)
        expect(state.writes[0].skip_check).toBe(true)
        expect(state.writes[0].test_event).toBeUndefined()
        expect(state.writes[0].request_header).toBe(notification.request_header)
        expect(JSON.parse(state.writes[0].request_body)).toMatchObject({
            chat_id: "-100123",
            custom: "keep",
            reply_markup: { inline_keyboard: [] },
            text: "通知：#NEZHA#\n时间：#DATETIME#",
        })
        await page.getByRole("button", { name: "编辑通知", exact: true }).click()
        await expect(dialog.getByLabel("TG 消息模板")).toHaveValue(
            "通知：#NEZHA#\n时间：#DATETIME#",
        )
        expect(state.errors).toEqual([])
    })
}
test("Telegram create and explicit save test failure are visible", async ({ page }) => {
    const state = await fixture(page, false, true)
    await page.goto("/dashboard/notification")
    await page.getByRole("button", { name: "添加通知", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByPlaceholder("My Notifier").fill("新 TG")
    await dialog.getByLabel("Bot Token", { exact: true }).fill(token)
    await dialog.getByLabel("Chat ID / 频道", { exact: true }).fill("-100999")
    await dialog.getByRole("checkbox", { name: "不发送测试消息", exact: true }).uncheck()
    await expect(dialog).toContainText("一条真实测试消息")
    await dialog.getByRole("button", { name: "发送测试并保存", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("Telegram 拒绝")
    await expect(dialog).not.toContainText("SECRET")
    expect(state.writes[0].skip_check).toBe(false)
    expect(state.writes[0].test_event).toEqual({ kind: "offline", server_id: 0 })
    expect(state.external).toEqual([])
    expect(state.errors).toEqual([])
})
test("Denied editor cannot overwrite redacted existing configuration", async ({ page }) => {
    const state = await fixture(page, true)
    await page.goto("/dashboard/notification")
    await page.getByRole("button", { name: "编辑通知", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("alert")).toContainText("无法读取配置")
    await expect(dialog.getByRole("button", { name: "发送测试并保存", exact: true })).toBeDisabled()
    expect(state.writes).toEqual([])
})

test("Generic webhook keeps raw request and existing save-test semantics", async ({ page }) => {
    const state = await fixture(page, false, false, true)
    await page.goto("/dashboard/notification")
    await page.getByRole("button", { name: "编辑通知", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.locator("[data-telegram-editor]")).toHaveCount(0)
    await expect(dialog.getByLabel("URL", { exact: true })).toHaveValue(
        "https://hooks.example/notify",
    )
    await expect(
        dialog.getByRole("checkbox", { name: "不发送测试消息", exact: true }),
    ).not.toBeChecked()
    await dialog.getByRole("checkbox", { name: "不发送测试消息", exact: true }).check()
    await dialog.getByRole("button", { name: "仅保存", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(state.writes[0]).toMatchObject({
        url: "https://hooks.example/notify",
        request_body: '{"custom":"#NEZHA#"}',
        request_header: notification.request_header,
        request_method: 2,
        request_type: 1,
        skip_check: true,
    })
    expect(state.external).toEqual([])
    expect(state.errors).toEqual([])
})

for (const width of [1366, 390]) {
    test("event modules independent roundtrip " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 950 })
        const state = await fixture(page)
        await page.goto("/dashboard/notification")
        await page.getByRole("button", { name: "编辑通知", exact: true }).click()
        const dialog = page.getByRole("dialog")
        const modules = dialog.getByLabel("事件通知模块", { exact: true })
        await modules.getByLabel("按事件分别设置通知内容").check()
        await expect(modules.getByLabel("事件类型", { exact: true }).locator("option")).toHaveCount(
            9,
        )
        await expect(modules.getByLabel("事件类型", { exact: true })).toHaveValue("server")
        await expect(
            modules.getByRole("group", { name: "通知状态" }).getByRole("button"),
        ).toHaveText(["离线", "上线"])
        await selectEvent(modules, "alert")
        await expect(modules.locator("[data-event-preview]")).toContainText("资源告警")
        const alertPreview = await modules.locator("[data-event-preview]").innerText()
        await selectEvent(modules, "alert_recovery")
        expect(await modules.locator("[data-event-preview]").innerText()).not.toBe(alertPreview)
        await selectEvent(modules, "offline")
        await expect(modules.locator("[data-event-preview]")).toContainText("🔴 服务器离线")
        await selectEvent(modules, "online")
        await expect(modules.locator("[data-event-preview]")).toContainText("🟢 服务器上线")
        await expect(modules.locator("[data-event-preview]")).not.toContainText("离线")
        await modules.getByLabel("事件通知标题", { exact: true }).fill("✅ 已上线")
        await modules.getByLabel("TCP 连接数", { exact: true }).check()
        await modules.getByLabel("UDP 连接数", { exact: true }).check()
        await expect(modules.locator("[data-event-preview]")).toContainText("TCP 连接数：16")
        await expect(modules.locator("[data-event-preview]")).toContainText("UDP 连接数：4")
        await modules.getByLabel("实时网速", { exact: true }).check()
        await expect(modules.locator("[data-event-preview]")).toContainText("8.39 Mbps")
        await modules.getByLabel("IP 地址", { exact: true }).uncheck()
        await expect(modules.locator("[data-event-preview]")).not.toContainText("IP：")
        await modules.getByLabel("事件类型", { exact: true }).selectOption("ip_change")
        await expect(modules.locator("[data-event-preview]")).toContainText("旧 IP：")
        await expect(modules.locator("[data-event-preview]")).toContainText("新 IP：")
        await expect(modules.getByLabel("历史 IP（最近 7 次）", { exact: true })).toBeChecked()
        await expect(modules.locator("[data-event-preview]")).toContainText("7. 192.0.2.")
        await modules.getByLabel("历史 IP（最近 7 次）", { exact: true }).uncheck()
        await expect(modules.locator("[data-event-preview]")).not.toContainText("历史 IP")
        await modules.getByLabel("历史 IP（最近 7 次）", { exact: true }).check()
        await modules.getByLabel("原 IP 地址", { exact: true }).uncheck()
        await expect(modules.locator("[data-event-preview]")).not.toContainText("旧 IP：")
        await selectEvent(modules, "task_success")
        await modules.getByLabel("事件处理方式", { exact: true }).selectOption("disabled")
        await expect(modules.locator("[data-event-preview]")).toContainText("不发送消息")
        await modules.getByLabel("事件类型", { exact: true }).selectOption("tls")
        await modules.getByLabel("事件处理方式", { exact: true }).selectOption("inherit")
        await expect(modules.locator("[data-event-preview]")).toContainText("沿用下面的通用模板")
        await selectEvent(modules, "online")
        await modules.scrollIntoViewIfNeeded()
        await page.screenshot({
            path: "test-results/tg-modules-" + width + ".png",
            animations: "disabled",
        })
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
        await dialog.getByRole("button", { name: "仅保存", exact: true }).click()
        await expect(dialog).toHaveCount(0)
        expect(state.writes).toHaveLength(1)
        const saved = state.writes[0].event_templates
        expect(saved.modules.online.title).toBe("✅ 已上线")
        expect(saved.modules.online.fields).not.toContain("ip")
        expect(saved.modules.offline.fields).toContain("ip")
        expect(saved.modules.ip_change.fields).not.toContain("old_ip")
        expect(saved.modules.task_success.mode).toBe("disabled")
        expect(saved.modules.tls.mode).toBe("inherit")
        expect(state.writes[0].request_body).toBe(notification.request_body)
        expect(state.writes[0].skip_check).toBe(true)
        expect(state.writes[0].test_event).toBeUndefined()
        await page.getByRole("button", { name: "编辑通知", exact: true }).click()
        await expect(modules.getByLabel("按事件分别设置通知内容")).toBeChecked()
        await selectEvent(modules, "online")
        await expect(modules.getByLabel("事件通知标题", { exact: true })).toHaveValue("✅ 已上线")
        await modules.getByLabel("按事件分别设置通知内容").uncheck()
        await expect(dialog.getByLabel("TG 消息模板", { exact: true })).toHaveValue("#NEZHA#")
        await dialog.getByRole("button", { name: "仅保存", exact: true }).click()
        expect(state.writes[1].event_templates.enabled).toBe(false)
        expect(state.writes[1].event_templates.modules.online.title).toBe("✅ 已上线")
        expect(state.external).toHaveLength(0)
        expect(state.errors).toHaveLength(0)
    })
}

for (const width of [1366, 390]) {
    test("DDNS notification group save and reload " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 950 })
        const state = await fixture(page)
        await page.goto("/dashboard/ddns")
        await page.getByRole("button", { name: "编辑 DDNS", exact: true }).click()
        const dialog = page.getByRole("dialog")
        await expect(dialog.getByLabel("DDNS 结果通知组")).toHaveValue("0")
        await dialog.getByLabel("DDNS 结果通知组").selectOption("3")
        await dialog.locator('button[type="submit"]').click()
        await expect(dialog).toHaveCount(0)
        expect(state.writes).toHaveLength(1)
        expect(state.writes[0].notification_group_id).toBe(3)
        expect(state.writes[0].domains).toEqual(["example.com"])
        await page.getByRole("button", { name: "编辑 DDNS", exact: true }).click()
        await expect(dialog.getByLabel("DDNS 结果通知组")).toHaveValue("3")
        await dialog.getByLabel("DDNS 结果通知组").selectOption("0")
        await dialog.locator('button[type="submit"]').click()
        expect(state.writes[1].notification_group_id).toBe(0)
        await page.goto("/dashboard/notification")
        await page.getByRole("button", { name: "编辑通知", exact: true }).click()
        const modules = dialog.getByLabel("事件通知模块", { exact: true })
        await modules.getByLabel("按事件分别设置通知内容").check()
        for (const kind of ["ddns_success", "ddns_failure"]) {
            await selectEvent(modules, kind)
            await expect(modules.locator("[data-event-preview]")).toContainText("域名：example.com")
            await expect(modules.locator("[data-event-preview]")).toContainText("记录类型：A")
            await expect(modules.locator("[data-event-preview]")).toContainText(
                kind === "ddns_success" ? "更新请求执行成功" : "已用尽重试次数",
            )
        }
        await modules.getByLabel("目标 IP", { exact: true }).uncheck()
        await expect(modules.locator("[data-event-preview]")).not.toContainText("目标 IP：")
        await modules.scrollIntoViewIfNeeded()
        await page.screenshot({
            path: "test-results/tg-ddns-" + width + ".png",
            animations: "disabled",
        })
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
        expect(state.external).toHaveLength(0)
        expect(state.errors).toHaveLength(0)
    })
}

for (const width of [1366, 390]) {
    test("selected event test uses draft state and selected data " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 950 })
        const state = await fixture(page)
        await page.goto("/dashboard/notification")
        await page.getByRole("button", { name: "编辑通知", exact: true }).click()
        const dialog = page.getByRole("dialog")
        const modules = dialog.getByLabel("事件通知模块", { exact: true })
        await modules.getByLabel("按事件分别设置通知内容").check()
        await selectEvent(modules, "online")
        await modules.getByLabel("事件通知标题", { exact: true }).fill("自定义上线标题")
        await dialog.getByRole("checkbox", { name: "不发送测试消息", exact: true }).uncheck()
        await expect(dialog.getByLabel("测试事件", { exact: true })).toHaveValue("online")
        await expect(dialog.getByLabel("测试数据", { exact: true })).toHaveValue("0")
        await dialog.getByLabel("测试数据", { exact: true }).selectOption("12")
        await dialog.getByLabel("测试事件", { exact: true }).selectOption("ddns_failure")
        await expect(modules.getByLabel("事件类型", { exact: true })).toHaveValue("ddns")
        await expect(modules.getByRole("button", { name: "失败", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        )
        await dialog.getByLabel("测试事件", { exact: true }).selectOption("online")
        await modules.getByLabel("事件处理方式", { exact: true }).selectOption("disabled")
        await dialog.getByRole("button", { name: "发送测试并保存", exact: true }).click()
        await expect(dialog.getByRole("alert")).toContainText("当前状态设为不发送")
        expect(state.writes).toHaveLength(0)
        await modules.getByLabel("事件处理方式", { exact: true }).selectOption("fields")
        await dialog.getByLabel("发送测试设置").scrollIntoViewIfNeeded()
        await page.screenshot({
            path: "test-results/tg-event-test-" + width + ".png",
            animations: "disabled",
        })
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
        await dialog.getByRole("button", { name: "发送测试并保存", exact: true }).click()
        await expect(dialog).toHaveCount(0)
        expect(state.writes[0].test_event).toEqual({ kind: "online", server_id: 12 })
        expect(state.writes[0].event_templates.modules.online.title).toBe("自定义上线标题")
        expect(state.writes[0].skip_check).toBe(false)
        expect(state.external).toHaveLength(0)
        expect(state.errors).toHaveLength(0)
    })
}
