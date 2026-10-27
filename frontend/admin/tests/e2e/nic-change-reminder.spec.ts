import { expect, test } from "@playwright/test"

for (const width of [320, 390, 844, 1440])
    for (const theme of ["light", "dark"]) {
        test("NIC one-time reminder " + width + " " + theme, async ({ page }, info) => {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
            await page.addInitScript(
                (theme) => localStorage.setItem("nezha-dashboard-theme", theme),
                theme,
            )
            const writes: string[] = []
            let unread = true
            const errors: string[] = []
            page.on("pageerror", (error) => errors.push(error.message))
            const config = {
                ip_report_period: 1800,
                report_delay: 3,
                hard_drive_partition_allowlist: [],
                nic_allowlist: null,
                network_interfaces: {
                    available: true,
                    interfaces: [
                        {
                            name: "eth0",
                            kind: "physical",
                            state: "up",
                            default_monitored: true,
                            monitored: true,
                        },
                        {
                            name: "ppp0",
                            kind: "ppp",
                            state: "up",
                            default_monitored: true,
                            monitored: true,
                        },
                        {
                            name: "lo",
                            kind: "loopback",
                            state: "up",
                            default_monitored: false,
                            monitored: false,
                        },
                    ],
                },
            }
            await page.route("**/api/v1/**", async (route) => {
                const path = new URL(route.request().url()).pathname
                let data: any = []
                if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                if (path === "/api/v1/setting")
                    data = { config: { language: "zh-CN" }, version: "test" }
                if (path === "/api/v1/server")
                    data = [{ id: 96, name: "网口提醒测试节点", host: {}, user_id: 1 }]
                if (path === "/api/v1/server/config/96") data = JSON.stringify(config)
                if (path === "/api/v1/server/nic-change-reminders")
                    data = unread ? { "96": "event-a" } : {}
                if (route.request().method() === "POST") {
                    expect(path).toBe("/api/v1/server/96/nic-change-read")
                    expect(route.request().postDataJSON()).toEqual({ event_id: "event-a" })
                    writes.push(path)
                    unread = false
                    data = true
                }
                await route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            const cog = page.getByRole("button", { name: "配置，网口变化待查看", exact: true })
            await expect(cog).toBeVisible()
            await cog.scrollIntoViewIfNeeded()
            const dot = await cog.evaluate((el) => {
                const style = getComputedStyle(el, "::after")
                return {
                    width: style.width,
                    height: style.height,
                    background: style.backgroundColor,
                    position: style.position,
                }
            })
            expect(dot.width).toBe("8px")
            expect(dot.height).toBe("8px")
            expect(dot.position).toBe("absolute")
            await page.screenshot({ path: info.outputPath("gear-unread.png") })
            expect(writes).toHaveLength(0)
            await cog.click()
            const dialog = page.getByRole("dialog")
            const notice = dialog.getByText("原来选择的网口已变化，已恢复默认统计。")
            await notice.scrollIntoViewIfNeeded()
            await expect(notice).toBeVisible()
            await expect.poll(() => writes.length).toBe(1)
            await expect(dialog).toBeVisible()
            await expect(page.locator("[data-nic-unread]")).toHaveCount(0)
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            const previous = await notice.evaluate(
                (el) =>
                    el.previousElementSibling?.querySelector('[aria-label="监控网卡"]') !== null,
            )
            expect(previous).toBe(true)
            await page.screenshot({ path: info.outputPath("notice-visible.png") })
            await dialog.getByRole("button", { name: "Close", exact: true }).click()
            const row = page
                .getByRole("row")
                .filter({ has: page.getByText("网口提醒测试节点", { exact: true }) })
            await row.locator('[data-column="actions"] button').nth(2).click()
            await expect(dialog.getByRole("group", { name: "监控网卡" })).toBeVisible()
            await expect(notice).toHaveCount(0)
            await page.reload()
            await expect(page.locator("[data-nic-unread]")).toHaveCount(0)
            expect(writes).toHaveLength(1)
            expect(errors).toEqual([])
        })
    }
