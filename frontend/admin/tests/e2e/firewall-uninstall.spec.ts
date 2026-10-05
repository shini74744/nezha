import { expect, test } from "@playwright/test"

for (const width of [360, 1366])
    for (const dark of [false, true]) {
        test("firewall tabs and unknown reports " + width + "-" + dark, async ({ page }) => {
            await page.setViewportSize({ width, height: 850 })
            await page.addInitScript((dark) => {
                localStorage.setItem("i18nextLng", "zh-CN")
                localStorage.setItem("vite-ui-theme", dark ? "dark" : "light")
            }, dark)
            let fail = false
            const writes: string[] = []
            await page.route("**/api/v1/**", async (route) => {
                const request = route.request(),
                    url = new URL(request.url()),
                    path = url.pathname
                let data: any = []
                if (request.method() !== "GET") writes.push(path)
                if (path === "/api/v1/profile") data = { id: 1, username: "fixture", role: 0 }
                if (path === "/api/v1/setting")
                    data = {
                        config: { site_name: "防火墙测试", language: "zh-CN" },
                        version: "fixture",
                    }
                if (path === "/api/v1/waf")
                    data = { value: [], pagination: { total: 0, offset: 0, limit: 10 } }
                if (path === "/api/v1/waf/unknown-reports") {
                    if (fail)
                        return route.fulfill({
                            json: { success: false, error: "fixture unavailable" },
                        })
                    const offset = Number(url.searchParams.get("offset") || 0)
                    data = {
                        value: [
                            {
                                uuid: "12345678-1234-1234-1234-123456789abc",
                                name: offset ? "第二页节点" : "离线后删除的节点",
                                last_ip: "2001:db8:1234:5678:9abc:def0:1234:5678",
                                created_at: "2026-10-05T04:00:00Z",
                                first_report_at: 1791173000,
                                last_report_at: 1791174000,
                                report_count: 12,
                            },
                        ],
                        pagination: { total: 21, offset, limit: 20 },
                    }
                }
                return route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard/settings/waf")
            await expect(page.getByRole("tab", { name: "防火墙", exact: true })).toBeVisible()
            await expect(
                page.getByRole("tab", { name: "Web 防火墙", exact: true }),
            ).toHaveAttribute("data-state", "active")
            await page.getByRole("tab", { name: "未知上报", exact: true }).click()
            const panel = page.getByRole("tabpanel", { name: "未知上报", exact: true })
            await expect(panel).toContainText("离线后删除的节点")
            await expect(panel).toContainText("不会封禁同 IP")
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true)
            await page.screenshot({
                path: "test-results/firewall-" + width + "-" + dark + ".png",
                fullPage: true,
            })
            await panel.getByRole("button", { name: "下一页" }).click()
            await expect(panel).toContainText("第二页节点")
            await expect(panel.getByRole("button", { name: "下一页" })).toBeDisabled()
            fail = true
            await panel.getByRole("button", { name: "刷新", exact: true }).click()
            await expect(panel.getByRole("alert")).toBeVisible()
            await page.getByRole("tab", { name: "Web 防火墙", exact: true }).click()
            await expect(
                page.getByRole("tab", { name: "Web 防火墙", exact: true }),
            ).toHaveAttribute("data-state", "active")
            expect(writes).toEqual([])
        })
    }

for (const width of [360, 1366]) {
    test(
        "delete confirms, avoids duplicate requests and reports launch only " + width,
        async ({ page }) => {
            await page.setViewportSize({ width, height: 850 })
            await page.addInitScript(() => localStorage.setItem("i18nextLng", "zh-CN"))
            let deleted = false,
                calls = 0
            await page.route("**/api/v1/**", async (route) => {
                const path = new URL(route.request().url()).pathname
                let data: any = []
                if (path === "/api/v1/profile") data = { id: 1, username: "fixture", role: 0 }
                if (path === "/api/v1/setting")
                    data = { config: { language: "zh-CN" }, version: "fixture" }
                if (path === "/api/v1/server")
                    data = deleted
                        ? []
                        : [
                              {
                                  id: 11,
                                  name: "卸载测试节点",
                                  host: {},
                                  user_id: 1,
                                  uuid: "12345678-1234-1234-1234-123456789abc",
                                  hide_for_guest: false,
                                  hide_for_display: false,
                              },
                          ]
                if (path === "/api/v1/batch-delete/server") {
                    calls++
                    expect(route.request().postDataJSON()).toEqual([11])
                    await new Promise((resolve) => setTimeout(resolve, 400))
                    deleted = true
                    data = {
                        deleted: [11],
                        cleanup: [
                            { id: 11, status: "started", message: "已启动任务；不是卸载完成回执" },
                        ],
                    }
                }
                await route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            const row = page
                .getByRole("row")
                .filter({ has: page.getByText("卸载测试节点", { exact: true }) })
            await row.getByRole("button", { name: "卸载并删除节点" }).click()
            const dialog = page.getByRole("alertdialog")
            await expect(dialog).toContainText("仍会删除并拉黑")
            await dialog.getByRole("button", { name: "取消", exact: true }).click()
            expect(calls).toBe(0)
            await row.getByRole("button", { name: "卸载并删除节点" }).click()
            await dialog.getByRole("button", { name: "确认卸载并删除", exact: true }).click()
            await expect(dialog.getByRole("button", { name: "正在启动卸载并删除…" })).toBeDisabled()
            await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled()
            await expect(dialog).toContainText("删除结果")
            await expect(dialog).toContainText("“已启动”不是卸载完成回执")
            expect(calls).toBe(1)
            expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
            await page.screenshot({ path: "test-results/delete-result-" + width + ".png" })
            await dialog.getByRole("button", { name: "关闭", exact: true }).click()
            await expect(row).toHaveCount(0)
        },
    )
}
