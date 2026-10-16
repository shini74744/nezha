import { expect, test } from "@playwright/test"

for (const width of [320, 390, 1024, 1440])
    for (const theme of ["light", "dark"]) {
        test("history snapshots and content " + width + " " + theme, async ({ page }, info) => {
            await page.setViewportSize({ width, height: width === 320 ? 640 : 900 })
            await page.addInitScript(
                (value) => localStorage.setItem("nezha-dashboard-theme", value),
                theme,
            )
            const errors: string[] = [],
                writes: string[] = []
            page.on("pageerror", (error) => errors.push(error.message))
            const identity = {
                server_uuid: "fixture-history",
                server_id: 122,
                server_name: "双栈测试节点",
            }
            const before = { name: "修改前公开配置", text: "原始内容\n".repeat(70) }
            const after = {
                name: "修改后公开配置",
                html: '<img src=x onerror="window.historyExecuted=true">',
                text: "very-long-content-".repeat(150),
            }
            const rows = [
                {
                    ...identity,
                    id: 3,
                    action: "inventory_change",
                    source: "agent",
                    actor_name: "Agent",
                    created_at: "2026-10-16T04:33:01+08:00",
                    changes: [{ field: "ipv4", before: "192.0.2.1", after: "192.0.2.2" }],
                    details: {
                        ip_snapshot: [
                            {
                                field: "ipv4",
                                before: "192.0.2.1",
                                after: "192.0.2.2",
                                observed: true,
                            },
                            {
                                field: "ipv6",
                                before: "2001:db8:aaaa:bbbb:cccc:dddd:eeee:1111",
                                after: "2001:db8:aaaa:bbbb:cccc:dddd:eeee:1111",
                                observed: true,
                            },
                        ],
                    },
                },
                {
                    ...identity,
                    id: 2,
                    action: "edit",
                    source: "web",
                    actor_name: "admin",
                    created_at: "2026-10-16T04:30:01+08:00",
                    changes: [{ field: "public_note", before: "已设置", after: "已设置" }],
                    details: {
                        public_note: {
                            before: JSON.stringify(before),
                            after: JSON.stringify(after),
                        },
                    },
                },
                {
                    ...identity,
                    id: 1,
                    action: "edit",
                    source: "web",
                    actor_name: "admin",
                    created_at: "2026-10-15T04:30:01+08:00",
                    changes: [
                        {
                            field: "public_note",
                            before: "已设置（内容不记录）",
                            after: "已设置（内容不记录）",
                        },
                    ],
                },
            ]
            await page.route("**/api/v1/**", async (route) => {
                const url = new URL(route.request().url())
                if (!["GET", "HEAD"].includes(route.request().method())) writes.push(url.pathname)
                let data: unknown = []
                if (url.pathname === "/api/v1/profile") data = { id: 1, role: 0, username: "admin" }
                if (url.pathname === "/api/v1/setting")
                    data = { config: { language: "zh-CN" }, version: "test" }
                if (url.pathname === "/api/v1/server/operation-servers")
                    data = {
                        value: [
                            {
                                ...identity,
                                count: 3,
                                position: 1,
                                last_id: 3,
                                last_at: 1792096381000,
                            },
                        ],
                        pagination: { total: 1 },
                    }
                if (url.pathname === "/api/v1/server/operations") {
                    const result = url.searchParams.get("field") === "ip" ? [rows[0]] : rows
                    data = { value: result, pagination: { total: result.length } }
                }
                await route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            await page.getByRole("button", { name: "历史记录", exact: true }).click()
            const history = page.getByRole("dialog", { name: "服务器历史记录", exact: true })
            await history.getByRole("button", { name: /双栈测试节点.*系统 ID 122/ }).click()
            const dialog = page.getByRole("dialog", {
                name: "双栈测试节点 · 历史记录",
                exact: true,
            })
            await dialog.getByRole("button", { name: "IP", exact: true }).click()
            await expect(dialog).toContainText("未变化")
            await expect(dialog.locator("summary")).toContainText("1 项变更")
            await expect(dialog).toContainText("2001:db8:aaaa:bbbb:cccc:dddd:eeee:1111")
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            await page.screenshot({
                path: info.outputPath("history-dual-stack.png"),
                animations: "disabled",
            })
            await dialog.getByRole("button", { name: "全部", exact: true }).click()
            const edit = dialog.locator("details").nth(1)
            await edit.locator("summary").click()
            await expect(edit.getByRole("button", { name: "查看修改前内容" })).toBeVisible()
            await expect(edit.getByRole("button", { name: "查看修改后内容" })).toBeVisible()
            await edit.getByRole("button", { name: "查看修改前内容" }).scrollIntoViewIfNeeded()
            await expect(edit.getByRole("button", { name: "查看修改前内容" })).toBeInViewport()
            await page.screenshot({
                path: info.outputPath("history-content-buttons.png"),
                animations: "disabled",
            })
            for (const side of ["修改前", "修改后"]) {
                await edit.getByRole("button", { name: "查看" + side + "内容" }).click()
                const viewer = page.getByRole("dialog", {
                    name: "公开配置／备注 · " + side,
                    exact: true,
                })
                await expect(viewer).toBeVisible()
                await expect(viewer.locator("pre")).toContainText(side + "公开配置")
                expect(await viewer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
                    true,
                )
                expect(
                    await viewer
                        .locator("pre")
                        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
                ).toBe(true)
                await expect(viewer.getByRole("button", { name: "Close" })).toBeInViewport()
                await page.screenshot({
                    path: info.outputPath("history-" + side + ".png"),
                    animations: "disabled",
                })
                await viewer.getByRole("button", { name: "Close" }).click()
                await expect(dialog).toBeVisible()
            }
            expect(
                await page.evaluate(
                    () => (window as unknown as { historyExecuted?: boolean }).historyExecuted,
                ),
            ).toBeUndefined()
            const legacy = dialog.locator("details").nth(2)
            await legacy.locator("summary").click()
            await expect(legacy.getByRole("button", { name: "查看修改前内容" })).toBeDisabled()
            await expect(legacy.getByRole("button", { name: "查看修改后内容" })).toHaveAttribute(
                "title",
                /旧记录未保存/,
            )
            expect(errors).toEqual([])
            expect(writes).toEqual([])
        })
    }
