import { expect, test } from "@playwright/test"

const uuid = "11111111-1111-4111-8111-111111111111"
for (const width of [360, 1366])
    for (const dark of [false, true]) {
        test(
            "independent credentials unused reuse and responsive UI " + width + " " + dark,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 900 })
                await page.addInitScript((dark) => {
                    localStorage.setItem("language", "zh-CN")
                    localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light")
                    Object.defineProperty(navigator, "clipboard", {
                        value: {
                            writeText: async (text: string) => {
                                ;(window as any).__copied = text
                            },
                        },
                    })
                }, dark)
                const errors: string[] = []
                page.on("pageerror", (e) => errors.push(e.message))
                page.on("console", (m) => {
                    if (m.type() === "error" && !m.text().includes("WebSocket"))
                        errors.push(m.text())
                })
                let issued = 0,
                    unused: any[] = [],
                    removed = 0,
                    used = false
                const requests: any[] = []
                await page.route("**/api/v1/**", async (route) => {
                    const url = new URL(route.request().url()),
                        path = url.pathname
                    let data: any = []
                    if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                    if (path === "/api/v1/setting")
                        data = {
                            config: {
                                language: "zh-CN",
                                install_host: "panel.example:443",
                                tls: true,
                            },
                            version: "fixture",
                        }
                    if (path === "/api/v1/server")
                        data = [
                            {
                                id: 1,
                                uuid,
                                name: "认证测试节点",
                                user_id: 1,
                                host: {},
                                note: "",
                                public_note: "",
                            },
                        ]
                    if (path === "/api/v1/agent-credentials/issue") {
                        const body = route.request().postDataJSON()
                        requests.push(body)
                        data = {
                            uuid:
                                body.uuid ||
                                "22222222-2222-4222-8222-" + String(++issued).padStart(12, "0"),
                            client_secret: body.uuid
                                ? "DedicatedNodeKey12345678901234567"
                                : "UnusedKey" + issued + "A".repeat(22),
                            version: 1,
                        }
                        if (!body.uuid)
                            unused.unshift({
                                ...data,
                                created_at: "2026-10-14T01:00:00Z",
                                fingerprint: "123456abcdef",
                            })
                    }
                    if (path === "/api/v1/agent-credentials/unused")
                        data = {
                            value: used ? [] : unused,
                            pagination: { total: used ? 0 : unused.length },
                        }
                    if (path === "/api/v1/agent-credentials/reuse") {
                        const body = route.request().postDataJSON()
                        data = unused.find((row) => row.uuid === body.uuid)
                        expect(data).toBeTruthy()
                    }
                    if (path === "/api/v1/agent-credentials/delete") {
                        const body = route.request().postDataJSON()
                        unused = unused.filter((row) => row.uuid !== body.uuid)
                        removed++
                        data = null
                    }
                    await route.fulfill({ json: { success: true, data } })
                })
                await page.goto("/dashboard")
                const top = page.getByRole("button", { name: "安装命令", exact: true }).first()
                await top.click()
                await page.getByRole("menuitem", { name: "Windows", exact: true }).click()
                await expect.poll(() => issued).toBe(1)
                await expect
                    .poll(() => page.evaluate(() => (window as any).__copied))
                    .toContain("NZ_UUID=")
                await expect(top).toHaveAttribute("data-state", "closed")
                const first = unused[0]
                await expect
                    .poll(() => page.evaluate(() => (window as any).__copied))
                    .toContain(first.client_secret)
                await top.click()
                await page.getByRole("menuitem", { name: "生成认证历史", exact: true }).click()
                const dialog = page.getByRole("dialog")
                await expect(dialog.getByRole("heading")).toHaveText("生成认证历史")
                await expect(dialog).toContainText(first.uuid)
                await dialog.getByRole("button", { name: "复用", exact: true }).click()
                await page.getByRole("menuitem", { name: "Linux", exact: true }).click()
                await expect
                    .poll(() => page.evaluate(() => (window as any).__copied))
                    .toContain("install.sh")
                const copied = await page.evaluate(() => (window as any).__copied)
                expect(copied).toContain(first.uuid)
                expect(copied).toContain(first.client_secret)
                expect(issued).toBe(1)
                expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                const box = (await dialog.boundingBox())!
                expect(box.x).toBeGreaterThanOrEqual(8)
                expect(box.x + box.width).toBeLessThanOrEqual(width - 8)
                await page.screenshot({
                    path: "test-results/credential-history-" + width + "-" + dark + ".png",
                    animations: "disabled",
                })
                await dialog
                    .getByRole("button", { name: "删除未使用认证：" + first.uuid, exact: true })
                    .click()
                const confirm = page.getByRole("alertdialog")
                await expect(confirm).toContainText("同时作废")
                await confirm.getByRole("button", { name: "取消", exact: true }).click()
                expect(removed).toBe(0)
                await dialog
                    .getByRole("button", { name: "删除未使用认证：" + first.uuid, exact: true })
                    .click()
                await confirm.getByRole("button", { name: "删除认证", exact: true }).click()
                await expect(dialog).toContainText("暂无未使用认证")
                expect(removed).toBe(1)
                await page.keyboard.press("Escape")
                await top.click()
                await page.getByRole("menuitem", { name: "macOS", exact: true }).click()
                await expect.poll(() => issued).toBe(2)
                await expect(top).toHaveAttribute("data-state", "closed")
                await expect
                    .poll(() => page.evaluate(() => (window as any).__copied))
                    .toContain("000000000002")
                used = true
                await top.click()
                await page.getByRole("menuitem", { name: "生成认证历史", exact: true }).click()
                await dialog.getByRole("button", { name: "刷新", exact: true }).click()
                await expect(dialog).toContainText("暂无未使用认证")
                await page.keyboard.press("Escape")
                const rowTrigger = page.getByRole("button", { name: "认证信息", exact: true })
                await rowTrigger.click()
                await page.getByRole("menuitem", { name: "复制认证信息", exact: true }).click()
                await expect
                    .poll(() => page.evaluate(() => (window as any).__copied))
                    .toContain("client_secret")
                const pair = JSON.parse(await page.evaluate(() => (window as any).__copied))
                expect(pair.uuid).toBe(uuid)
                expect(pair.client_secret).toBe("DedicatedNodeKey12345678901234567")
                expect(issued).toBe(2)
                expect(errors).toEqual([])
            },
        )

        test(
            "credential firewall paired approval and deletion record " + width + " " + dark,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 900 })
                await page.addInitScript((dark) => {
                    localStorage.setItem("language", "zh-CN")
                    localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light")
                }, dark)
                let accepted = false,
                    deleted = false
                const requests: any[] = []
                const record = {
                    uuid,
                    name: "已删除测试节点",
                    original_id: 8,
                    block_version: 3,
                    cleanup_revision: 0,
                    released_at: 0,
                    report_count: 0,
                    created_at: "2026-10-14T01:00:00Z",
                }
                await page.route("**/api/v1/**", async (route) => {
                    const path = new URL(route.request().url()).pathname
                    let data: any = []
                    if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                    if (path === "/api/v1/setting")
                        data = { config: { language: "zh-CN" }, version: "fixture" }
                    if (path === "/api/v1/waf/credentials")
                        data = {
                            value: accepted
                                ? []
                                : [
                                      {
                                          id: "candidate",
                                          uuid,
                                          name: "认证测试节点",
                                          fingerprint: "abcd12345678",
                                          last_ip: "192.0.2.20",
                                          first_report_at: 1791936000,
                                          last_report_at: 1791936500,
                                          report_count: 2,
                                          binding_version: 2,
                                          block_version: 3,
                                          existing: true,
                                          can_admit: true,
                                          reason: "此 UUID 已有其他密钥；放行将替换原认证",
                                      },
                                  ],
                            pagination: { total: accepted ? 0 : 1 },
                        }
                    if (path === "/api/v1/waf/unknown-reports")
                        data = { value: [], pagination: { total: 0 } }
                    if (path === "/api/v1/waf/deleted-servers")
                        data = {
                            value: deleted ? [] : [record],
                            pagination: { total: deleted ? 0 : 1 },
                        }
                    if (path === "/api/v1/waf/uuid-blacklist")
                        data = { value: [record], pagination: { total: 1 } }
                    if (path === "/api/v1/waf/credentials/admit") {
                        requests.push(route.request().postDataJSON())
                        accepted = true
                    }
                    if (path === "/api/v1/waf/deleted-servers/delete") {
                        requests.push(route.request().postDataJSON())
                        deleted = true
                    }
                    await route.fulfill({ json: { success: true, data } })
                })
                await page.goto("/dashboard/settings/waf?tab=unknown")
                await page.getByRole("button", { name: "整组放行", exact: true }).click()
                const alert = page.getByRole("alertdialog")
                await expect(alert).toContainText("原密钥将失效")
                await expect(alert).toContainText("192.0.2.20")
                expect(await alert.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                await page.screenshot({
                    path: "test-results/credential-admission-" + width + "-" + dark + ".png",
                    animations: "disabled",
                })
                await alert.getByRole("button", { name: "取消", exact: true }).click()
                expect(requests).toEqual([])
                await page.getByRole("button", { name: "整组放行", exact: true }).click()
                await alert.getByRole("button", { name: "确认整组放行", exact: true }).click()
                await expect(page.getByText("暂无认证拦截记录")).toBeVisible()
                expect(requests[0]).toEqual({
                    report_id: "candidate",
                    binding_version: 2,
                    block_version: 3,
                })
                await page.getByRole("tab", { name: "已删除服务器", exact: true }).click()
                await expect(page.getByText("重连自动卸载")).toHaveCount(0)
                await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0)
                await page
                    .getByRole("button", { name: "删除记录：已删除测试节点", exact: true })
                    .click()
                await expect(alert).toContainText("黑名单和操作历史仍保留")
                await alert.getByRole("button", { name: "删除记录", exact: true }).click()
                await expect(
                    page.getByRole("button", { name: "删除记录：已删除测试节点", exact: true }),
                ).toHaveCount(0)
                await page.getByRole("button", { name: "UUID 黑名单", exact: true }).click()
                await expect(page.getByRole("dialog")).toContainText(uuid)
                await expect(page.getByRole("dialog")).toContainText("已删除测试节点")
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
            },
        )
    }

for (const width of [320, 1366])
    for (const dark of [false, true]) {
        test(
            "credential migration settings preserves failure and pending state " +
                width +
                " " +
                dark,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 900 })
                await page.addInitScript((dark) => {
                    localStorage.setItem("language", "zh-CN")
                    localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light")
                }, dark)
                let fail = true
                const posted: number[][] = []
                let rows = [
                    {
                        id: 1,
                        uuid: "11111111-1111-4111-8111-111111111111",
                        name: "长名称中文节点-待迁移-认证测试",
                        status: "legacy",
                        message: "待迁移",
                    },
                    {
                        id: 2,
                        uuid: "22222222-2222-4222-8222-222222222222",
                        name: "离线节点",
                        status: "pending",
                        message: "节点离线，等待上线",
                    },
                    {
                        id: 3,
                        uuid: "33333333-3333-4333-8333-333333333333",
                        name: "已完成节点",
                        status: "active",
                        message: "独立密钥已生效",
                    },
                ]
                await page.route("**/api/v1/**", async (route) => {
                    const path = new URL(route.request().url()).pathname
                    let data: any = []
                    if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                    if (path === "/api/v1/setting")
                        data = {
                            config: {
                                language: "zh-CN",
                                install_host: "fixture.invalid:443",
                                tls: true,
                            },
                        }
                    if (path === "/api/v1/agent-credentials/migrations") data = rows
                    if (path === "/api/v1/agent-credentials/migrate") {
                        posted.push(route.request().postDataJSON())
                        if (fail) {
                            await route.fulfill({
                                json: { success: false, error: "测试迁移失败，请重试" },
                            })
                            return
                        }
                        rows = rows.map((row) =>
                            row.id === 1
                                ? { ...row, status: "pending", message: "等待连接验证" }
                                : row,
                        )
                        data = 2
                    }
                    await route.fulfill({ json: { success: true, data } })
                })
                await page.goto("/dashboard")
                await page.getByRole("button", { name: "认证设置", exact: true }).click()
                const dialog = page.getByRole("dialog")
                await expect(dialog).toContainText("已生效 1 / 3")
                await dialog.getByRole("button", { name: "逐台迁移", exact: true }).click()
                await expect(dialog.getByRole("alert")).toContainText("测试迁移失败")
                expect(posted).toEqual([[1, 2]])
                await expect(dialog).toContainText("已生效 1 / 3")
                fail = false
                await dialog.getByRole("button", { name: "逐台迁移", exact: true }).click()
                await expect(dialog).toContainText("等待连接验证")
                await expect(dialog).toContainText("已生效 1 / 3")
                await expect(dialog.getByRole("alert")).toHaveCount(0)
                expect(posted).toEqual([
                    [1, 2],
                    [1, 2],
                ])
                expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                const box = (await dialog.boundingBox())!
                expect(box.x).toBeGreaterThanOrEqual(8)
                expect(box.x + box.width).toBeLessThanOrEqual(width - 8)
                await page.screenshot({
                    path: "test-results/credential-settings-" + width + "-" + dark + ".png",
                    animations: "disabled",
                })
            },
        )
    }
