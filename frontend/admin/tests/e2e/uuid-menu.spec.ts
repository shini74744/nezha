import { expect, test } from "@playwright/test"

const uuid = "b0d3f198-b91b-e24e-6f33-50ee178198a3"
for (const width of [1366, 390]) {
    for (const os of ["Linux", "macOS", "Windows"]) {
        test("UUID copy menu " + width + " " + os, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 })
            await page.addInitScript(() => {
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
            await page.route("**/api/v1/**", async (route) => {
                const path = new URL(route.request().url()).pathname
                let data: any = []
                if (path === "/api/v1/profile")
                    data = { id: 1, username: "admin", role: 0, agent_secret: "fixture-secret" }
                if (path === "/api/v1/setting")
                    data = {
                        config: { language: "zh-CN", install_host: "panel.example:443", tls: true },
                        version: "test",
                    }
                if (path === "/api/v1/server")
                    data = [
                        {
                            id: 12,
                            name: "UUID 测试",
                            uuid,
                            user_id: 1,
                            host: {},
                            note: "",
                            public_note: "",
                        },
                    ]
                await route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            const trigger = page.getByRole("button", {
                name: "UUID 操作",
                exact: true,
                includeHidden: true,
            })
            await trigger.click({ trial: true })
            const row = trigger.locator("xpath=ancestor::tr")
            const before = await row.boundingBox()
            await trigger.click()
            const menu = page.getByRole("menu").first()
            await expect(menu).toBeVisible()
            const box = (await menu.boundingBox())!,
                button = (await trigger.boundingBox())!
            expect(box.width).toBeLessThanOrEqual(260)
            expect(box.height).toBeLessThan(110)
            expect(Math.abs(box.y - (button.y + button.height))).toBeLessThan(12)
            expect((await row.boundingBox())!.height).toBe(before!.height)
            await page.getByRole("menuitem", { name: "复制 UUID", exact: true }).click()
            await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe(uuid)
            await expect(trigger).toHaveAttribute("data-state", "closed")
            await expect(menu).toHaveCount(0)
            await trigger.click()
            await expect(menu).toBeVisible()
            await page
                .getByRole("menuitem", { name: "复制带此 UUID 的安装命令", exact: true })
                .click()
            await page.getByRole("menuitem", { name: os, exact: true }).click()
            const text = await page.evaluate(() => (window as any).__copied)
            expect(text).toContain("shini74744/agent/main/scripts/install.")
            expect(text).toContain("NZ_UUID='" + uuid + "'")
            expect(text).toContain("NZ_CLIENT_SECRET='fixture-secret'")
            expect(text).toContain("NZ_SERVER='panel.example:443'")
            expect(text).not.toContain("NZ_CLIENT_SECRET='" + uuid + "'")
            if (os !== "Windows") expect(text).toContain("-o agent.sh && chmod +x agent.sh")
            await expect(trigger).toHaveAttribute("data-state", "closed")
            await expect(menu).toHaveCount(0)
            await trigger.click()
            await expect(menu).toBeVisible()
            await page.screenshot({ path: "test-results/uuid-menu-" + width + "-" + os + ".png", animations: "disabled" })
            await page.keyboard.press("Escape")
            await expect(menu).toHaveCount(0)
            expect(errors).toEqual([])
        })
    }
}
