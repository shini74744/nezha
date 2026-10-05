import { expect, test } from "@playwright/test"

for (const width of [360, 1366])
    for (const dark of [false, true]) {
        test(
            "server history and distinct firewall lists " + width + "-" + dark,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 800 })
                await page.addInitScript((dark) => {
                    localStorage.setItem("language", "zh-CN")
                    localStorage.setItem("vite-ui-theme", dark ? "dark" : "light")
                }, dark)
                let fail = false
                const writes: string[] = []
                const duplicateKeys: string[] = []
                page.on("console", (message) => {
                    if (/same key|unique.*key/i.test(message.text()))
                        duplicateKeys.push(message.text())
                })
                await page.route("**/api/v1/**", async (route) => {
                    const url = new URL(route.request().url()),
                        path = url.pathname
                    if (route.request().method() !== "GET") writes.push(path)
                    let data: any = []
                    if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                    if (path === "/api/v1/setting")
                        data = { config: { language: "zh-CN" }, version: "fixture" }
                    if (path === "/api/v1/server/operations") {
                        if (fail)
                            return route.fulfill({
                                json: { success: false, error: "fixture unavailable" },
                            })
                        const searched = url.searchParams.get("q") === "missing"
                        data = {
                            value: searched
                                ? []
                                : [
                                      {
                                          id: url.searchParams.get("offset") === "20" ? 2 : 1,
                                          created_at: "2026-10-05T08:00:00Z",
                                          server_name:
                                              url.searchParams.get("offset") === "20"
                                                  ? "第二页节点"
                                                  : "节点 A",
                                          server_uuid: "12345678-1234-1234-1234-123456789abc",
                                          server_id: 2,
                                          previous_id: 47,
                                          actor_id: 1,
                                          actor_name: "admin",
                                          action: "reassign_ids",
                                          source: "web",
                                          changes: [
                                              { field: "id", before: "47", after: "2" },
                                              {
                                                  field: "name",
                                                  before: "<script>alert(1)</script>",
                                                  after: "新名称",
                                              },
                                              {
                                                  field: "note",
                                                  before: "未设置",
                                                  after: "已设置（内容不记录）",
                                              },
                                          ],
                                      },
                                  ],
                            pagination: { total: searched ? 0 : 21 },
                        }
                    }
                    if (path === "/api/v1/waf/unknown-reports")
                        data = {
                            value: [
                                {
                                    uuid: "registered-uuid",
                                    name: "密钥错误的已有节点",
                                    kind: "registered",
                                    last_ip: "192.0.2.2",
                                    first_report_at: 1791174000,
                                    last_report_at: 1791174100,
                                    report_count: 4,
                                },
                                {
                                    uuid: "registered-uuid",
                                    name: "密钥错误的已有节点",
                                    kind: "conflict",
                                    previous_ip: "192.0.2.10",
                                    last_ip: "192.0.2.11",
                                    previous_peer: "192.0.2.10:2345",
                                    last_peer: "192.0.2.11:3456",
                                    first_report_at: 1791174000,
                                    last_report_at: 1791174100,
                                    report_count: 2,
                                },
                                {
                                    uuid: "unregistered-uuid",
                                    name: "",
                                    kind: "unregistered",
                                    last_ip: "192.0.2.1",
                                    first_report_at: 1791174000,
                                    last_report_at: 1791174100,
                                    report_count: 3,
                                },
                                ...[
                                    { kind: "uuid_missing", last_ip: "192.0.2.21" },
                                    { kind: "uuid_missing", last_ip: "192.0.2.22" },
                                    { kind: "uuid_invalid", last_ip: "2001:db8::23" },
                                ].map((row) => ({
                                    ...row,
                                    uuid: "",
                                    name: "未识别节点",
                                    first_report_at: 1791174000,
                                    last_report_at: 1791174100,
                                    report_count: 5,
                                })),
                                {
                                    uuid: "deleted-returning-uuid",
                                    name: "删除后重连的节点",
                                    kind: "deleted",
                                    last_ip: "2001:db8::1",
                                    first_report_at: 1791174000,
                                    last_report_at: 1791174100,
                                    report_count: 2,
                                },
                            ],
                            pagination: { total: 7 },
                        }
                    if (path === "/api/v1/waf/deleted-servers")
                        data = {
                            value: [
                                {
                                    uuid: "deleted-idle-uuid",
                                    name: "删除后未再上报",
                                    original_id: 47,
                                    deleted_by_id: 1,
                                    deleted_by_name: "admin",
                                    created_at: "2026-10-05T08:00:00Z",
                                    report_count: 0,
                                },
                                {
                                    uuid: "deleted-returning-uuid",
                                    name: "删除后重连的节点",
                                    original_id: 63,
                                    last_report_at: Math.floor(Date.now() / 1000),
                                    deleted_by_id: 1,
                                    deleted_by_name: "admin",
                                    created_at: "2026-10-05T08:00:00Z",
                                    report_count: 2,
                                },
                            ],
                            pagination: { total: 2 },
                        }
                    if (path === "/api/v1/waf")
                        data = { value: [], pagination: { total: 0, limit: 10, offset: 0 } }
                    await route.fulfill({ json: { success: true, data } })
                })
                await page.goto("/dashboard")
                await page.getByRole("button", { name: "历史记录", exact: true }).click()
                const dialog = page.getByRole("dialog", { name: "服务器操作历史" })
                await expect(dialog).toContainText("#47 → #2")
                await dialog.locator("summary").click()
                await expect(dialog).toContainText("修改前")
                await expect(dialog).toContainText("已设置（内容不记录）")
                await expect(dialog.locator("script")).toHaveCount(0)
                expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                const box = await dialog.boundingBox()
                expect(box!.height).toBeLessThanOrEqual(680 + 1)
                await page.screenshot({
                    path: "test-results/server-history-" + width + "-" + dark + ".png",
                    fullPage: true,
                })
                await dialog.getByRole("button", { name: "下一页" }).click()
                await expect(dialog).toContainText("第二页节点")
                await expect(dialog.getByRole("button", { name: "下一页" })).toBeDisabled()
                await dialog.getByLabel("搜索节点历史").fill("missing")
                await dialog.getByRole("button", { name: "搜索", exact: true }).click()
                await expect(dialog).toContainText("暂无符合条件")
                await expect(dialog).toContainText("第 1 页")
                fail = true
                await dialog.getByRole("button", { name: "刷新历史" }).click()
                await expect(dialog.getByRole("alert")).toBeVisible()
                await page.keyboard.press("Escape")
                await expect(dialog).not.toBeVisible()
                await page.goto("/dashboard/settings/waf?tab=unknown")
                const unknown = page.getByRole("tabpanel", { name: "认证防火墙", exact: true })
                await expect(unknown).toContainText("未登记 UUID 认证失败")
                await expect(unknown).toContainText("已有 UUID 认证失败")
                await expect(unknown).toContainText("疑似 UUID 冲突")
                await expect(unknown).toContainText("旧连接：192.0.2.10")
                await expect(unknown).toContainText("新连接：192.0.2.11")
                await expect(unknown).toContainText("待核查 · 未自动封禁")
                await expect(unknown).toContainText("已删除节点重连")
                await expect(unknown).toContainText("UUID 缺失")
                await expect(unknown).toContainText("UUID 格式不合法")
                await expect(unknown).toContainText("UUID：未提供")
                await expect(unknown).toContainText("UUID：格式不合法（原文不保存）")
                await expect(unknown).toContainText("192.0.2.21")
                await expect(unknown).toContainText("192.0.2.22")
                await expect(unknown).toContainText("2001:db8::23")
                await expect(unknown).toContainText("共 7 条分类记录")
                await expect(unknown).not.toContainText("删除后未再上报")
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
                await page.screenshot({
                    path: "test-results/unknown-kinds-" + width + "-" + dark + ".png",
                    fullPage: true,
                })
                await page.getByRole("tab", { name: "已删除服务器", exact: true }).click()
                const deleted = page.getByRole("tabpanel", { name: "已删除服务器", exact: true })
                await expect(deleted).toContainText("删除后未再上报")
                await expect(deleted).toContainText("尚未再次上报")
                await expect(deleted).toContainText("删除后重连的节点")
                await expect(deleted).toContainText("仍在上报")
                await expect(deleted).toContainText("最近上报")
                const reported = deleted.locator("article").filter({ hasText: "删除后重连的节点" })
                await expect(reported).toHaveClass(/border-amber/)
                await expect(
                    deleted.locator("article").filter({ hasText: "删除后未再上报" }),
                ).not.toHaveClass(/border-amber/)
                await expect(deleted).not.toContainText("unregistered-uuid")
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
                await page.screenshot({
                    path: "test-results/deleted-servers-" + width + "-" + dark + ".png",
                    fullPage: true,
                })
                expect(writes).toEqual([])
                expect(duplicateKeys).toEqual([])
            },
        )
    }
