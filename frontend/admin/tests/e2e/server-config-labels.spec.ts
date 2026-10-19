import { expect, test } from "@playwright/test"
import { singleAgentConfigLabels } from "../../src/lib/agent-config-fields"

for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
    test("single configuration labels " + width + " " + theme, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 })
        await page.addInitScript(theme => localStorage.setItem("nezha-dashboard-theme", theme), theme)
        const writes: any[] = []
        const config = {
            ip_report_period: 1800, report_delay: 3,
            hard_drive_partition_allowlist: [], nic_allowlist: {},
            disable_auto_update: false, disable_force_update: true,
            disable_command_execute: false, disable_nat: false, disable_send_query: false,
            gpu: false, temperature: false, skip_connection_count: true,
            skip_procs_count: false, debug: false,
        }
        await page.route("**/api/v1/**", async route => {
            const path = new URL(route.request().url()).pathname
            let data: any = []
            if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
            if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
            if (path === "/api/v1/server") data = [{ id: 96, name: "测试电脑", host: {}, user_id: 1 }]
            if (path === "/api/v1/server/config/96") data = JSON.stringify(config)
            if (route.request().method() === "POST") {
                expect(path).toBe("/api/v1/server/config")
                writes.push(route.request().postDataJSON())
                data = { success: [96], failure: [], offline: [] }
            }
            await route.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard")
        const row = page.getByRole("row").filter({ has: page.getByText("测试电脑", { exact: true }) })
        await row.locator('[data-column="actions"] button').nth(2).click()
        const dialog = page.getByRole("dialog")
        await expect(dialog.getByRole("heading")).toHaveText("编辑服务器配置")
        for (const [key, label] of Object.entries(singleAgentConfigLabels)) {
            await expect(dialog.getByTitle(key, { exact: true })).toHaveText(label)
            await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(1)
        }
        await dialog.getByTitle("gpu", { exact: true }).hover()
        await expect(dialog.getByTitle("gpu", { exact: true })).toHaveAttribute("title", "gpu")
        await dialog.getByTitle("gpu", { exact: true }).click()
        await dialog.getByTitle("temperature", { exact: true }).click()
        await expect(dialog.getByRole("checkbox", { name: "GPU 监控", exact: true })).toBeChecked()
        await expect(dialog.getByRole("checkbox", { name: "温度监控", exact: true })).toBeChecked()
        await expect(dialog.getByRole("checkbox", { name: "禁用面板强制更新", exact: true })).toBeChecked()
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.screenshot({ animations: "disabled", path: info.outputPath("single-config.png") })
        await dialog.getByRole("button", { name: "提交", exact: true }).click()
        await expect.poll(() => writes.length).toBe(1)
        expect(writes[0].servers).toEqual([96])
        expect(JSON.parse(writes[0].config)).toMatchObject({ ...config, gpu: true, temperature: true })
    })
}
