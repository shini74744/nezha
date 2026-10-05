import { expect, test } from "@playwright/test"

for (const width of [360, 1366])
    for (const dark of [false, true]) {
        test(
            "per-node cleanup confirmation, errors, cancel and history " + width + "-" + dark,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 850 })
                await page.addInitScript((dark) => {
                    localStorage.setItem("language", "zh-CN")
                    localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light")
                }, dark)
                const rows = [
                    {
                        uuid: "aa777777-1111-4111-8111-111111111111",
                        name: "目标节点",
                        original_id: 42,
                        block_version: 1,
                        released_at: 0,
                        created_at: "2026-10-05T08:00:00Z",
                        report_count: 7,
                        cleanup_enabled: false,
                        cleanup_revision: 0,
                        cleanup_state: "off",
                        cleanup_message: "",
                        cleanup_last_attempt_at: 0,
                        cleanup_attempts: 0,
                        cleanup_round_attempts: 0,
                        cleanup_max_attempts: 3,
                        cleanup_next_attempt_at: 0,
                        cleanup_checked_at: 0,
                        cleanup_unavailable: "",
                    },
                    {
                        uuid: "bb777777-1111-4111-8111-111111111111",
                        name: "其他节点",
                        original_id: 43,
                        block_version: 1,
                        released_at: 0,
                        created_at: "2026-10-05T08:00:00Z",
                        report_count: 0,
                        cleanup_enabled: false,
                        cleanup_revision: 0,
                        cleanup_state: "off",
                        cleanup_message: "",
                        cleanup_last_attempt_at: 0,
                        cleanup_attempts: 0,
                        cleanup_round_attempts: 0,
                        cleanup_max_attempts: 3,
                        cleanup_next_attempt_at: 0,
                        cleanup_checked_at: 0,
                        cleanup_unavailable: "",
                    },
                    {
                        uuid: "cc777777-1111-4111-8111-111111111111",
                        name: "历史记录",
                        original_id: 44,
                        block_version: 1,
                        released_at: 0,
                        created_at: "2026-10-05T08:00:00Z",
                        report_count: 0,
                        cleanup_enabled: false,
                        cleanup_revision: 0,
                        cleanup_state: "off",
                        cleanup_message: "",
                        cleanup_last_attempt_at: 0,
                        cleanup_attempts: 0,
                        cleanup_round_attempts: 0,
                        cleanup_max_attempts: 3,
                        cleanup_next_attempt_at: 0,
                        cleanup_checked_at: 0,
                        cleanup_unavailable: "旧记录缺少原所属用户，无法安全校验重连身份",
                    },
                ]
                const requests: any[] = []
                let fail = true
                await page.route("**/api/v1/**", async (route) => {
                    const path = new URL(route.request().url()).pathname
                    let data: any = []
                    if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                    if (path === "/api/v1/setting")
                        data = { config: { language: "zh-CN" }, version: "fixture" }
                    if (path === "/api/v1/waf/deleted-servers")
                        data = { value: rows, pagination: { total: 3 } }
                    if (path === "/api/v1/waf/deleted-cleanup") {
                        expect(route.request().method()).toBe("POST")
                        const body = route.request().postDataJSON()
                        requests.push(body)
                        await new Promise((resolve) => setTimeout(resolve, 200))
                        if (fail)
                            return route.fulfill({
                                json: { success: false, error: "模拟保存失败" },
                            })
                        expect(body.uuid).toBe(rows[0].uuid)
                        expect(body.cleanup_revision).toBe(rows[0].cleanup_revision)
                        rows[0].cleanup_enabled = body.enabled
                        rows[0].cleanup_revision++
                        rows[0].cleanup_state = body.enabled ? "waiting" : "cancelled"
                        rows[0].cleanup_message = body.enabled
                            ? "等待有效重连后立即卸载；间隔 1 分钟检查，本轮最多 3 次"
                            : "已关闭；已下发的命令无法撤回"
                        data = rows[0]
                    } else expect(route.request().method()).toBe("GET")
                    await route.fulfill({ json: { success: true, data } })
                })
                await page.goto("/dashboard/settings/waf?tab=deleted")
                await page.getByRole("tab", { name: "已删除服务器", exact: true }).click()
                const panel = page.getByRole("tabpanel", { name: "已删除服务器", exact: true })
                const target = panel.locator("article").filter({ hasText: "目标节点" })
                const other = panel.locator("article").filter({ hasText: "其他节点" })
                const reportWarning = target
                    .getByText("删除后曾再次上报", { exact: true })
                    .locator("../..")
                await expect(reportWarning).toBeVisible()
                // The report warning belongs below UUID actions and above cleanup settings
                // on both mobile and desktop, not between the heading and UUID details.
                const releaseBox = await target
                    .getByRole("button", { name: "放行 UUID", exact: true })
                    .boundingBox()
                const warningBox = await reportWarning.boundingBox()
                const settingsBox = await target
                    .getByRole("button", { name: "自动卸载设置：目标节点" })
                    .boundingBox()
                expect(releaseBox && warningBox && settingsBox).toBeTruthy()
                expect(warningBox!.y).toBeGreaterThanOrEqual(releaseBox!.y + releaseBox!.height)
                expect(warningBox!.y + warningBox!.height).toBeLessThanOrEqual(settingsBox!.y)
                await target.getByRole("button", { name: "自动卸载设置：目标节点" }).click()
                const dialog = page.getByRole("alertdialog")
                await expect(dialog).toContainText("这是不可撤销操作")
                await expect(dialog).toContainText(rows[0].uuid)
                await expect(dialog).toContainText("不会放行 UUID")
                await expect(dialog).toContainText("本轮最多 3 次")
                await expect(dialog).toContainText("每隔 1 分钟")
                await expect
                    .poll(async () => {
                        const box = await dialog.boundingBox()
                        return !!box && box.x >= 15 && box.x + box.width <= width - 15
                    })
                    .toBe(true)
                expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                await page.screenshot({
                    path: "test-results/deleted-cleanup-dialog-" + width + "-" + dark + ".png",
                    animations: "disabled",
                })
                await dialog.getByRole("button", { name: "取消", exact: true }).click()
                expect(requests).toHaveLength(0)
                await target.getByRole("button", { name: "自动卸载设置：目标节点" }).click()
                await dialog.getByRole("button", { name: "确认开启", exact: true }).click()
                await expect(
                    dialog.getByRole("button", { name: "保存中…", exact: true }),
                ).toBeDisabled()
                await expect(dialog.getByRole("alert")).toHaveText("模拟保存失败")
                fail = false
                await dialog.getByRole("button", { name: "确认开启", exact: true }).click()
                await expect(dialog).toContainText("设置已保存")
                await dialog.getByRole("button", { name: "关闭", exact: true }).click()
                await expect(target).toContainText("等待重连")
                await expect(other).toContainText("未开启")
                expect(requests).toHaveLength(2)
                await target.getByRole("button", { name: "自动卸载设置：目标节点" }).click()
                await expect(dialog).toContainText("无法停止已经开始的远端卸载")
                await dialog.getByRole("button", { name: "确认关闭", exact: true }).click()
                await dialog.getByRole("button", { name: "关闭", exact: true }).click()
                await expect(target).toContainText("已关闭")
                expect(rows[1].cleanup_enabled).toBe(false)
                await panel.getByRole("button", { name: "自动卸载设置：历史记录" }).click()
                await expect(dialog).toContainText("无法安全校验重连身份")
                await expect(
                    dialog.getByRole("button", { name: "确认开启", exact: true }),
                ).toBeDisabled()
                await dialog.getByRole("button", { name: "取消", exact: true }).click()
                expect(requests).toHaveLength(3)
                rows[0].cleanup_state = "retry_wait"
                rows[0].cleanup_enabled = true
                rows[0].cleanup_round_attempts = 1
                rows[0].cleanup_next_attempt_at = Math.floor(Date.now() / 1000) + 60
                rows[0].cleanup_attempts = 1
                rows[0].cleanup_last_attempt_at = Math.floor(Date.now() / 1000)
                rows[0].cleanup_message = "等待启动回执超时，清理结果未知；1 分钟后检查"
                await panel.getByRole("button", { name: "刷新", exact: true }).click()
                await expect(target).toContainText("结果未知")
                await expect(target).toContainText("累计 1 次")
                await expect(target).toContainText("本轮 1/3 次")
                await expect(target).toContainText("下次检查")
                await expect(target).toContainText("UUID 已拉黑")
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
                rows[0].cleanup_state = "attention"
                rows[0].cleanup_round_attempts = 3
                rows[0].cleanup_attempts = 3
                rows[0].cleanup_enabled = false
                rows[0].cleanup_next_attempt_at = 0
                rows[0].cleanup_checked_at = Math.floor(Date.now() / 1000)
                rows[0].cleanup_message =
                    "多次卸载后仍可连接命令通道，已停止自动重试；请检查权限、守护进程或安装方式"
                await panel.getByRole("button", { name: "刷新", exact: true }).click()
                await expect(target).toHaveClass(/border-red-500/)
                await expect(target.getByRole("alert")).toContainText("自动卸载已停止")
                await expect(target).toContainText("本轮 3/3 次")
                await expect(target).toContainText("最近检查")
                await expect(other).not.toHaveClass(/border-red-500/)
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
                await page.screenshot({
                    path: "test-results/deleted-cleanup-cards-" + width + "-" + dark + ".png",
                    fullPage: true,
                    animations: "disabled",
                })
                rows[0].released_at = Math.floor(Date.now() / 1000)
                await panel.getByRole("button", { name: "刷新", exact: true }).click()
                await expect(target).not.toHaveClass(/border-red-500/)
                await expect(target.getByRole("alert")).toHaveCount(0)
                await expect(reportWarning).toHaveCount(0)
                await expect(target).toContainText("已停用（UUID 已放行）")
            },
        )
    }
