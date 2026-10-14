import { expect, test } from "@playwright/test"

for (const width of [320, 390, 1024, 1440])
    for (const theme of ["light", "dark"]) {
        test("server history and replacement " + width + " " + theme, async ({ page }, info) => {
            await page.setViewportSize({ width, height: width === 320 ? 640 : 900 })
            await page.addInitScript(
                (theme) => localStorage.setItem("nezha-dashboard-theme", theme),
                theme,
            )
            const errors: string[] = []
            const writes: any[] = []
            const queries: URLSearchParams[] = []
            page.on("pageerror", (error) => errors.push(error.message))
            const identity = {
                server_uuid: "11111111-1111-4111-8111-111111111111",
                server_id: 63,
                server_name: "主站服务器",
            }
            const changes = [
                { field: "cpu", before: "Intel Xeon CPU A × 2", after: "AMD EPYC CPU B × 4" },
                { field: "memory_total", before: "4294967296", after: "8589934592" },
                {
                    field: "ipv6",
                    before: "2001:db8:aaaa:bbbb:cccc:dddd:eeee:1111",
                    after: "2001:db8:aaaa:bbbb:cccc:dddd:eeee:2222",
                },
            ]
            await page.route("**/api/v1/**", async (route) => {
                const url = new URL(route.request().url())
                let data: any = []
                if (url.pathname === "/api/v1/profile")
                    data = { id: 1, role: 0, username: "admin", agent_secret: "fixture-normal" }
                if (url.pathname === "/api/v1/setting")
                    data = {
                        config: {
                            language: "zh-CN",
                            install_host: "fixture.invalid:443",
                            tls: true,
                        },
                        version: "test",
                    }
                if (url.pathname === "/api/v1/server")
                    data = [
                        {
                            id: 63,
                            uuid: identity.server_uuid,
                            name: identity.server_name,
                            host: {},
                            owner: { id: 1, username: "admin" },
                        },
                    ]
                if (url.pathname === "/api/v1/server/operation-servers")
                    data = {
                        value: [
                            {
                                ...identity,
                                position: 1,
                                count: 25,
                                last_id: 25,
                                last_at: 1791806400000,
                                deleted: false,
                            },
                        ],
                        pagination: { total: 1 },
                    }
                if (url.pathname === "/api/v1/server/operations") {
                    queries.push(url.searchParams)
                    const field = url.searchParams.get("field")
                    const filtered =
                        field === "cpu"
                            ? [changes[0]]
                            : field === "memory"
                              ? [changes[1]]
                              : field === "ip"
                                ? [changes[2]]
                                : changes
                    data = {
                        value: [
                            {
                                ...identity,
                                id: 25,
                                created_at: "2026-10-12T12:30:18Z",
                                actor_name: "Agent",
                                source: "agent",
                                action: "inventory_change",
                                changes: filtered,
                            },
                        ],
                        pagination: { total: field ? 1 : 25 },
                    }
                }
                if (route.request().method() === "POST") {
                    writes.push({ path: url.pathname, body: route.request().postDataJSON() })
                    if (url.pathname === "/api/v1/server/replacement-command")
                        data = {
                            secret: "nzreplace_fixture-only",
                            expires_at: "2026-10-12T15:00:00Z",
                        }
                    else if (url.pathname === "/api/v1/server/operations/delete") data = 1
                    else throw Error("unexpected write " + url.pathname)
                }
                await route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            const row = page
                .getByRole("row")
                .filter({ has: page.getByText("主站服务器", { exact: true }) })
            const historyButton = row.getByRole("button", {
                name: "查看 主站服务器 的历史记录",
                exact: true,
            })
            await expect(historyButton).toBeVisible()
            const idWidth = await row
                .locator('[data-column="id"]')
                .evaluate((el) => el.getBoundingClientRect().width)
            expect(idWidth).toBeLessThanOrEqual(50)
            const buttons = row.locator('[data-column="actions"] button')
            await expect(buttons.last()).toHaveAttribute("aria-label", "查看 主站服务器 的历史记录")
            await page.screenshot({
                animations: "disabled",
                path: info.outputPath("server-list.png"),
            })
            await historyButton.click()
            const dialog = page.getByRole("dialog")
            await expect(dialog.getByRole("heading")).toContainText("主站服务器")
            await dialog.getByRole("button", { name: "CPU", exact: true }).click()
            await expect.poll(() => queries.at(-1)?.get("field")).toBe("cpu")
            expect(queries.at(-1)?.get("uuid")).toBe(identity.server_uuid)
            await expect(dialog).toContainText("Intel Xeon CPU A")
            await expect(dialog).toContainText("AMD EPYC CPU B")
            await expect(dialog).not.toContainText("内存容量")
            await expect(dialog).toContainText("检测到变化：")
            await expect(dialog).toContainText("2026")
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            await page.screenshot({
                animations: "disabled",
                path: info.outputPath("history-cpu.png"),
            })
            await dialog.getByRole("button", { name: "内存", exact: true }).click()
            await expect(dialog).toContainText("内存容量")
            await expect(dialog).toContainText("8.00 GiB")
            await dialog.getByRole("button", { name: "IP", exact: true }).click()
            await expect(dialog).toContainText("2001:db8:aaaa:bbbb")
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            await dialog.getByRole("button", { name: "删除此记录", exact: true }).click()
            await expect(page.getByRole("alertdialog")).toBeVisible()
            await page.getByRole("button", { name: "取消", exact: true }).click()
            expect(writes).toHaveLength(0)
            await dialog.getByRole("button", { name: "全部服务器", exact: true }).click()
            await expect(
                dialog.getByRole("button", { name: /主站服务器.*系统 ID 63/ }),
            ).toBeVisible()
            await page.screenshot({
                animations: "disabled",
                path: info.outputPath("history-cards.png"),
            })
            await dialog.getByRole("button", { name: "Close", exact: true }).click()
            await row.getByRole("button", { name: "认证信息", exact: true }).click()
            await page.getByRole("menuitem", { name: "清理数据换机安装命令", exact: true }).click()
            await expect(dialog.getByRole("heading")).toHaveText("清理数据换机安装命令")
            expect(writes).toHaveLength(0)
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            await expect(
                dialog.getByRole("button", { name: "确认并复制命令", exact: true }),
            ).toBeInViewport()
            await page.screenshot({
                animations: "disabled",
                path: info.outputPath("replacement-review.png"),
            })
            await dialog.getByRole("button", { name: "确认并复制命令", exact: true }).click()
            await expect(dialog.getByRole("textbox", { name: "换机安装命令" })).toHaveValue(
                /nzreplace_fixture-only/,
            )
            await expect(dialog.getByRole("textbox", { name: "换机安装命令" })).not.toHaveValue(
                /fixture-normal/,
            )
            expect(writes).toEqual([
                {
                    path: "/api/v1/server/replacement-command",
                    body: { uuid: identity.server_uuid, confirmed: true },
                },
            ])
            expect(errors).toEqual([])
        })
    }
