import { expect } from "@playwright/test"

import { csrfHeaders, defaultAdmin, loginAs, test } from "./fixtures"

// This suite deliberately uses real HTTP handlers. Never run on a public panel.
test.skip(process.env.E2E_CREDENTIAL_FIXTURE !== "1", "requires isolated loopback fixture")
test.beforeEach(async () => {
    const url = new URL(process.env.E2E_BASE_URL || "http://localhost:5173")
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(url.hostname)
})

for (const width of [360, 1366]) {
    test(
        "real credential issuance, cross-platform reuse, revocation and CSRF " + width,
        async ({ page }) => {
            await page.setViewportSize({ width, height: 900 })
            await page.addInitScript(() => {
                localStorage.setItem("language", "zh-CN")
                Object.defineProperty(navigator, "clipboard", {
                    value: {
                        writeText: async (text: string) => {
                            ;(window as any).__copied = text
                        },
                    },
                })
            })
            const errors: string[] = []
            page.on("pageerror", (e) => errors.push(e.message))
            await loginAs(page, defaultAdmin)
            const issued: Array<{ uuid: string; client_secret: string; version: number }> = []
            const issuePath = "/api/v1/agent-credentials/issue"
            try {
                const top = page.getByRole("button", { name: "安装命令", exact: true }).first()
                for (const os of ["Windows", "Linux", "macOS"]) {
                    await top.click()
                    const response = page.waitForResponse(
                        (r) => r.url().endsWith(issuePath) && r.request().method() === "POST",
                    )
                    await page.getByRole("menuitem", { name: os, exact: true }).click()
                    const result = await response
                    expect(result.status()).toBe(200)
                    expect(result.headers()["cache-control"]).toBe("no-store")
                    issued.push((await result.json()).data)
                    await expect
                        .poll(() => page.evaluate(() => (window as any).__copied))
                        .toContain(issued.at(-1)!.uuid)
                    const command = await page.evaluate(() => (window as any).__copied)
                    expect(command).toContain("https://raw.githubusercontent.com/shini74744/nezha/main/agent/scripts/install.")
                    expect(command).toContain(issued.at(-1)!.client_secret)
                    expect(command).not.toContain("shini74744/agent/")
                }
                expect(issued[0].uuid).not.toBe(issued[1].uuid)
                expect(issued[0].client_secret).not.toBe(issued[1].client_secret)
                const listing = await page.request.get("/api/v1/agent-credentials/unused")
                const body = await listing.json()
                for (const pair of issued) {
                    expect(body.data.value.some((row: any) => row.uuid === pair.uuid)).toBe(true)
                    expect(JSON.stringify(body)).not.toContain(pair.client_secret)
                }
                const forbidden = await page.request.post(issuePath, { data: {} })
                expect(forbidden.status()).toBe(403)
                const before = body.data.pagination.total
                const after = await page.request
                    .get("/api/v1/agent-credentials/unused")
                    .then((r) => r.json())
                expect(after.data.pagination.total).toBe(before)

                await top.click()
                await page.getByRole("menuitem", { name: "生成认证历史", exact: true }).click()
                const dialog = page.getByRole("dialog")
                await expect(dialog).toContainText("UUID：" + issued[0].uuid)
                await expect(dialog.locator("time").first()).toContainText("生成时间：")
                await expect(dialog).not.toContainText(issued[0].client_secret)
                const revealResponse = page.waitForResponse((r) =>
                    r.url().endsWith("/agent-credentials/reuse"),
                )
                await dialog
                    .getByRole("button", { name: "显示完整密钥：" + issued[0].uuid, exact: true })
                    .click()
                const revealedResponse = await revealResponse
                expect(revealedResponse.headers()["cache-control"]).toBe("no-store")
                const revealed = (await revealedResponse.json()).data
                expect(revealed).toEqual(issued[0])
                await expect(dialog).toContainText(issued[0].client_secret)
                await dialog
                    .getByRole("button", { name: "复制完整密钥：" + issued[0].uuid, exact: true })
                    .click()
                await expect
                    .poll(() => page.evaluate(() => (window as any).__copied))
                    .toBe(issued[0].client_secret)
                await dialog
                    .getByRole("button", { name: "隐藏完整密钥：" + issued[0].uuid, exact: true })
                    .click()
                await expect(dialog).not.toContainText(issued[0].client_secret)
                const reuseResponse = page.waitForResponse((r) =>
                    r.url().endsWith("/agent-credentials/reuse"),
                )
                await dialog.getByRole("button", { name: "复用", exact: true }).first().click()
                await page.getByRole("menuitem", { name: "macOS", exact: true }).click()
                const reused = (await (await reuseResponse).json()).data
                expect(
                    issued.some(
                        (pair) =>
                            pair.uuid === reused.uuid &&
                            pair.client_secret === reused.client_secret,
                    ),
                ).toBe(true)
                await expect
                    .poll(() => page.evaluate(() => (window as any).__copied))
                    .toContain(reused.uuid)
                expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
                const bounds = (await dialog.boundingBox())!
                expect(bounds.x).toBeGreaterThanOrEqual(8)
                expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8)

                const deleted = issued[0]
                await dialog
                    .getByRole("button", { name: "删除未使用认证：" + deleted.uuid, exact: true })
                    .click()
                await page
                    .getByRole("alertdialog")
                    .getByRole("button", { name: "删除认证", exact: true })
                    .click()
                await expect(
                    dialog.locator("article").filter({ hasText: deleted.uuid }),
                ).toHaveCount(0)
                const stale = await page.request.post("/api/v1/agent-credentials/reuse", {
                    headers: await csrfHeaders(page),
                    data: { uuid: deleted.uuid, version: deleted.version },
                })
                expect((await stale.json()).success).not.toBe(true)
                expect(errors).toEqual([])
            } finally {
                for (const pair of issued) {
                    await page.request.post("/api/v1/agent-credentials/delete", {
                        headers: await csrfHeaders(page),
                        data: { uuid: pair.uuid, version: pair.version },
                    })
                }
            }
        },
    )
}
