import { expect, test, Page, WebSocketRoute } from "@playwright/test"

async function fixture(page: Page, installed = true, installFails = false) {
    const state = { creates: 0, connects: 0, keeps: 0, ends: 0, installs: 0, failCreate: false, failEnd: false, failAttach: false }
    const held = new Set<string>()
    let polls = 0
    const sockets = new Map<string, WebSocketRoute>()
    let tmux = [
        { id: 2, name: "build-session", source: "panel", windows: [{ id: "@1", index: 0, name: "编译窗口" }, { id: "@2", index: 1, name: "log" }] },
        { id: 3, name: "manual-ssh", source: "existing", windows: [{ id: "@3", index: 0, name: "手动创建" }] },
    ]
    page.on("dialog", () => { throw new Error("Browser-native dialog must not be used") })
    await page.route("**/api/v1/**", async route => {
        const path = new URL(route.request().url()).pathname
        const body = route.request().method() === "POST" ? route.request().postDataJSON() : {}
        let data: unknown = []
        const fail = () => route.fulfill({ json: { success: false, error: "测试连接失败" } })
        if (path.endsWith("/profile")) data = { id: 1, username: "admin", role: 0 }
        else if (path.endsWith("/setting")) data = { config: { language: "zh-CN" }, version: "fixture" }
        else if (path === "/api/v1/terminal") {
            state.creates++
            if (state.failCreate) return fail()
            data = { session_id: "native-" + state.creates, server_id: 63, server_name: "HK.测试节点", kind: "native", keep: false }
        } else if (path.endsWith("/terminal-sessions/list")) data = {
            native: [...held].map((id, i) => ({ id: 10 + i, name: "构建任务", stream_id: id, source: "panel", status: "held", attached: false, windows: [] })),
            tmux: installed ? tmux : [], installed,
        }
        else if (path.endsWith("/keep")) {
            state.keeps++
            if (body.enabled) held.add(body.stream_id); else held.delete(body.stream_id)
            data = { session_id: body.stream_id, server_id: 63, kind: "native", keep: body.enabled }
        } else if (path.endsWith("/resume")) data = { session_id: body.stream_id, server_id: 63, kind: "native", keep: true }
        else if (path.endsWith("/tmux/attach") || path.endsWith("/tmux/create")) {
            if (state.failAttach) return fail()
            const id = body.record_id || 4
            if (!body.record_id) tmux.push({ id, name: body.name, source: "panel", windows: [{ id: "@4", index: 0, name: body.window }] })
            data = { session_id: "tmux-" + id, record_id: id, kind: "tmux", server_id: 63 }
        } else if (path.endsWith("/stop") || path.endsWith("/tmux/end")) {
            state.ends++
            if (state.failEnd) return fail()
            const stream = body.stream_id || "tmux-" + body.record_id
            if (body.stream_id) held.delete(body.stream_id); else tmux = tmux.filter(row => row.id !== body.record_id)
            sockets.get(stream)?.close()
            data = {}
        } else if (path.endsWith("/tmux/install")) {
            state.installs++; polls = 0
            data = { state: "running", message: "正在安装 tmux", log: "Preparing package manager...\n" }
        } else if (path.endsWith("/tmux/install-status")) {
            if (!state.installs) data = { state: "idle", message: "" }
            else {
                polls++
                const done = polls >= 2
                if (done && !installFails) installed = true
                data = { state: done ? installFails ? "failed" : "done" : "running",
                    message: done ? installFails ? "节点无法解析软件源域名，请检查 DNS" : "tmux 已安装，可以创建会话" : "正在安装 tmux",
                    log: "Preparing package manager...\n" + (done ? "Downloaded packages\nSetting up tmux...\n" : "Downloading packages 45%\n") }
            }
        }
        return route.fulfill({ json: { success: true, data } })
    })
    await page.routeWebSocket("**/api/v1/ws/terminal/**", ws => {
        state.connects++
        sockets.set(new URL(ws.url()).pathname.split("/").pop()!, ws)
        ws.send(Buffer.from("root@fixture:~# "))
        ws.onMessage(() => {})
    })
    return { state, disconnect: () => sockets.get("native-1")?.close() }
}
const panel = (page: Page) => page.locator("#terminal-session-panel")
const card = (page: Page, name: string) => page.locator(".terminal-session-card").filter({ hasText: name })
async function enterTmux(page: Page) {
    await page.getByRole("button", { name: "tmux 会话", exact: true }).click()
    await page.getByRole("button", { name: "0 · 编译窗口", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "结束旧终端并切换" }).click()
    await expect(page.getByRole("button", { name: "tmux 已连接", exact: true })).toBeVisible()
}
for (const width of [390, 1440]) {
    test("separate panel and tmux lists " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        const { state } = await fixture(page)
        await page.goto("/dashboard/terminal/63")
        await expect(page.getByRole("button", { name: "保持当前", exact: true })).toBeEnabled()
        await page.getByRole("button", { name: "保持当前", exact: true }).click()
        await page.getByRole("button", { name: "面板保持", exact: true }).click()
        await expect(card(page, "构建任务")).toBeVisible()
        await expect(card(page, "manual-ssh")).toHaveCount(0)
        await page.getByRole("button", { name: "tmux 会话", exact: true }).click()
        await expect(card(page, "manual-ssh")).toBeVisible()
        await expect(card(page, "构建任务")).toHaveCount(0)
        await expect(page.getByText("1 · log", { exact: true })).toBeVisible()
        await page.getByRole("button", { name: "0 · 手动创建", exact: true }).click()
        await expect.poll(() => state.connects).toBe(2)
        expect(state.keeps).toBe(1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        await page.screenshot({ path: "test-results/terminal-separated-" + width + ".png", fullPage: true })
    })
}
test("keep confirmation can cancel or Escape and defaults to safe button", async ({ page }) => {
    const { state } = await fixture(page)
    await page.goto("/dashboard/terminal/63")
    await page.getByRole("button", { name: "保持当前", exact: true }).click()
    await page.getByRole("button", { name: "已保持", exact: true }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByRole("button", { name: "继续保持" })).toBeFocused()
    await page.screenshot({ path: "test-results/terminal-confirm-keep.png" })
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    expect(state.keeps).toBe(1)
    await page.getByRole("button", { name: "已保持", exact: true }).click()
    await page.keyboard.press("Enter")
    await expect(dialog).toHaveCount(0)
    expect(state.keeps).toBe(1)
    await page.getByRole("button", { name: "已保持", exact: true }).click()
    await dialog.getByRole("button", { name: "关闭保持", exact: true }).click()
    await expect(page.getByRole("button", { name: "保持当前", exact: true })).toBeVisible()
    expect(state.keeps).toBe(2)
})
test("tmux creation never keeps ordinary terminal and ending current returns fresh shell", async ({ page }) => {
    const { state } = await fixture(page)
    await page.goto("/dashboard/terminal/63")
    await page.getByRole("button", { name: "tmux 会话", exact: true }).click()
    await page.getByRole("button", { name: "新建", exact: true }).click()
    await page.getByLabel("会话名称", { exact: true }).fill("网站维护")
    await page.getByRole("button", { name: "创建并进入" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "结束旧终端并切换" }).click()
    await expect(page.getByRole("button", { name: "tmux 已连接" })).toBeVisible()
    expect(state.keeps).toBe(0)
    await card(page, "网站维护").getByRole("button", { name: "结束", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "结束会话", exact: true }).click()
    await expect.poll(() => state.connects).toBe(3)
    await expect(page.getByRole("button", { name: "保持当前", exact: true })).toBeEnabled()
    await expect(page.getByText("连接已断开。", { exact: false })).toHaveCount(0)
    await page.getByRole("button", { name: "面板保持", exact: true }).click()
    await expect(page.getByText("暂无已保持的终端")).toBeVisible()
    expect(state.creates).toBe(2); expect(state.keeps).toBe(0); expect(state.ends).toBe(1)
})
test("ending other tmux does not replace current shell; failure does not reconnect", async ({ page }) => {
    const { state } = await fixture(page)
    await page.goto("/dashboard/terminal/63")
    await page.getByRole("button", { name: "tmux 会话", exact: true }).click()
    state.failEnd = true
    await card(page, "manual-ssh").getByRole("button", { name: "结束", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "结束会话", exact: true }).click()
    await expect(card(page, "manual-ssh")).toBeVisible()
    state.failEnd = false
    await card(page, "manual-ssh").getByRole("button", { name: "结束", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "结束会话", exact: true }).click()
    await expect(card(page, "manual-ssh")).toHaveCount(0)
    expect(state.creates).toBe(1); expect(state.connects).toBe(1)
})
test("ending current panel-held shell returns unheld shell", async ({ page }) => {
    const { state } = await fixture(page)
    await page.goto("/dashboard/terminal/63")
    await page.getByRole("button", { name: "保持当前", exact: true }).click()
    await page.getByRole("button", { name: "面板保持", exact: true }).click()
    await card(page, "构建任务").getByRole("button", { name: "结束", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "结束会话", exact: true }).click()
    await expect.poll(() => state.connects).toBe(2)
    await expect(page.getByRole("button", { name: "保持当前", exact: true })).toBeEnabled()
    await expect(page.getByText("暂无已保持的终端")).toBeVisible()
})
test("failed fresh connection can retry without ending tmux again", async ({ page }) => {
    const { state } = await fixture(page)
    await page.goto("/dashboard/terminal/63")
    await enterTmux(page)
    state.failCreate = true
    await card(page, "build-session").getByRole("button", { name: "结束", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "结束会话", exact: true }).click()
    await expect(page.getByRole("button", { name: "连接普通终端", exact: true })).toBeVisible()
    await expect.poll(() => state.creates).toBe(2)
    state.failCreate = false
    await page.getByRole("button", { name: "连接普通终端", exact: true }).click()
    await expect(page.getByRole("button", { name: "保持当前", exact: true })).toBeEnabled()
    expect(state.ends).toBe(1); expect(state.creates).toBe(3)
})
test("unexpected disconnect never creates a shell automatically", async ({ page }) => {
    const { state, disconnect } = await fixture(page)
    await page.goto("/dashboard/terminal/63")
    await expect.poll(() => state.connects).toBe(1)
    disconnect()
    await expect(page.getByRole("button", { name: "连接普通终端", exact: true })).toBeVisible()
    expect(state.creates).toBe(1)
})
test("install confirmation, live output, failure and return preserve original connection", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    const { state } = await fixture(page, false, true)
    await page.goto("/dashboard/terminal/63")
    await page.getByRole("button", { name: "tmux 会话", exact: true }).click()
    await page.getByRole("button", { name: "安装 tmux", exact: true }).click()
    await expect(page.getByRole("alertdialog").getByRole("button", { name: "取消" })).toBeFocused()
    await page.evaluate(() => document.documentElement.classList.add("dark"))
    await expect(page.getByRole("alertdialog").getByRole("button", { name: "取消" })).toHaveCSS("background-color", "rgb(32, 37, 45)")
    await page.screenshot({ path: "test-results/terminal-confirm-install-mobile-dark.png" })
    await page.keyboard.press("Escape")
    expect(state.installs).toBe(0)
    await page.getByRole("button", { name: "安装 tmux", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "安装 tmux", exact: true }).click()
    await expect(page.getByRole("region", { name: "tmux 安装日志" })).toBeVisible()
    await expect(page.getByLabel("实时安装输出")).toContainText("Downloading packages 45%")
    await expect(page.getByRole("region", { name: "tmux 安装日志" })).toContainText("DNS")
    await page.screenshot({ path: "test-results/terminal-install-output.png" })
    expect(state.installs).toBe(1); expect(state.creates).toBe(1); expect(state.connects).toBe(1); expect(state.keeps).toBe(0)
    await page.getByRole("button", { name: "返回终端" }).click()
    await expect(page.getByRole("region", { name: "tmux 安装日志" })).toHaveCount(0)
})
test("fullscreen confirmation is placed inside fullscreen element", async ({ page }) => {
    await fixture(page, false)
    await page.goto("/dashboard/terminal/63")
    await page.getByRole("button", { name: "tmux 会话", exact: true }).click()
    await page.locator(".terminal-shell").evaluate(el => el.requestFullscreen())
    await page.getByRole("button", { name: "安装 tmux", exact: true }).click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    expect(await page.getByRole("alertdialog").evaluate(el => document.fullscreenElement?.contains(el))).toBe(true)
    await page.getByRole("alertdialog").getByRole("button", { name: "取消" }).click()
})
