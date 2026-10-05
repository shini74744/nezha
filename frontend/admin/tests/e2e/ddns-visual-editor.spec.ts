import { Page, expect, test } from "@playwright/test"
import fs from "node:fs"

async function setup(page: Page, beauty = false, theme = "dark") {
    const rows: any[] = [
        {
            id: 7,
            name: "家庭服务器",
            provider: "cloudflare",
            domains: ["home.example.com", "nas.example.com"],
            enable_ipv4: true,
            enable_ipv6: true,
            max_retries: 3,
            notification_group_id: 0,
            access_id: "retained",
            access_secret: "",
            webhook_headers: "",
            webhook_url: "",
            webhook_request_body: "",
        },
        {
            id: 8,
            name: "IPv6 备用",
            provider: "he",
            domains: ["ipv6.example.com"],
            enable_ipv4: false,
            enable_ipv6: true,
            max_retries: 2,
            notification_group_id: 99,
        },
    ]
    const writes: any[] = []
    const errors: string[] = []
    let failSave = false,
        failDelete = false,
        failProviders = false,
        failGroups = false,
        failList = false
    const manifest = JSON.parse(
        fs.readFileSync(
            new URL("../../src/lib/dashboard-appearance-manifest.json", import.meta.url),
            "utf8",
        ),
    )
    const config = {
        version: 1,
        enabled: beauty,
        features: Object.fromEntries(manifest.map((d: any) => [d.key, { ...d.defaults }])),
    }
    config.features.font.enabled = false
    config.features.brand.enabled = false
    config.features.background.image = ""
    config.features.effects.enabled = false
    page.on("pageerror", (e) => errors.push(e.message))
    await page.addInitScript(value => localStorage.setItem("nezha-dashboard-theme", value), theme)
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname,
            method = route.request().method()
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, role: 0, username: "DDNS test" }
        if (path === "/api/v1/setting")
            data = {
                config: { language: "zh-CN", dashboard_appearance_config: JSON.stringify(config) },
                version: "test",
            }
        if (path === "/api/v1/ddns/providers") {
            if (failProviders)
                return route.fulfill({
                    status: 503,
                    json: { success: false, error: "fixture failure" },
                })
            data = ["dummy", "webhook", "cloudflare", "tencentcloud", "he"]
        }
        if (path === "/api/v1/notification-group") {
            if (failGroups)
                return route.fulfill({
                    status: 503,
                    json: { success: false, error: "fixture failure" },
                })
            data = [{ group: { id: 3, name: "运维通知" } }]
        }
        if (path === "/api/v1/ddns" && method === "GET") {
            if (failList)
                return route.fulfill({
                    status: 503,
                    json: { success: false, error: "fixture failure" },
                })
            data = rows
        }
        if (
            (path === "/api/v1/ddns" && method === "POST") ||
            (path.startsWith("/api/v1/ddns/") && method === "PATCH")
        ) {
            const body = route.request().postDataJSON()
            writes.push({ path, body })
            await new Promise((resolve) => setTimeout(resolve, 120))
            if (failSave)
                return route.fulfill({ json: { success: false, error: "fixture rejected" } })
            if (method === "POST") {
                rows.push({ ...body, access_secret: "", webhook_headers: "", id: 100 })
                data = 100
            } else
                Object.assign(
                    rows.find((r) => r.id === Number(path.split("/").pop())),
                    body,
                    { access_secret: "", webhook_headers: "" },
                )
        }
        if (path === "/api/v1/batch-delete/ddns") {
            const body = route.request().postDataJSON()
            writes.push({ path, body })
            if (failDelete)
                return route.fulfill({ json: { success: false, error: "fixture rejected" } })
            for (let i = rows.length - 1; i >= 0; i--)
                if (body.includes(rows[i].id)) rows.splice(i, 1)
        }
        await route.fulfill({ json: { success: true, data } })
    })
    return {
        rows,
        writes,
        errors,
        saveFailure: (v: boolean) => (failSave = v),
        deleteFailure: (v: boolean) => (failDelete = v),
        providerFailure: (v: boolean) => (failProviders = v),
        groupFailure: (v: boolean) => (failGroups = v),
        listFailure: (v: boolean) => (failList = v),
    }
}

for (const width of [320, 390, 768, 1872])
    test("DDNS responsive visual CRUD " + width, async ({ page }, info) => {
        test.setTimeout(90000)
        await page.setViewportSize({ width, height: 900 })
        const state = await setup(page, true)
        await page.goto("/dashboard/ddns")
        await expect(page.locator("[data-ddns-id]")).toHaveCount(2)
        await expect(page.locator("[data-ddns-id='7']")).toContainText("IPv4 · A")
        await expect(page.locator("body")).not.toContainText("true")
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            width,
        )
        await page.screenshot({ path: info.outputPath("list.png") })
        await page
            .locator("[data-ddns-id='7']")
            .getByRole("button", { name: "编辑 DDNS", exact: true })
            .click()
        const dialog = page.getByRole("dialog")
        await expect(dialog.getByLabel("API Token", { exact: true })).toHaveValue("")
        await expect(dialog.getByLabel("启用 IPv6", { exact: true })).toBeChecked()
        await dialog.getByLabel("名称", { exact: true }).fill("家中主节点")
        await dialog
            .getByLabel("域名", { exact: true })
            .fill("home.example.com，nas.example.com\nhome.example.com")
        await expect(dialog.getByLabel("域名预览").locator("span > button")).toHaveCount(2)
        await dialog.getByLabel("DDNS 结果通知组", { exact: true }).selectOption("3")
        await dialog.getByRole("button", { name: "保存配置" }).click()
        await expect(dialog).toHaveCount(0)
        expect(state.writes[0].body).toMatchObject({
            domains: ["home.example.com", "nas.example.com"],
            enable_ipv6: true,
            notification_group_id: 3,
            access_secret: "",
            access_id: "retained",
        })
        await page
            .locator("[data-ddns-id='7']")
            .getByRole("button", { name: "编辑 DDNS", exact: true })
            .click()
        await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue("家中主节点")
        await expect(dialog.getByLabel("DDNS 结果通知组", { exact: true })).toHaveValue("3")
        await dialog.getByLabel("名称", { exact: true }).fill("取消的草稿")
        await dialog.getByRole("button", { name: "取消", exact: true }).click()
        await page
            .locator("[data-ddns-id='7']")
            .getByRole("button", { name: "编辑 DDNS", exact: true })
            .click()
        await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue("家中主节点")
        await dialog.getByRole("button", { name: "取消", exact: true }).click()

        await page.getByRole("button", { name: "添加 DDNS", exact: true }).click()
        await dialog.getByLabel("名称", { exact: true }).fill("新增解析")
        await dialog.getByLabel("域名", { exact: true }).fill("new.example.com\nremove.example.com")
        await dialog
            .getByRole("button", { name: "移除域名 remove.example.com", exact: true })
            .click()
        await dialog.getByLabel("API Token", { exact: true }).fill("fixture-only-token")
        await expect(dialog.getByLabel("API Token", { exact: true })).toHaveAttribute(
            "type",
            "password",
        )
        await dialog.getByRole("button", { name: "显示密钥", exact: true }).click()
        await expect(dialog.getByLabel("API Token", { exact: true })).toHaveAttribute(
            "type",
            "text",
        )
        await dialog.getByRole("button", { name: "隐藏密钥", exact: true }).click()
        await dialog.getByLabel("名称", { exact: true }).scrollIntoViewIfNeeded()
        expect((await dialog.boundingBox())!.width).toBeLessThan(width)
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
        await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
        const scroller = dialog.locator(".ddns-editor-scroll")
        const saveBefore = (await dialog.getByRole("button", { name: "保存配置" }).boundingBox())!
        const scrollBox = (await scroller.boundingBox())!
        expect(scrollBox.y + scrollBox.height).toBeLessThanOrEqual(saveBefore.y)
        await page.screenshot({ path: info.outputPath("editor.png") })
        await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
        expect(await dialog.getByRole("button", { name: "保存配置" }).boundingBox()).toEqual(
            saveBefore,
        )
        await expect(dialog.getByText(/保存后，请在服务器编辑中启用 DDNS/)).toBeInViewport()
        await page.screenshot({ path: info.outputPath("editor-bottom.png") })
        await dialog.getByRole("button", { name: "保存配置" }).click()
        await expect(dialog).toHaveCount(0)
        expect(state.writes[1].body.domains).toEqual(["new.example.com"])
        expect(state.writes[1].body.access_secret).toBe("fixture-only-token")
        await page.getByLabel("搜索 DDNS").fill("new.example.com")
        await expect(page.locator("[data-ddns-id]")).toHaveCount(1)
        await page.getByLabel("选择 新增解析", { exact: true }).click()
        await page.getByLabel("搜索 DDNS").fill("home")
        await expect(
            page.getByRole("button", { name: "删除选中 DDNS", exact: true }),
        ).toBeDisabled()
        await page.getByLabel("搜索 DDNS").fill("")
        await page.getByLabel("筛选提供商", { exact: true }).selectOption("he")
        await expect(page.locator("[data-ddns-id]")).toHaveCount(1)
        await page.getByLabel("筛选提供商", { exact: true }).selectOption("")
        await page
            .locator("[data-ddns-id='100']")
            .getByRole("button", { name: "删除 DDNS", exact: true })
            .click()
        await page
            .getByRole("alertdialog")
            .getByRole("button", { name: "取消", exact: true })
            .click()
        expect(state.writes).toHaveLength(2)
        await page.getByLabel("选择 家中主节点", { exact: true }).click()
        await page.getByLabel("选择 新增解析", { exact: true }).click()
        await page.getByRole("button", { name: "删除选中 DDNS", exact: true }).click()
        await page.getByRole("button", { name: "确认删除", exact: true }).click()
        await expect(page.locator("[data-ddns-id]")).toHaveCount(1)
        expect(state.writes.at(-1).body).toEqual([7, 100])
        expect(state.errors).toEqual([])
    })

test("DDNS provider fields, validation, retained credentials and failure recovery", async ({
    page,
}, info) => {
    test.setTimeout(90000)
    const state = await setup(page)
    await page.goto("/dashboard/ddns")
    await page.getByRole("button", { name: "添加 DDNS", exact: true }).click()
    const d = page.getByRole("dialog")
    await d.getByRole("button", { name: "保存配置" }).click()
    await expect(d.getByText("请输入配置名称", { exact: true })).toBeVisible()
    expect(state.writes).toHaveLength(0)
    await d.getByLabel("名称", { exact: true }).fill("Webhook 解析")
    await d.getByLabel("域名", { exact: true }).fill("https://example.com")
    await d.getByLabel("DNS 提供商", { exact: true }).selectOption("tencentcloud")
    await expect(d.getByLabel("SecretId", { exact: true })).toBeVisible()
    await expect(d.getByLabel("SecretKey", { exact: true })).toBeVisible()
    await d.getByLabel("DNS 提供商", { exact: true }).selectOption("he")
    await expect(d.getByLabel("DDNS Key", { exact: true })).toBeVisible()
    await d.getByLabel("DNS 提供商", { exact: true }).selectOption("dummy")
    await expect(d.getByText("Dummy 不会向 DNS 提供商更新记录，无需填写凭据。")).toBeVisible()
    await d.getByLabel("DNS 提供商", { exact: true }).selectOption("webhook")
    await d.getByLabel("Webhook URL", { exact: true }).fill("javascript:invalid")
    await d.getByLabel("请求头（JSON）", { exact: true }).fill("{bad}")
    await d.getByLabel("最大重试次数", { exact: true }).fill("11")
    await d.getByRole("button", { name: "保存配置" }).click()
    await expect(d.locator("[aria-invalid=true]")).toHaveCount(4)
    expect(state.writes).toHaveLength(0)
    await d.getByLabel("域名", { exact: true }).fill("例子.中国")
    await d.getByLabel("Webhook URL", { exact: true }).fill("https://fixture.invalid/?ip=#ip#")
    await d.getByLabel("请求方法", { exact: true }).selectOption("2")
    await d.getByLabel("请求格式", { exact: true }).selectOption("2")
    await d
        .getByLabel("请求头（JSON）", { exact: true })
        .fill('{"Authorization":"Bearer #access_secret#"}')
    await d.getByLabel("请求体", { exact: true }).fill('{"ip":"#ip#","domain":"#domain#"}')
    await d.getByLabel("最大重试次数", { exact: true }).fill("10")
    state.saveFailure(true)
    await d.getByRole("button", { name: "保存配置" }).click()
    await expect(d.getByText(/保存失败/)).toBeVisible()
    await expect(d.getByLabel("名称", { exact: true })).toHaveValue("Webhook 解析")
    state.saveFailure(false)
    await d.getByLabel("Webhook URL", { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath("webhook.png") })
    await d.getByRole("button", { name: "保存配置" }).click()
    await expect(d).toHaveCount(0)
    expect(state.writes.at(-1).body).toMatchObject({
        domains: ["例子.中国"],
        webhook_method: 2,
        webhook_request_type: 2,
        webhook_headers: '{"Authorization":"Bearer #access_secret#"}',
        max_retries: 10,
    })
    state.groupFailure(true)
    await page.reload() // Start without a cached successful notification-group response.
    await page
        .locator("[data-ddns-id='8']")
        .getByRole("button", { name: "编辑 DDNS", exact: true })
        .click()
    await expect(d.getByLabel("DDNS 结果通知组", { exact: true })).toHaveValue("99")
    await expect(d.getByText(/通知组读取失败/)).toBeVisible()
    await d.getByRole("button", { name: "取消", exact: true }).click()
    state.deleteFailure(true)
    await page
        .locator("[data-ddns-id='7']")
        .getByRole("button", { name: "删除 DDNS", exact: true })
        .click()
    await page.getByRole("button", { name: "确认删除", exact: true }).click()
    await expect(page.getByRole("alertdialog").getByText(/删除失败/)).toBeVisible()
    await expect(page.locator("[data-ddns-id='7']")).toHaveCount(1)
    state.deleteFailure(false)
    await page.getByRole("button", { name: "确认删除", exact: true }).click()
    await expect(page.locator("[data-ddns-id='7']")).toHaveCount(0)
    expect(state.errors).toEqual([])
})

test("DDNS provider/list errors recover, empty list and stale API values are not lost", async ({
    page,
}) => {
    const state = await setup(page)
    state.providerFailure(true)
    state.listFailure(true)
    await page.goto("/dashboard/ddns")
    await expect(page.getByText(/提供商读取失败/)).toBeVisible()
    await expect(page.getByRole("button", { name: "添加 DDNS", exact: true })).toBeDisabled()
    await expect(page.getByText(/DDNS 列表加载失败/)).toBeVisible()
    state.providerFailure(false)
    state.listFailure(false)
    await page.getByRole("button", { name: "重新加载", exact: true }).click()
    await page.getByRole("button", { name: "重试提供商", exact: true }).click()
    await expect(page.locator("[data-ddns-id]")).toHaveCount(2)
    await expect(page.getByRole("button", { name: "添加 DDNS", exact: true })).toBeEnabled()
    state.rows.splice(0)
    await page.getByRole("button", { name: "刷新 DDNS", exact: true }).click()
    await expect(page.getByText("还没有 DDNS 配置，点击右上角「新建 DDNS」开始。")).toBeVisible()
    expect(state.writes).toHaveLength(0)
    expect(state.errors).toEqual([])
})

test("DDNS busy guards, light theme, large text and short viewport", async ({ page }, info) => {
    const state = await setup(page, false, "light")
    await page.setViewportSize({ width: 390, height: 560 })
    await page.goto("/dashboard/ddns")
    await expect(page.locator("[data-ddns-id]")).toHaveCount(2)
    await expect(page.locator("html")).not.toHaveClass(/dark/)
    await page.evaluate(() => { document.documentElement.style.fontSize = "20px" })
    await page
        .locator("[data-ddns-id='7']")
        .getByRole("button", { name: "编辑 DDNS", exact: true })
        .click()
    const d = page.getByRole("dialog")
    await d
        .getByLabel("名称", { exact: true })
        .fill("very-long-node-name-for-responsive-layout-1234567890")
    await d.getByLabel("域名", { exact: true }).fill("a".repeat(60) + ".example.com")
    expect(await d.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(
        (await d.boundingBox())!.width,
    )
    await d.locator(".ddns-editor-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight))
    await page.screenshot({ path: info.outputPath("large-text-light.png") })
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route("**/api/v1/ddns/7", async (route) => {
        await held
        await route.fallback()
    })
    await d.getByRole("button", { name: "保存配置", exact: true }).click()
    await expect(d.getByRole("button", { name: "保存中…", exact: true })).toBeDisabled()
    await expect(d.getByRole("button", { name: "取消", exact: true })).toBeDisabled()
    await expect(d.getByLabel("名称", { exact: true })).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(d).toBeVisible()
    release()
    await expect(d).toHaveCount(0)
    expect(state.writes).toHaveLength(1)
    expect(state.errors).toEqual([])
})
