import { expect, test } from "@playwright/test"

for (const width of [360, 1366])
    for (const dark of [false, true]) {
        test(
            "UUID release confirms, validates errors and preserves history " + width + "-" + dark,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 850 })
                await page.addInitScript((dark) => {
                    localStorage.setItem("language", "zh-CN")
                    localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light")
                }, dark)
                const uuid = "aa555555-1111-4111-8111-111111111111"
                let released = 0,
                    version = 1,
                    fail = true
                const requests: any[] = []
                await page.route("**/api/v1/**", async (route) => {
                    const path = new URL(route.request().url()).pathname
                    let data: any = []
                    if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                    if (path === "/api/v1/setting")
                        data = { config: { language: "zh-CN" }, version: "fixture" }
                    const deleted = {
                        uuid,
                        name: "待放行节点",
                        original_id: 47,
                        block_version: version,
                        released_at: released,
                        released_by_name: released ? "admin" : "",
                        report_count: 7,
                        first_report_at: 1791170000,
                        last_report_at: Math.floor(Date.now() / 1000),
                        created_at: "2026-10-05T08:00:00Z",
                        last_ip: "192.0.2.20",
                    }
                    if (path === "/api/v1/waf/unknown-reports")
                        data = {
                            value: [
                                { ...deleted, kind: "deleted" },
                                ...[
                                    "registered",
                                    "unregistered",
                                    "conflict",
                                    "uuid_missing",
                                    "uuid_invalid",
                                ].map((kind, i) => ({
                                    ...deleted,
                                    uuid: i > 2 ? "" : "other-" + i,
                                    name: "其他记录",
                                    kind,
                                    block_version: 0,
                                    last_ip: "192.0.2." + (30 + i),
                                })),
                            ],
                            pagination: { total: 6 },
                        }
                    if (path === "/api/v1/waf/deleted-servers")
                        data = { value: [deleted], pagination: { total: 1 } }
                    if (path === "/api/v1/waf/release-uuid") {
                        expect(route.request().method()).toBe("POST")
                        requests.push(route.request().postDataJSON())
                        await new Promise((resolve) => setTimeout(resolve, 500))
                        if (fail)
                            return route.fulfill({
                                json: { success: false, error: "测试：放行失败，请重试" },
                            })
                        released = Math.floor(Date.now() / 1000)
                        data = { ...deleted, released_at: released }
                    } else expect(route.request().method()).toBe("GET")
                    await route.fulfill({ json: { success: true, data } })
                })
                await page.goto("/dashboard/settings/waf?tab=unknown")
                const panel = page.getByRole("tabpanel", { name: "认证防火墙", exact: true })
                const buttons = panel.getByRole("button", { name: "放行 UUID", exact: true })
                await expect(buttons).toHaveCount(1)
                await buttons.click()
                const dialog = page.getByRole("alertdialog")
                await expect(dialog).toContainText("不会绕过连接密钥验证")
                await expect(dialog).toContainText("不会恢复原 ID")
                await expect(dialog).toContainText(uuid)
                expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                await expect
                    .poll(async () => {
                        const box = await dialog.boundingBox()
                        return !!box && box.x >= 8 && box.x + box.width <= width - 8
                    })
                    .toBe(true)
                expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(850 * 0.85 + 1)
                await page.screenshot({
                    path: "test-results/uuid-release-dialog-" + width + "-" + dark + ".png",
                    animations: "disabled",
                })
                await dialog.getByRole("button", { name: "取消", exact: true }).click()
                expect(requests).toEqual([])
                await buttons.click()
                await dialog.getByRole("button", { name: "确认放行", exact: true }).click()
                await expect(
                    dialog.getByRole("button", { name: "正在放行…", exact: true }),
                ).toBeDisabled()
                await expect(
                    dialog.getByRole("button", { name: "取消", exact: true }),
                ).toBeDisabled()
                await expect(dialog.getByRole("alert")).toContainText("放行失败")
                await dialog.getByRole("button", { name: "取消", exact: true }).click()
                await expect(panel).toContainText("UUID 已拉黑")
                expect(requests).toHaveLength(1)
                fail = false
                await buttons.click()
                await dialog.getByRole("button", { name: "确认放行", exact: true }).click()
                await expect(
                    dialog.getByRole("heading", { name: "UUID 已放行", exact: true }),
                ).toBeVisible()
                await dialog.getByRole("button", { name: "关闭", exact: true }).click()
                await expect(buttons).toHaveCount(0)
                await expect(panel).toContainText("UUID 已放行")
                expect(requests).toEqual([
                    { uuid, block_version: 1 },
                    { uuid, block_version: 1 },
                ])
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
                await page.screenshot({
                    path: "test-results/uuid-release-success-" + width + "-" + dark + ".png",
                    fullPage: true,
                })
                await page.getByRole("tab", { name: "已删除服务器", exact: true }).click()
                const deletedPanel = page.getByRole("tabpanel", {
                    name: "已删除服务器",
                    exact: true,
                })
                await expect(deletedPanel).toContainText("待放行节点")
                await expect(deletedPanel).toContainText("已删除 · 已放行")
                await expect(deletedPanel).toContainText("7 次 · 放行前已拦截")
                await expect(deletedPanel).not.toContainText("仍在上报 ·")
                await expect(
                    deletedPanel.getByRole("button", { name: "放行 UUID", exact: true }),
                ).toHaveCount(0)
                // A newer deletion must regain the release button without reloading.
                released = 0
                version = 2
                await deletedPanel.getByRole("button", { name: "刷新", exact: true }).click()
                await deletedPanel.getByRole("button", { name: "放行 UUID", exact: true }).click()
                await expect(dialog).toContainText("确认放行 UUID")
                await dialog.getByRole("button", { name: "取消", exact: true }).click()
                expect(requests).toHaveLength(2)
            },
        )
    }
