import { expect, test } from "@playwright/test"

for (const width of [320, 390, 1440])
    for (const theme of ["light", "dark"])
        test("history identity display " + width + " " + theme, async ({ page }, info) => {
            await page.setViewportSize({ width, height: 900 })
            await page.addInitScript(
                (theme) => localStorage.setItem("nezha-dashboard-theme", theme),
                theme,
            )
            const requests: string[] = [],
                errors: string[] = [],
                writes: string[] = []
            page.on("pageerror", (error) => errors.push(error.message))
            await page.route("**/api/v1/**", async (route) => {
                const request = route.request(),
                    url = new URL(request.url())
                if (!["GET", "HEAD"].includes(request.method())) writes.push(url.pathname)
                let data: unknown = []
                if (url.pathname === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                if (url.pathname === "/api/v1/setting")
                    data = { config: { language: "zh-CN" }, version: "test" }
                if (url.pathname === "/api/v1/server/operations") {
                    requests.push(url.search)
                    data = {
                        value: [
                            {
                                id: 1,
                                created_at: "2026-10-10T00:00:00+08:00",
                                server_uuid: "legacy-internal-identity-not-for-display",
                                server_id: 122,
                                previous_id: 63,
                                server_name: "台湾Hinet物理机2",
                                actor_id: 1,
                                actor_name: "admin",
                                source: "web",
                                action: "release_uuid",
                                changes: [
                                    { field: "uuid_block", before: "已封禁", after: "已放行" },
                                ],
                            },
                        ],
                        pagination: { total: 41 },
                    }
                }
                await route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            await page.getByRole("button", { name: "历史记录", exact: true }).click()
            const dialog = page.getByRole("dialog")
            await expect(dialog.getByText("台湾Hinet物理机2", { exact: false })).toBeVisible()
            await expect(dialog.getByLabel("搜索节点历史")).toHaveAttribute(
                "placeholder",
                "名称 / 原 ID / 当前 ID",
            )
            await expect(dialog).not.toContainText("UUID")
            await dialog.locator("summary").click()
            await expect(dialog.getByText("节点身份封禁状态", { exact: true })).toBeVisible()
            await expect(dialog.getByText("修改后已放行", { exact: true })).toBeVisible()
            await expect(dialog).not.toContainText("legacy-internal-identity-not-for-display")
            await expect(dialog.locator("summary")).toContainText("#63 → #122")
            await dialog.getByRole("button", { name: "下一页", exact: true }).click()
            await expect.poll(() => new URLSearchParams(requests.at(-1)).get("offset")).toBe("20")
            await dialog.getByLabel("搜索节点历史").fill("  122  ")
            await dialog.getByRole("button", { name: "搜索", exact: true }).click()
            await expect.poll(() => new URLSearchParams(requests.at(-1)).get("q")).toBe("122")
            expect(new URLSearchParams(requests.at(-1)).get("offset")).toBe("0")
            await dialog.getByLabel("操作类型").selectOption({ label: "解除节点封禁" })
            await expect
                .poll(() => new URLSearchParams(requests.at(-1)).get("action"))
                .toBe("release_uuid")
            await dialog.getByLabel("搜索节点历史").fill("台湾")
            await dialog.getByRole("button", { name: "搜索", exact: true }).click()
            await expect.poll(() => new URLSearchParams(requests.at(-1)).get("q")).toBe("台湾")
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            await expect(dialog.getByRole("heading", { name: "服务器操作历史" })).toBeInViewport()
            await expect(dialog.getByLabel("搜索节点历史")).toBeInViewport()
            await page.screenshot({ path: info.outputPath("history-identity.png") })
            expect(errors).toEqual([])
            expect(writes).toEqual([])
        })
