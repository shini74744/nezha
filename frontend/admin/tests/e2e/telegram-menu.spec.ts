import { type Page, expect, test } from "@playwright/test"

async function fixture(
    page: Page,
    options: { empty?: boolean; invalid?: boolean; role?: number; fail?: boolean } = {},
) {
    let current: any = {
        id: 7,
        name: "TG 私聊",
        eligible: !options.invalid,
        reason: options.invalid ? "请先将此 TG 通知配置为有效的机器人私聊通知。" : undefined,
        config: {
            enabled: true,
            expiry_days: 7,
            login_success: true,
            login_failure: true,
            login_failure_password: false,
            daily_traffic: true,
        },
        status: { state: "ready", message: "已连接" },
    }
    const writes: any[] = [],
        reads: string[] = [],
        errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.route("https://api.telegram.org/**", (route) => route.abort())
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        reads.push(path)
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: options.role ?? 0 }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/telegram-bot") data = options.empty ? [] : [current]
        if (
            path === "/api/v1/notification/7/telegram-menu" &&
            route.request().method() === "PATCH"
        ) {
            const body = route.request().postDataJSON()
            writes.push(body)
            if (options.fail)
                return route.fulfill({ json: { success: false, error: "fixture failure" } })
            current = { ...current, config: body.telegram_menu }
            data = current
        }
        if (path === "/api/v1/notification")
            data = [{ id: 7, name: "TG", url: "", request_body: "", request_header: "" }]
        if (path === "/api/v1/notification/7/editor")
            data = {
                id: 7,
                name: "TG",
                url: "https://api.telegram.org/bot123:fixture_token/sendMessage",
                request_method: 2,
                request_type: 1,
                request_header: '{"X-Keep":"fixture"}',
                request_body: '{"chat_id":"12345678","text":"#NEZHA#","custom":"keep"}',
                telegram_menu: { ...current.config },
            }
        if (path === "/api/v1/notification/7" && route.request().method() === "PATCH") {
            writes.push(route.request().postDataJSON())
            data = 7
        }
        await route.fulfill({ json: { success: true, data } })
    })
    return { writes, reads, errors, options }
}
for (const width of [390, 1440])
    for (const dark of [false, true]) {
        test(`TG settings switches ${width} ${dark ? "dark" : "light"}`, async ({ page }) => {
            await page.setViewportSize({ width, height: 1100 })
            await page.addInitScript(
                (dark) => localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light"),
                dark,
            )
            const f = await fixture(page)
            await page.goto("/dashboard/notification")
            await page.getByRole("tab", { name: "TG 机器人设置", exact: true }).click()
            const area = page.getByRole("region", { name: "TG 机器人配置" })
            await expect(area).toBeVisible()
            await expect(
                area.getByRole("switch", { name: "启用 TG 机器人", exact: true }),
            ).toBeChecked()
            for (const label of [
                "服务器概览",
                "在线服务器",
                "离线服务器",
                "即将到期服务器",
                "今日流量统计",
            ]) {
                await expect(area.getByRole("switch", { name: label, exact: true })).toBeChecked()
                await area.getByRole("switch", { name: label, exact: true }).uncheck()
            }
            await area.locator("summary", { hasText: "登录提醒与流量推送" }).click()
            await expect(
                area.getByRole("switch", { name: "每日流量推送", exact: true }),
            ).toBeChecked()
            await expect(area).toContainText("每天 00:00（北京时间）")
            await expect(
                area.getByRole("switch", { name: "失败提醒附带密码", exact: true }),
            ).not.toBeChecked()
            await area.getByRole("button", { name: "保存设置", exact: true }).click()
            await expect(area.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled()
            expect(f.writes).toHaveLength(1)
            expect(Object.keys(f.writes[0])).toEqual(["telegram_menu"])
            expect(f.writes[0].telegram_menu.items).toEqual({
                home: false,
                online: false,
                offline: false,
                expiry: false,
                traffic: false,
            })
            expect(f.writes[0].telegram_menu.daily_traffic).toBe(true)
            await page.reload()
            await expect(
                area.getByRole("switch", { name: "今日流量统计", exact: true }),
            ).not.toBeChecked()
            await area.getByRole("switch", { name: "在线服务器", exact: true }).check()
            await area.getByRole("button", { name: "保存设置", exact: true }).click()
            await expect(area.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled()
            await area.getByRole("switch", { name: "启用 TG 机器人", exact: true }).uncheck()
            await expect(
                area.getByRole("switch", { name: "在线服务器", exact: true }),
            ).toBeDisabled()
            await expect(
                area.getByRole("switch", { name: "在线服务器", exact: true }),
            ).toBeChecked()
            await area.getByRole("switch", { name: "启用 TG 机器人", exact: true }).check()
            await expect(
                area.getByRole("switch", { name: "在线服务器", exact: true }),
            ).toBeEnabled()
            await area.locator("summary", { hasText: "登录提醒与流量推送" }).click()
            await page.screenshot({
                path: `test-results/tg-bot-${width}-${dark}.png`,
                fullPage: true,
            })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true)
            expect(f.reads.some((path) => path.endsWith("/editor"))).toBe(false)
            expect(f.errors).toEqual([])
        })
    }
test("No TG notification: setup guidance and direct add dialog", async ({ page }) => {
    await fixture(page, { empty: true })
    await page.goto("/dashboard/telegram-bot")
    await expect(page.getByText("请先添加 TG 通知，添加后才能启用机器人配置。")).toBeVisible()
    await expect(page.getByRole("switch")).toHaveCount(0)
    await page.getByRole("button", { name: "添加 TG 通知", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByLabel("Bot Token", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "服务器管理菜单" })).toHaveCount(0)
})
test("Invalid TG private notification cannot enable; member gets settings tab", async ({
    page,
}) => {
    await fixture(page, { invalid: true, role: 1 })
    await page.setViewportSize({ width: 390, height: 950 })
    await page.goto("/dashboard/telegram-bot")
    const area = page.getByRole("region", { name: "TG 机器人配置" })
    await expect(area.getByRole("alert")).toContainText("机器人私聊通知")
    // An invalid but formerly enabled config can still be disabled safely.
    await area.getByRole("switch", { name: "启用 TG 机器人", exact: true }).uncheck()
    await expect(area.getByRole("switch", { name: "启用 TG 机器人", exact: true })).toBeDisabled()
    await area.getByRole("button", { name: "保存设置", exact: true }).click()
    await expect(page.getByRole("tab", { name: "服务器到期通知", exact: true })).toHaveCount(0)
    await expect(page.getByRole("tab", { name: "TG 机器人设置", exact: true })).toBeVisible()
})
test("Failed saves retain draft and support retry; bad expiry is blocked", async ({ page }) => {
    const f = await fixture(page, { fail: true })
    await page.goto("/dashboard/telegram-bot")
    const area = page.getByRole("region", { name: "TG 机器人配置" })
    await area.getByLabel("即将到期：未来").fill("0")
    await expect(area.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled()
    await area.getByLabel("即将到期：未来").fill("14")
    await area.getByRole("switch", { name: "离线服务器", exact: true }).uncheck()
    await area.getByRole("button", { name: "保存设置", exact: true }).click()
    await expect(area.getByRole("alert")).toContainText("保存失败")
    await expect(area.getByRole("switch", { name: "离线服务器", exact: true })).not.toBeChecked()
    f.options.fail = false
    await area.getByRole("button", { name: "保存设置", exact: true }).click()
    await expect(area.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled()
    expect(f.writes.at(-1).telegram_menu.expiry_days).toBe(14)
})
test("Notification editor no longer edits or overwrites robot settings", async ({ page }) => {
    const f = await fixture(page)
    await page.goto("/dashboard/notification")
    await page.getByRole("button", { name: "编辑通知", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("region", { name: "服务器管理菜单" })).toHaveCount(0)
    await expect(dialog.getByRole("link", { name: "TG 机器人设置", exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "仅保存", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0].telegram_menu).toBeUndefined()
    expect(f.writes[0].request_body).toContain('"custom":"keep"')
})
