import { Page, WebSocketRoute, expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"

function listFrame(path: string) {
    const encoded = Buffer.from(path),
        length = Buffer.alloc(4)
    length.writeUInt32BE(encoded.length)
    return Buffer.concat([
        Buffer.from("NZFN"),
        length,
        encoded,
        ...[
            [1, "logs"],
            [0, "config.yml"],
            [0, "database-backup-2026-10-11.tar.gz"],
        ].map(([type, name]) => {
            const bytes = Buffer.from(String(name))
            return Buffer.concat([Buffer.from([Number(type), bytes.length]), bytes])
        }),
    ])
}
async function setup(page: Page) {
    const state = {
        creates: 0,
        failCreate: false,
        failList: false,
        uploads: 0,
        uploadBytes: 0,
        uploadDone: true,
        fileClosed: 0,
        terminalClosed: 0,
        terminalInput: [] as string[],
        download: Buffer.from("NERR is file content, not an error"),
        sockets: [] as WebSocketRoute[],
    }
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        let data: unknown = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "fixture" }
        if (path === "/api/v1/terminal")
            data = {
                session_id: "terminal-fixture",
                server_id: 63,
                server_name: "文件管理测试节点",
                kind: "native",
                keep: false,
            }
        if (path.endsWith("/tmux/install-status")) data = { state: "idle", message: "" }
        if (path.endsWith("/terminal-sessions/list"))
            data = { native: [], tmux: [], installed: true }
        if (path === "/api/v1/terminal-commands")
            data = [{ id: 1, name: "测试命令", command: "printf audit", version: 1 }]
        if (path === "/api/v1/file") {
            state.creates++
            await new Promise((resolve) => setTimeout(resolve, 250))
            if (state.failCreate)
                return route.fulfill({ json: { success: false, error: "节点离线，请稍后重试" } })
            data = { session_id: "files-" + state.creates }
        }
        return route.fulfill({ json: { success: true, data } })
    })
    await page.routeWebSocket("**/api/v1/ws/terminal/**", (ws) => {
        ws.send(Buffer.from("root@fixture:~# "))
        ws.onMessage((data) => {
            if (typeof data === "string") state.terminalInput.push(data)
        })
        ws.onClose(() => {
            state.terminalClosed++
        })
    })
    await page.routeWebSocket("**/api/v1/ws/file/**", (ws) => {
        state.sockets.push(ws)
        let uploading: number | null = null
        ws.onClose(() => {
            state.fileClosed++
            ws.close()
        })
        ws.onMessage((data) => {
            const buf = Buffer.from(data)
            if (uploading !== null) {
                state.uploadBytes += buf.length
                uploading -= buf.length
                if (uploading <= 0 && state.uploadDone) {
                    uploading = null
                    ws.send(Buffer.from("NZUP"))
                }
                return
            }
            if (buf[0] === 0) {
                if (state.failList) {
                    state.failList = false
                    ws.send(Buffer.from("NERRpermission denied: /root/private"))
                    return
                }
                ws.send(listFrame(buf.subarray(1).toString() || "/opt/nezha/agent"))
            }
            if (buf[0] === 1) {
                const header = Buffer.alloc(12)
                header.write("NZTD")
                header.writeBigUInt64BE(BigInt(state.download.length), 4)
                ws.send(header)
                if (state.download.length) ws.send(state.download)
            }
            if (buf[0] === 2) {
                state.uploads++
                uploading = Number(buf.readBigUInt64BE(1))
                if (uploading === 0 && state.uploadDone) {
                    uploading = null
                    ws.send(Buffer.from("NZUP"))
                }
            }
        })
    })
    await page.goto("/dashboard/terminal/63")
    await expect(page.locator("#terminal-command-panel")).toBeVisible()
    await page.getByRole("button", { name: "收起快捷命令栏" }).click()
    return state
}
async function openFiles(page: Page) {
    await page.getByRole("button", { name: "文件管理", exact: true }).click()
    await expect(page.getByText("正在连接文件管理…", { exact: true })).toBeVisible()
    await expect(page.getByText("服务器不存在或者还未连接")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "下载 config.yml", exact: true })).toBeVisible()
}
async function screenshot(page: Page, path: string) {
    await page.evaluate(async () => {
        await Promise.all(
            document
                .getAnimations()
                .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
                .map((a) => a.finished.catch(() => {})),
        )
    })
    await page.screenshot({ path })
}
for (const width of [320, 390, 844, 1440])
    for (const theme of ["light", "dark"])
        test("file layout navigation and close " + width + " " + theme, async ({ page }, info) => {
            await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
            await page.addInitScript(
                (theme) => localStorage.setItem("nezha-dashboard-theme", theme),
                theme,
            )
            const state = await setup(page)
            await openFiles(page)
            const panel = page.getByRole("dialog", { name: "文件管理", exact: true })
            expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            await expect(
                page.getByRole("button", { name: "关闭文件管理", exact: true }),
            ).toBeInViewport()
            await page.getByRole("button", { name: "打开目录 logs", exact: true }).click()
            await expect(page.getByRole("textbox", { name: "目录路径" })).toHaveValue(
                "/opt/nezha/agent/logs",
            )
            await page.getByRole("button", { name: "上级", exact: true }).click()
            await expect(page.getByRole("textbox", { name: "目录路径" })).toHaveValue(
                "/opt/nezha/agent",
            )
            await page.getByRole("textbox", { name: "目录路径" }).fill("/tmp")
            await page.getByRole("textbox", { name: "目录路径" }).press("Enter")
            await expect(page.locator(".fm-list-summary")).toContainText("/tmp")
            expect(state.sockets).toHaveLength(1)
            if (width >= 640) {
                const before = (await panel.boundingBox())!.width
                await page.getByRole("button", { name: "展开文件面板" }).click()
                expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(before)
            }
            await screenshot(page, info.outputPath("files.png"))
            await page.keyboard.press("Escape")
            await expect(panel).toHaveCount(0)
            expect(state.terminalClosed).toBe(0)
            await openFiles(page)
            await page.getByRole("button", { name: "关闭文件管理" }).focus()
            await page.keyboard.press("Enter")
            await expect(panel).toHaveCount(0)
            expect(state.terminalClosed).toBe(0)
        })
test("file failures show reasons and reconnect without affecting terminal", async ({ page }) => {
    const state = await setup(page)
    state.failCreate = true
    await page.getByRole("button", { name: "文件管理", exact: true }).click()
    await expect(page.getByRole("alert")).toContainText("节点离线")
    state.failCreate = false
    await page.getByRole("button", { name: "重新连接", exact: true }).click()
    await expect(page.getByRole("button", { name: "下载 config.yml" })).toBeVisible()
    state.failList = true
    await page.getByRole("button", { name: "刷新", exact: true }).click()
    await expect(page.locator(".fm-error")).toContainText("permission denied")
    await expect(page.getByRole("button", { name: "重新连接", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "重新连接", exact: true }).click()
    await expect(page.locator(".fm-error")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "下载 config.yml" })).toBeEnabled()
    expect(state.terminalClosed).toBe(0)
})
for (const width of [390, 1440])
    test("upload cancel disconnect retry and confirmation " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 })
        const state = await setup(page)
        state.uploadDone = false
        await openFiles(page)
        await page
            .locator('input[type="file"]')
            .setInputFiles({
                name: "config.yml",
                mimeType: "text/plain",
                buffer: Buffer.from("test only"),
            })
        const confirm = page.getByRole("alertdialog")
        await expect(confirm).toContainText("覆盖原文件")
        expect(state.uploads).toBe(0)
        await confirm.getByRole("button", { name: "取消", exact: true }).click()
        expect(state.uploads).toBe(0)
        await page
            .locator('input[type="file"]')
            .setInputFiles({
                name: "config.yml",
                mimeType: "text/plain",
                buffer: Buffer.from("test only"),
            })
        await confirm.getByRole("button", { name: "确认上传", exact: true }).click()
        await expect.poll(() => state.uploadBytes).toBe(9)
        await expect(page.getByRole("region", { name: "文件传输" })).toContainText("等待节点确认")
        await screenshot(page, info.outputPath("upload-progress.png"))
        await page.keyboard.press("Escape")
        await expect(confirm).toContainText("停止传输并关闭")
        await expect(confirm.getByRole("button", { name: "继续传输" })).toBeFocused()
        await page.keyboard.press("Enter")
        await expect(confirm).toHaveCount(0)
        await page.getByRole("button", { name: "取消传输", exact: true }).click()
        await expect(page.locator(".fm-transfer")).toHaveAttribute("data-state", "cancelled")
        await expect(page.getByRole("button", { name: "重新连接", exact: true })).toBeVisible()
        expect(state.terminalClosed).toBe(0)
        await page.getByRole("button", { name: "重新连接", exact: true }).click()
        await expect(page.getByRole("button", { name: "重试", exact: true })).toBeEnabled()
        state.uploadDone = true
        await page.getByRole("button", { name: "重试", exact: true }).click()
        await expect(confirm).toContainText("覆盖原文件")
        await confirm.getByRole("button", { name: "确认上传", exact: true }).click()
        await expect(page.locator(".fm-transfer")).toHaveAttribute("data-state", "done")
        expect(state.uploads).toBe(2)
        state.uploadDone = false
        await page
            .locator('input[type="file"]')
            .setInputFiles({
                name: "small.txt",
                mimeType: "text/plain",
                buffer: Buffer.from("again"),
            })
        await confirm.getByRole("button", { name: "确认上传", exact: true }).click()
        await expect.poll(() => state.uploads).toBe(3)
        state.sockets.at(-1)!.close()
        await expect(page.locator(".fm-transfer")).toHaveAttribute("data-state", "error")
        await expect(page.getByRole("button", { name: "取消传输", exact: true })).toHaveCount(0)
        await screenshot(page, info.outputPath("upload-disconnected.png"))
        expect(state.terminalClosed).toBe(0)
    })
test("download preserves binary bytes and shorter same-name files", async ({ page }) => {
    const state = await setup(page)
    await openFiles(page)
    for (const content of [Buffer.from("NERR binary content"), Buffer.from("x"), Buffer.alloc(0)]) {
        state.download = content
        const completed = page.waitForEvent("download")
        await page.getByRole("button", { name: "下载 config.yml", exact: true }).click()
        const download = await completed
        expect(download.suggestedFilename()).toBe("config.yml")
        const path = await download.path()
        expect(await readFile(path!)).toEqual(content)
        await expect(page.locator(".fm-transfer")).toHaveAttribute("data-state", "done")
    }
    expect(state.terminalClosed).toBe(0)
})
for (const width of [390, 844])
    test("mobile command modal does not send background keystrokes " + width, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 844 ? 390 : 844 })
        const state = await setup(page)
        await page.getByRole("button", { name: "快捷命令", exact: true }).first().click()
        const panel = page.locator("#terminal-command-panel")
        await expect(panel).toHaveAttribute("aria-modal", "true")
        await expect(page.locator(".terminal-screen")).toHaveAttribute("inert", "")
        const start = state.terminalInput.length
        await page.keyboard.press("x")
        expect(state.terminalInput).toHaveLength(start)
        await page.getByRole("button", { name: "选择命令：测试命令" }).click()
        await page.getByRole("button", { name: "执行", exact: true }).click()
        await expect(panel).toHaveCount(0)
        await expect.poll(() => state.terminalInput.join("")).toContain("printf audit\r")
        expect(state.terminalClosed).toBe(0)
        await page.reload()
        await expect(panel).toBeVisible()
        await expect(page.getByRole("button", { name: "收起快捷命令栏" })).toBeFocused()
        const initial = state.terminalInput.length
        await page.keyboard.press("x")
        expect(state.terminalInput).toHaveLength(initial)
    })

test("file dialogs remain usable in fullscreen", async ({ page }) => {
    await setup(page)
    await page.locator(".terminal-page").evaluate((el) => el.requestFullscreen())
    await openFiles(page)
    expect(
        await page.locator(".fm-panel").evaluate((el) => document.fullscreenElement?.contains(el)),
    ).toBe(true)
    await page
        .locator('input[type="file"]')
        .setInputFiles({
            name: "safe-fixture.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("fixture"),
        })
    const confirm = page.getByRole("alertdialog")
    await expect(confirm).toBeVisible()
    expect(await confirm.evaluate((el) => document.fullscreenElement?.contains(el))).toBe(true)
    await confirm.getByRole("button", { name: "取消", exact: true }).click()
    await page.getByRole("button", { name: "关闭文件管理" }).click()
    await expect(page.locator(".fm-panel")).toHaveCount(0)
})
test("stalled transfer times out and close confirmation stops only files", async ({ page }) => {
    const state = await setup(page)
    state.uploadDone = false
    await openFiles(page)
    await page.clock.install()
    await page
        .locator('input[type="file"]')
        .setInputFiles({
            name: "safe-fixture.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("fixture"),
        })
    await page.getByRole("button", { name: "确认上传", exact: true }).click()
    await expect.poll(() => state.uploadBytes).toBe(7)
    await page.clock.runFor(47000)
    await expect(page.locator(".fm-transfer")).toHaveAttribute("data-state", "error")
    await expect(page.locator(".fm-error")).toContainText("超时")
    await page.getByRole("button", { name: "重新连接", exact: true }).click()
    await expect(page.getByRole("button", { name: "重试", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "重试", exact: true }).click()
    await page.getByRole("button", { name: "确认上传", exact: true }).click()
    await expect.poll(() => state.uploads).toBe(2)
    await page.getByRole("button", { name: "关闭文件管理" }).click()
    await page.getByRole("button", { name: "停止并关闭", exact: true }).click()
    await expect(page.locator(".fm-panel")).toHaveCount(0)
    expect(state.terminalClosed).toBe(0)
})
test("closing while connecting ignores late response and reopening succeeds", async ({ page }) => {
    const state = await setup(page)
    await page.getByRole("button", { name: "文件管理", exact: true }).click()
    await expect(page.getByText("正在连接文件管理…", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "关闭文件管理" }).click()
    await expect(page.locator(".fm-panel")).toHaveCount(0)
    await openFiles(page)
    expect(state.sockets).toHaveLength(1)
    expect(state.terminalClosed).toBe(0)
})
