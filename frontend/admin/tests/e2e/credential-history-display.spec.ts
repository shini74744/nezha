import { expect, test } from "@playwright/test"

const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const secret = "OnlyThisFixtureKey_" + "Ab9-".repeat(24)
for (const width of [320, 360, 1366])
    for (const dark of [false, true]) {
        test(
            "credential history labels and private reveal " + width + " " + dark,
            async ({ page }) => {
                await page.setViewportSize({ width, height: 900 })
                await page.addInitScript((dark) => {
                    localStorage.setItem("language", "zh-CN")
                    localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light")
                    Object.defineProperty(navigator, "clipboard", {
                        value: {
                            writeText: async (value: string) => {
                                ;(window as any).__copied = value
                            },
                        },
                    })
                }, dark)
                let used = false,
                    reads = 0,
                    fail = false,
                    hold: (() => void) | undefined,
                    delayed = false
                await page.route("**/api/v1/**", async (route) => {
                    const url = new URL(route.request().url()),
                        path = url.pathname
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
                    if (path === "/api/v1/agent-credentials/unused")
                        data = {
                            value:
                                used || url.searchParams.get("offset") !== "0"
                                    ? []
                                    : [
                                          {
                                              uuid,
                                              version: 1,
                                              fingerprint: "123456abcdef",
                                              created_at: "2026-10-14T05:22:03Z",
                                          },
                                      ],
                            pagination: { total: used ? 0 : 21 },
                        }
                    if (path === "/api/v1/agent-credentials/reuse") {
                        expect(route.request().postDataJSON()).toEqual({ uuid, version: 1 })
                        reads++
                        if (delayed)
                            await new Promise<void>((resolve) => {
                                hold = resolve
                            })
                        if (fail) {
                            await route.fulfill({
                                json: { success: false, error: "认证信息已使用或已变化，请刷新" },
                            })
                            return
                        }
                        data = { uuid, version: 1, client_secret: secret }
                    }
                    await route.fulfill({ json: { success: true, data } })
                })
                await page.goto("/dashboard")
                const top = page.getByRole("button", { name: "安装命令", exact: true }).first()
                async function openHistory() {
                    await top.click()
                    await page.getByRole("menuitem", { name: "生成认证历史", exact: true }).click()
                }
                await openHistory()
                const dialog = page.getByRole("dialog")
                const show = dialog.getByRole("button", {
                    name: "显示完整密钥：" + uuid,
                    exact: true,
                })
                await expect(dialog).toContainText("UUID：" + uuid)
                await expect(dialog).toContainText("密钥指纹：123456abcdef")
                await expect(dialog.locator("time")).toContainText("生成时间：")
                await expect(dialog.locator("time")).toHaveAttribute(
                    "datetime",
                    "2026-10-14T05:22:03Z",
                )
                await expect(dialog).toContainText("完整密钥：")
                await expect(dialog).not.toContainText(secret)
                expect(reads).toBe(0)
                await show.click()
                await expect(dialog).toContainText(secret)
                await dialog
                    .getByRole("button", { name: "复制完整密钥：" + uuid, exact: true })
                    .click()
                await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe(secret)
                expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                ).toBe(true)
                await page.screenshot({
                    path: "test-results/history-key-" + width + "-" + dark + ".png",
                    animations: "disabled",
                })
                await dialog
                    .getByRole("button", { name: "隐藏完整密钥：" + uuid, exact: true })
                    .click()
                await expect(dialog).not.toContainText(secret)
                await show.click()
                await expect(dialog).toContainText(secret)
                await page.keyboard.press("Escape")
                await openHistory()
                await expect(dialog).not.toContainText(secret)
                await show.click()
                await expect(dialog).toContainText(secret)
                await dialog.getByRole("button", { name: "下一页", exact: true }).click()
                await expect(dialog).not.toContainText(secret)
                await dialog.getByRole("button", { name: "上一页", exact: true }).click()
                await expect(show).toBeVisible()
                await expect(dialog).not.toContainText(secret)
                fail = true
                await show.click()
                await expect(
                    page.getByText("认证信息已使用或已变化，请刷新", { exact: true }),
                ).toBeVisible()
                await expect(dialog).not.toContainText(secret)
                fail = false
                delayed = true
                await show.click()
                await expect.poll(() => !!hold).toBe(true)
                await page.keyboard.press("Escape")
                await expect(dialog).toHaveCount(0)
                hold!()
                delayed = false
                await openHistory()
                await expect(dialog).not.toContainText(secret)
                await expect(show).toBeEnabled()
                await show.click()
                await expect(dialog).toContainText(secret)
                used = true
                await dialog.getByRole("button", { name: "刷新", exact: true }).click()
                await expect(dialog).toContainText("暂无未使用认证")
                await expect(dialog).not.toContainText(secret)
                const storage = await page.evaluate(() =>
                    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
                )
                expect(storage).not.toContain(secret)
            },
        )
    }
