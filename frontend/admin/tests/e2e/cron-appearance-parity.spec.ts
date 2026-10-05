import { test, expect } from "@playwright/test"
import fs from "node:fs"

const manifest = JSON.parse(fs.readFileSync(new URL("../../src/lib/dashboard-appearance-manifest.json", import.meta.url), "utf8"))
for (const dark of [false, true]) for (const enabled of [false, true]) for (const width of [320, 1366]) {
    test("task UI follows dashboard " + [dark, enabled, width].join("-"), async ({ page }) => {
        await page.setViewportSize({ width, height: 850 })
        await page.addInitScript(dark => {
            localStorage.setItem("nezha-dashboard-theme", dark ? "dark" : "light")
            localStorage.setItem("i18nextLng", "zh-CN")
        }, dark)
        const config = { version: 1, enabled, features: Object.fromEntries(manifest.map((d: any) => [d.key, {
            ...d.defaults, enabled: d.key === "appearance" || d.key === "background",
        }])) }
        config.features.background.image = "http://127.0.0.1:5188/qa-wallpaper.svg"
        config.features.font = { ...config.features.font, enabled: true, cssUrl: "", family: "Arial", size: "18px" }
        let populated = false
        const writes: string[] = []
        await page.route("**/api/v1/**", async route => {
            const request = route.request(), path = new URL(request.url()).pathname
            if (request.method() !== "GET" && path !== "/api/v1/refresh-token" && path !== "/api/v1/cron/preview") writes.push(path)
            let data: any = []
            if (path === "/api/v1/cron/preview") data = { timezone: "Asia/Shanghai", next: [] }
            if (path === "/api/v1/profile") data = { id: 1, username: "preview", role: 0 }
            if (path === "/api/v1/setting") data = { config: { site_name: "测试面板", language: "zh-CN", dashboard_appearance_config: JSON.stringify(config) }, version: "test" }
            if (path === "/api/v1/cron" && populated) data = [{
                id: 1, name: "巡检任务", task_type: 1, command: "df -h", scheduler: "",
                servers: [1], cover: 0, notification_group_id: 0, push_successful: false,
                last_executed_at: "0001-01-01T00:00:00Z", last_result: false,
            }]
            await route.fulfill({ json: { success: true, data } })
        })
        await page.route("**/qa-wallpaper.svg", r => r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#123326"/><stop offset="1" stop-color="#44875f"/></linearGradient></defs><path fill="url(#g)" d="M0 0h1200v850H0z"/></svg>' }))
        await page.goto("/dashboard/service")
        const heading = page.locator("h1")
        await expect(heading).toBeVisible()
        const baseline = await heading.evaluate(e => {
            const s = getComputedStyle(e)
            return { color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing, x: e.getBoundingClientRect().x }
        })
        await page.goto("/dashboard/cron")
        if (enabled) await expect(page.locator("html")).toHaveAttribute("data-nz-dashboard", "true")
        else await expect(page.locator("html")).not.toHaveAttribute("data-nz-dashboard")
        await expect(page.getByRole("heading", { name: "还没有任务" })).toBeVisible()
        expect(await page.locator("h1").evaluate(e => {
            const s = getComputedStyle(e)
            return { color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing, x: e.getBoundingClientRect().x }
        })).toEqual(baseline)
        await expect(page.locator(".cron-page-heading")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
        await expect(page.locator(".cron-empty")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
        expect(await page.locator(".cron-empty").evaluate(e => e.getBoundingClientRect().height)).toBeLessThan(245)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: "/srv/nezha-builder/qa-ui-20261005/task-empty-" + [dark, enabled, width].join("-") + ".png" })
        await page.getByRole("button", { name: "新建任务", exact: true }).click()
        const dialog = page.getByRole("dialog")
        await expect(dialog).toBeVisible()
        const expectedBackground = await page.evaluate(() => {
            const probe = document.createElement("div")
            probe.style.background = "hsl(var(--background))"
            document.body.append(probe)
            const color = getComputedStyle(probe).backgroundColor
            probe.remove()
            return color
        })
        await expect(dialog).toHaveCSS("background-color", expectedBackground)
        await expect(dialog.getByRole("button", { name: "保存任务" })).toBeInViewport()
        expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
        await page.screenshot({ path: "/srv/nezha-builder/qa-ui-20261005/task-dialog-" + [dark, enabled, width].join("-") + ".png" })
        await dialog.getByRole("button", { name: "取消", exact: true }).click()
        populated = true
        await page.getByRole("button", { name: "刷新", exact: true }).click()
        await expect(page.locator(".cron-task-card")).toBeVisible()
        const card = page.locator(".cron-task-card")
        expect(await card.evaluate(e => {
            const probe = document.createElement("div")
            probe.className = "bg-card"
            e.append(probe)
            const same = getComputedStyle(e).backgroundColor === getComputedStyle(probe).backgroundColor
            probe.remove()
            return same
        })).toBe(true)
        await page.screenshot({ path: "/srv/nezha-builder/qa-ui-20261005/task-card-" + [dark, enabled, width].join("-") + ".png" })
        expect(writes).toEqual([])
    })
}
