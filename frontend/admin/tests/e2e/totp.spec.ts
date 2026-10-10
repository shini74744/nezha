import { type Page, expect, test } from "@playwright/test"

const origin = process.env.E2E_TOTP_ORIGIN || "http://127.0.0.1:18479"
const password = "test-password-only"
const code = "123456"
const recovery = Array.from(
    { length: 10 },
    (_, i) => String(i).padStart(8, "0") + "-11111111-22222222-33333333",
)
async function setup(page: Page, loggedIn = false) {
    const state = {
        loggedIn,
        enabled: false,
        githubEnabled: false,
        passwordEnabled: true,
        oauthPending: false,
        recoveryRemaining: 10,
        loginCalls: [] as any[],
        actions: [] as string[],
    }
    await page.addInitScript(() => {
        localStorage.setItem("language", "zh-CN")
        localStorage.setItem("nezha-dashboard-theme", "dark")
    })
    await page.routeWebSocket("**/api/v1/ws/server", (ws) =>
        ws.send(JSON.stringify({ now: Date.now(), servers: [], online: 0 })),
    )
    await page.route("**/*", async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) return route.abort()
        if (!url.pathname.startsWith("/api/")) return route.continue()
        let data: any = []
        const body =
            route.request().method() === "POST" ? route.request().postDataJSON() : undefined
        const error = (error: string) => route.fulfill({ json: { success: false, error } })
        if (url.pathname === "/api/v1/setting")
            data = {
                config: {
                    language: "zh-CN",
                    site_name: "验证器测试",
                    oauth2_providers: ["GitHub"],
                    appearance_config: '{"version":1,"enabled":false,"features":{}}',
                },
            }
        else if (url.pathname === "/api/v1/profile") {
            if (!state.loggedIn) return error("ApiErrorUnauthorized")
            data = {
                id: 100,
                username: "tester",
                role: 0,
                login_ip: "127.0.0.1",
                oauth2_bind: { github: "test" },
                reject_password: false,
            }
        } else if (url.pathname === "/api/v1/login") {
            state.loginCalls.push(body)
            if (!body.code) return error("ApiErrorTOTPRequired")
            if (body.code !== code && body.code !== recovery[0]) return error("ApiErrorTOTPInvalid")
            state.loggedIn = true
            data = { token: "test-only", expire: "2099-01-01" }
        } else if (url.pathname === "/api/v1/oauth2/totp") {
            if (!state.oauthPending) return error("GitHub 验证已失效，请重新使用 GitHub 登录")
            if (body.code !== code && body.code !== recovery[0]) return error("ApiErrorTOTPInvalid")
            state.oauthPending = false
            state.loggedIn = true
            data = { token: "test-only", expire: "2099-01-01" }
        } else if (url.pathname.startsWith("/api/v1/oauth2/")) {
            state.oauthPending = state.githubEnabled
            state.loggedIn = !state.githubEnabled
            data = {
                redirect:
                    origin +
                    (state.githubEnabled
                        ? "/dashboard/login?oauth2_totp=1"
                        : "/dashboard/login?oauth2=1"),
            }
        } else if (url.pathname === "/api/v1/profile/totp")
            data = {
                enabled: state.enabled,
                github_enabled: state.githubEnabled,
                password_enabled: state.enabled && state.passwordEnabled,
                recovery_remaining: state.recoveryRemaining,
            }
        else if (url.pathname.startsWith("/api/v1/profile/totp/")) {
            const action = url.pathname.split("/").at(-1)!
            state.actions.push(action)
            if (body.password !== password) return error("当前密码不正确")
            if (action === "setup")
                data = {
                    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
                    qr_code:
                        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=",
                    expires_at: Date.now() / 1000 + 600,
                }
            else if (action === "cancel") data = null
            else {
                if (body.code !== code && body.code !== recovery[0])
                    return error("ApiErrorTOTPInvalid")
                if (action === "policy") {
                    state.githubEnabled = body.github_enabled
                    state.passwordEnabled = body.password_enabled
                    data = {
                        enabled: state.enabled,
                        github_enabled: state.githubEnabled,
                        password_enabled: state.enabled && state.passwordEnabled,
                        recovery_remaining: state.recoveryRemaining,
                    }
                } else {
                    state.enabled = action !== "disable"
                    if (action === "disable") state.githubEnabled = false
                    data = action === "disable" ? null : { recovery_codes: recovery }
                }
            }
        } else if (url.pathname === "/api/v1/service")
            data = { services: {}, cycle_transfer_stats: {} }
        return route.fulfill({ json: { success: true, data } })
    })
    return state
}
for (const width of [320, 390, 1440]) {
    test("TOTP password login and recovery " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 })
        const state = await setup(page)
        await page.goto(origin + "/dashboard/login")
        await page.getByLabel("用户名", { exact: true }).fill("tester")
        await page.getByLabel("密码", { exact: true }).fill(password)
        await page.getByRole("button", { name: "登录", exact: true }).click()
        await expect(page.getByLabel("动态验证码", { exact: true })).toBeVisible()
        expect(state.loggedIn).toBe(false)
        await expect(page).toHaveURL(/login$/)
        await page.getByLabel("动态验证码", { exact: true }).fill("999999")
        await page.getByRole("button", { name: "登录", exact: true }).click()
        await expect(
            page.getByText("验证码或恢复码无效，已使用的验证码不能重复使用", { exact: true }),
        ).toBeVisible()
        expect(state.loggedIn).toBe(false)
        await page.screenshot({ path: info.outputPath("login-code.png") })
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.getByRole("button", { name: "无法使用验证器？使用恢复码" }).click()
        await page.getByLabel("恢复码", { exact: true }).fill(recovery[0])
        await page.getByRole("button", { name: "登录", exact: true }).click()
        await expect(page).toHaveURL(/dashboard$/)
        expect(state.loginCalls.at(-1).code).toBe(recovery[0])
    })
    test("TOTP bind regenerate disable " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 })
        const state = await setup(page, true)
        await page.goto(origin + "/dashboard/profile")
        const card = page.locator("[data-totp-settings]")
        await expect(card.getByText("未绑定", { exact: true })).toBeVisible()
        await expect(card.getByLabel("当前账号密码")).toBeHidden()
        await card.getByRole("button", { name: "展开设置" }).click()
        await card.getByLabel("当前账号密码").fill(password)
        await card.getByRole("button", { name: "开始绑定" }).click()
        await expect(card.getByAltText("身份验证器绑定二维码")).toBeVisible()
        expect(state.enabled).toBe(false)
        await card.getByLabel("6 位动态验证码").fill(code)
        await card.getByRole("button", { name: "验证并启用" }).click()
        await expect(card.getByText(/^已绑定剩余 10 组恢复码$/)).toBeVisible()
        await expect(card.locator("pre")).toContainText(recovery[9])
        expect(await card.getByLabel("恢复码").textContent()).toContain("仅在此时展示")
        await card.scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("settings-recovery.png") })
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await card.getByRole("button", { name: "我已保存" }).click()
        await card.getByLabel("当前账号密码").fill(password)
        await card.getByLabel("动态验证码或恢复码").fill(code)
        await card.getByRole("button", { name: "重新生成恢复码" }).click()
        await expect(card.locator("pre")).toBeVisible()
        await card.getByRole("button", { name: "我已保存" }).click()
        await card.getByLabel("当前账号密码").fill(password)
        await card.getByLabel("动态验证码或恢复码").fill(recovery[0])
        await card.getByRole("button", { name: "解除绑定" }).click()
        await expect(card.getByText("未绑定", { exact: true })).toBeVisible()
        expect(state.actions).toEqual(["setup", "confirm", "recovery", "disable"])
    })
}
test("GitHub login does not require panel TOTP", async ({ page }) => {
    const state = await setup(page)
    await page.goto(origin + "/dashboard/login")
    await page.getByRole("button", { name: "GitHub", exact: true }).click()
    await expect(page).toHaveURL(/dashboard$/)
    expect(state.loginCalls).toHaveLength(0)
})
for (const width of [320, 390, 900, 1440]) {
    test("TOTP compact placement and GitHub switch " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 })
        const state = await setup(page, true)
        state.enabled = true
        await page.goto(origin + "/dashboard/profile")
        const card = page.locator("[data-totp-settings]")
        await expect(card.getByRole("switch", { name: "GitHub 登录" })).toBeVisible()
        expect(await card.evaluate((el) => el.previousElementSibling?.textContent)).toContain(
            "Oauth2 bindings",
        )
        await expect(card.getByLabel("当前账号密码")).toBeHidden()
        expect((await card.boundingBox())!.height).toBeLessThan(width <= 390 ? 330 : 260)
        await card.scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("collapsed-settings.png") })
        await card.getByRole("button", { name: "展开设置" }).click()
        const pw = await card.getByLabel("当前账号密码").boundingBox()
        const otp = await card.getByLabel("动态验证码或恢复码").boundingBox()
        if (width === 1440) {
            expect(Math.abs(pw!.y - otp!.y)).toBeLessThan(2)
            expect(pw!.width).toBeLessThanOrEqual(340)
            expect((await card.boundingBox())!.height).toBeLessThan(450)
        } else if (width <= 390) {
            expect(otp!.y).toBeGreaterThan(pw!.y + pw!.height)
            expect(pw!.height).toBeGreaterThanOrEqual(40)
        }
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await card.scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("compact-settings.png") })
        await card.getByRole("switch", { name: "GitHub 登录" }).click()
        expect(state.githubEnabled).toBe(false)
        await card.getByLabel("当前账号密码").fill(password)
        await card.getByLabel("动态验证码或恢复码").fill(code)
        await card.getByRole("button", { name: "保存登录设置" }).click()
        await expect(
            card.getByText("开关已保存，开启的登录方式需额外验证。", { exact: true }),
        ).toBeVisible()
        expect(state.githubEnabled).toBe(true)
        expect(state.actions).toEqual(["policy"])
        expect(state.passwordEnabled).toBe(true)
        await expect(card.getByLabel("当前账号密码")).toBeHidden()
        await card.getByRole("switch", { name: "账号密码登录" }).click()
        await expect(card.getByLabel("当前账号密码")).toBeVisible()
        await card.getByRole("button", { name: "取消修改" }).click()
        await expect(card.getByRole("switch", { name: "账号密码登录" })).toBeChecked()
        expect(state.actions).toEqual(["policy"])
        // Both switches off retain the binding and recovery management.
        await card.getByRole("switch", { name: "账号密码登录" }).click()
        await card.getByRole("switch", { name: "GitHub 登录" }).click()
        await card.getByLabel("当前账号密码").fill(password)
        await card.getByLabel("动态验证码或恢复码").fill(code)
        await card.getByRole("button", { name: "保存登录设置" }).click()
        await expect(
            card.getByText("两种登录均不需要验证器；绑定已保留，可随时重新开启。"),
        ).toBeVisible()
        expect(state.enabled).toBe(true)
        expect(state.passwordEnabled).toBe(false)
        expect(state.githubEnabled).toBe(false)
        await page.reload()
        await expect(card.getByRole("switch", { name: "账号密码登录" })).not.toBeChecked()
        await expect(card.getByRole("switch", { name: "GitHub 登录" })).not.toBeChecked()
        await expect(card.getByLabel("当前账号密码")).toBeHidden()
    })
}
for (const width of [390, 1440]) {
    test("GitHub opted-in challenge " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 })
        const state = await setup(page)
        state.githubEnabled = true
        await page.goto(origin + "/dashboard/login")
        await page.getByRole("button", { name: "GitHub", exact: true }).click()
        await expect(page.locator("[data-oauth-totp]")).toBeVisible()
        expect(state.loggedIn).toBe(false)
        await page.getByLabel("动态验证码", { exact: true }).fill("999999")
        await page.getByRole("button", { name: "验证并登录", exact: true }).click()
        await expect(page.getByRole("alert")).toContainText("验证码或恢复码无效")
        expect(state.loggedIn).toBe(false)
        await page.screenshot({ path: info.outputPath("github-challenge.png") })
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.getByRole("button", { name: "无法使用验证器？使用恢复码" }).click()
        await page.getByLabel("恢复码", { exact: true }).fill(recovery[0])
        await page.getByRole("button", { name: "验证并登录", exact: true }).click()
        await expect(page).toHaveURL(/dashboard$/)
        expect(state.loggedIn).toBe(true)
        expect(state.loginCalls).toHaveLength(0)
    })
}
test("Forged GitHub challenge query grants no login", async ({ page }) => {
    const state = await setup(page)
    await page.goto(origin + "/dashboard/login?oauth2_totp=1")
    await page.getByLabel("动态验证码", { exact: true }).fill(code)
    await page.getByRole("button", { name: "验证并登录", exact: true }).click()
    await expect(page.getByRole("alert")).toContainText("GitHub 验证已失效")
    expect(state.loggedIn).toBe(false)
    await page.getByRole("button", { name: "返回登录" }).click()
    await expect(page.getByLabel("用户名", { exact: true })).toBeVisible()
})
