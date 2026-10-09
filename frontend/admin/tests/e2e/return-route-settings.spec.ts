import { expect, test } from "@playwright/test"

const initial = () => ({
    revision: "r1",
    enabled: false,
    interval_hours: 6,
    retention_days: 1,
    protocol: "tcp",
    targets: [
        {
            id: "bj-ct",
            name: "北京",
            carrier: "电信",
            ipv4: "106.37.68.13",
            ipv6: "",
            enabled: true,
        },
    ],
})
for (const width of [1440, 390, 320])
    test("return-route settings preserve changes and save " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 })
        let state = initial(),
            saves: any[] = []
        let conflict = false
        await page.route("**/api/v1/**", (r) => {
            const path = new URL(r.request().url()).pathname
            let data: any = []
            if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
            if (path === "/api/v1/setting")
                data = { config: { site_name: "QA", language: "zh-CN" }, version: "qa" }
            if (path === "/api/v1/setting/connectivity")
                data = { revision: "r1", items: [], defaults: [], max_targets: 150 }
            if (path.endsWith("/automation"))
                data = { revision: "r1", enabled: false, interval_hours: 6, retention_days: 1 }
            if (path === "/api/v1/setting/return-route") {
                if (r.request().method() === "PUT") {
                    if (conflict)
                        return r.fulfill({
                            json: { success: false, error: "设置已被其他页面修改，请重新加载" },
                        })
                    state = { ...r.request().postDataJSON(), revision: "r2" }
                    saves.push(state)
                }
                data = state
            }
            return r.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard/settings/cards")
        await page.getByRole("tab", { name: "回程", exact: true }).click()
        await expect(
            page.getByRole("switch", { name: "回程自动检测", exact: true }),
        ).not.toBeChecked()
        await page.getByRole("switch", { name: "回程自动检测", exact: true }).click()
        await page.getByLabel("回程检测间隔（小时）", { exact: true }).fill("12")
        await page.getByLabel("回程记录保留（天）", { exact: true }).fill("3")
        await page.getByLabel("回程检测协议", { exact: true }).selectOption("icmp")
        const target = page.getByRole("button", { name: "北京 · 电信", exact: true })
        await target.click()
        await page.getByLabel("回程IPv6 地址 1", { exact: true }).fill("240e:904:800:1f80::b00:137")
        await target.click()
        await page.getByRole("tab", { name: "BGP", exact: true }).click()
        await page.getByRole("tab", { name: "回程", exact: true }).click()
        await target.click()
        await expect(page.getByLabel("回程IPv6 地址 1", { exact: true })).toHaveValue(
            "240e:904:800:1f80::b00:137",
        )
        await page.getByRole("button", { name: "保存回程设置", exact: true }).click()
        await expect.poll(() => saves.length).toBe(1)
        expect(saves[0]).toMatchObject({
            enabled: true,
            interval_hours: 12,
            retention_days: 3,
            protocol: "icmp",
        })
        await page.screenshot({
            path: info.outputPath("return-settings-" + width + ".png"),
            fullPage: true,
        })
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.getByRole("button", { name: "添加回程检测点", exact: true }).click()
        await expect(page.getByRole("button", { name: "保存回程设置", exact: true })).toBeDisabled()
        await page.getByRole("button", { name: "新地区 · 运营商", exact: true }).click()
        await page.getByLabel("回程IPv4 地址 2", { exact: true }).fill("1.1.1.1")
        conflict = true
        await page.getByRole("button", { name: "保存回程设置", exact: true }).click()
        await expect(page.getByRole("alert")).toContainText("设置已被其他页面修改")
        await expect(page.getByLabel("回程IPv4 地址 2", { exact: true })).toHaveValue("1.1.1.1")
        expect(saves).toHaveLength(1)
    })
