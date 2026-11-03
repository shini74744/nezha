import { expect, test } from "@playwright/test"

for (const width of [320, 390, 844, 1440])
    for (const theme of ["light", "dark"]) {
        test("Home NIC picker " + width + " " + theme, async ({ page }, info) => {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
            await page.addInitScript(
                (theme) => localStorage.setItem("nezha-dashboard-theme", theme),
                theme,
            )
            const writes: any[] = []
            const errors: string[] = []
            page.on("pageerror", (error) => errors.push(error.message))
            const interfaces = [
                {
                    name: "enp2s0f0",
                    kind: "physical",
                    state: "up",
                    master: "br1204",
                    speed_mbps: 1000,
                    default_monitored: true,
                    monitored: true,
                },
                {
                    name: "enp2s0f1",
                    kind: "physical",
                    state: "up",
                    master: "br1205",
                    speed_mbps: 1000,
                    default_monitored: true,
                    monitored: true,
                },
                {
                    name: "br1204",
                    kind: "bridge",
                    state: "up",
                    default_monitored: true,
                    monitored: true,
                },
                {
                    name: "br1205",
                    kind: "bridge",
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
            ]
            const config = {
                ip_report_period: 1800,
                report_delay: 3,
                hard_drive_partition_allowlist: [],
                nic_allowlist: {},
                gpu: false,
                temperature: false,
                disable_force_update: true,
                network_interfaces: { available: true, interfaces },
            }
            await page.route("**/api/v1/**", async (route) => {
                const path = new URL(route.request().url()).pathname
                let data: any = []
                if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                if (path === "/api/v1/setting")
                    data = { config: { language: "zh-CN" }, version: "test" }
                if (path === "/api/v1/server")
                    data = [{ id: 96, name: "网卡测试节点", host: {}, user_id: 1 }]
                if (path === "/api/v1/server/config/96") data = JSON.stringify(config)
                if (path === "/api/v1/server/96/home-network") {
 data = {interfaces:["enp2s0f0"]};
 if(route.request().method()==="PUT"){writes.push(route.request().postDataJSON());data=route.request().postDataJSON()}
 }
 if (route.request().method() === "POST") {
                    expect(path).toBe("/api/v1/server/config")
                    writes.push(route.request().postDataJSON())
                    data = { success: [96], failure: [], offline: [] }
                }
                await route.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            const row = page
                .getByRole("row")
                .filter({ has: page.getByText("网卡测试节点", { exact: true }) })
            await row.locator('[data-column="actions"] button').nth(2).click()
            const dialog = page.getByRole("dialog")
            const group = dialog.getByRole("group", { name: "监控网卡" })

            await dialog.getByText(/首页显示网卡/).click()
            const home = dialog.locator("details").filter({hasText:"首页显示网卡"})
            await expect(home.getByRole("checkbox",{name:"首页统计 enp2s0f0",exact:true})).toBeChecked()
            await home.getByRole("checkbox",{name:"首页统计 enp2s0f1",exact:true}).check()
            await home.getByRole("button",{name:"保存首页设置"}).click()
            await expect.poll(()=>writes.length).toBe(1)
            expect(writes[0]).toEqual({interfaces:["enp2s0f0","enp2s0f1"]})
            expect(await home.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
            expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
            await home.screenshot({path:info.outputPath("home-picker.png")})
            expect(errors).toEqual([])
        })
    }
