import { expect, test, Page } from "@playwright/test"
async function fixture(page: Page, installed = true, installFails = false) {
    let held = false, connects = 0, installs = 0
    const native = { id: 1, name: "构建任务", stream_id: "native", source: "panel", status: "held", attached: false, windows: [] }
    const tmux = [
        { id: 2, name: "build-session", source: "panel", windows: [{ id: "@1", index: 0, name: "编译窗口" }, { id: "@2", index: 1, name: "log" }] },
        { id: 3, name: "manual-ssh", source: "existing", windows: [{ id: "@3", index: 0, name: "手动创建" }] },
    ]
    await page.route("**/api/v1/**", async route => {
        const path = new URL(route.request().url()).pathname
        const body = route.request().method() === "POST" ? route.request().postDataJSON() : {}
        let data: unknown = []
        if (path.endsWith("/profile")) data = { id: 1, username: "admin", role: 0 }
        else if (path.endsWith("/setting")) data = { config: { language: "zh-CN" }, version: "fixture" }
        else if (path === "/api/v1/terminal") data = { session_id: "native", server_id: 63, server_name: "HK.测试节点", kind: "native", keep: held }
        else if (path.endsWith("/terminal-sessions/list")) data = { native: held ? [native] : [], tmux: installed ? tmux : [], installed }
        else if (path.endsWith("/keep")) { held = body.enabled; data = { session_id: "native", server_id: 63, kind: "native", keep: held } }
        else if (path.endsWith("/resume")) data = { session_id: "native", server_id: 63, kind: "native", keep: true }
        else if (path.endsWith("/tmux/attach") || path.endsWith("/tmux/create")) data = { session_id: "tmux-" + (body.record_id || 4), record_id: body.record_id || 4, kind: "tmux", server_id: 63 }
        else if (path.endsWith("/tmux/install")) { installs++; installed = !installFails; data = { state: installFails ? "failed" : "done", message: installFails ? "节点无法解析软件源域名，请检查 DNS" : "tmux 已安装，可以创建会话" } }
        else if (path.endsWith("/tmux/install-status")) data = { state: "idle", message: "" }
        return route.fulfill({ json: { success: true, data } })
    })
    await page.routeWebSocket("**/api/v1/ws/terminal/**", ws => { connects++; ws.send(Buffer.from("root@fixture:~# ")); ws.onMessage(() => {}) })
    return { connects: () => connects, installs: () => installs }
}
for (const width of [390, 1440]) {
    test("persistent terminal controls and existing tmux sessions " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        const state = await fixture(page)
        page.on("dialog", dialog => dialog.accept())
        await page.goto("/dashboard/terminal/63")
        await expect(page.locator(".terminal-session-card")).toHaveCount(2)
        await expect(page.getByText("已有会话", { exact: true })).toBeVisible()
        await expect(page.getByText("1 · log", { exact: true })).toBeVisible()
        await page.screenshot({ path: "test-results/terminal-sessions-" + width + ".png", fullPage: true })
        await page.getByRole("button", { name: "保持", exact: true }).click()
        await expect(page.getByRole("button", { name: "已保持", exact: true })).toHaveAttribute("aria-pressed", "true")
        expect(state.connects()).toBe(1)
        await page.getByRole("button", { name: "快捷命令", exact: true }).first().click()
        await expect(page.locator("#terminal-session-panel")).toBeHidden()
        if (width < 1024) await page.getByRole("button", { name: "收起快捷命令栏", exact: true }).click()
        await page.getByRole("button", { name: "会话", exact: true }).click()
        await expect(page.locator(".terminal-session-card")).toHaveCount(3)
        await page.getByRole("button", { name: "0 · 手动创建", exact: true }).click()
        await expect.poll(state.connects).toBe(2)
        await expect(page.getByRole("button", { name: "tmux", exact: true })).toBeDisabled()
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        await page.reload()
        await expect(page.locator(".terminal-session-card")).toHaveCount(3)
        await expect(page.getByText("构建任务", { exact: true })).toBeVisible()
    })
}
test("missing tmux offers install and preserves errors", async ({ page }) => {
    const state = await fixture(page, false, true)
    page.on("dialog", dialog => dialog.accept())
    await page.goto("/dashboard/terminal/63")
    await expect(page.getByText("此节点尚未安装 tmux")).toBeVisible()
    expect(state.installs()).toBe(0)
    await page.getByRole("button", { name: "安装 tmux", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "DNS" })).toBeVisible()
    expect(state.installs()).toBe(1)
    await expect(page.getByRole("button", { name: "新建", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "保持", exact: true })).toHaveAttribute("aria-pressed", "false")
})
