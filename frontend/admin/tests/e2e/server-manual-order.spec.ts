import { expect, test } from "@playwright/test"

for (const width of [320, 390, 768, 1440])
    for (const theme of ["light", "dark"])
        test("manual order only " + width + " " + theme, async ({ page }, info) => {
            await page.setViewportSize({ width, height: width === 320 ? 640 : 900 })
            await page.addInitScript(
                (theme) => localStorage.setItem("nezha-dashboard-theme", theme),
                theme,
            )
            let servers = Array.from({ length: 12 }, (_, i) => ({
                id: i + 1,
                name: "服务器" + (i + 1),
                uuid: "manual-" + (i + 1),
                display_index: 20001 - i,
                user_id: 1,
                host: {},
                public_note: "",
                note: "preserve",
                hide_for_guest: false,
                hide_for_display: false,
                enable_ddns: false,
            }))
            const writes: any[] = []
            const errors: string[] = []
            page.on("pageerror", (e) => errors.push(e.message))
            await page.route("**/api/v1/**", async (r) => {
                const path = new URL(r.request().url()).pathname
                let data: any = []
                if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
                if (path === "/api/v1/setting")
                    data = { config: { language: "zh-CN" }, version: "test" }
                if (path === "/api/v1/server") data = servers
                if (["POST", "PATCH"].includes(r.request().method())) {
                    const body = r.request().postDataJSON()
                    writes.push({ path, body })
                    if (path === "/api/v1/server/order") {
                        await new Promise((resolve) => setTimeout(resolve, 300))
                        servers = body.server_ids.map((id: number, i: number) => ({
                            ...servers.find((s) => s.id === id),
                            display_index: body.server_ids.length - i,
                        }))
                    } else if (path === "/api/v1/server/3")
                        servers = servers.map((s) => (s.id === 3 ? { ...s, ...body } : s))
                    else throw Error("Unexpected write: " + path)
                }
                return r.fulfill({ json: { success: true, data } })
            })
            await page.goto("/dashboard")
            await expect(page.locator("html")).toHaveClass(new RegExp(theme))
            const firstRow = page
                .getByRole("row")
                .filter({ has: page.getByText("服务器1", { exact: true }) })
            await expect(firstRow.getByRole("cell").nth(1)).toHaveText("1")
            await page.getByRole("button", { name: "服务器排序", exact: true }).click()
            const dialog = page.getByRole("dialog")
            await expect(dialog).not.toContainText("权重")
            await expect(dialog.getByRole("spinbutton")).toHaveCount(0)
            await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
            await expect(
                dialog.getByRole("button", { name: "上移 服务器1", exact: true }),
            ).toBeDisabled()
            await expect(
                dialog.getByRole("button", { name: "下移 服务器12", exact: true }),
            ).toBeDisabled()
            await dialog.getByRole("button", { name: "上移 服务器3", exact: true }).click()
            await dialog.getByRole("button", { name: "下移 服务器1", exact: true }).click()
            const ids = () =>
                dialog
                    .locator("[data-sort-server]")
                    .evaluateAll((rows) =>
                        rows.map((row) => Number(row.getAttribute("data-sort-server"))),
                    )
            await expect.poll(ids).toEqual([3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12])
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            await expect(dialog.getByRole("heading", { name: "服务器排序" })).toBeInViewport()
            await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeInViewport()
            await page.screenshot({ path: info.outputPath("manual-order.png") })
            await dialog.getByRole("button", { name: "保存", exact: true }).click()
            await expect(
                dialog.getByRole("button", { name: "上移 服务器1", exact: true }),
            ).toBeDisabled()
            await expect(dialog).toHaveCount(0)
            expect(writes[0]).toEqual({
                path: "/api/v1/server/order",
                body: { server_ids: [3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
            })
            expect(servers.every((s) => s.uuid === "manual-" + s.id && s.note === "preserve")).toBe(
                true,
            )
            await page.reload()
            await page.getByRole("button", { name: "服务器排序", exact: true }).click()
            await expect.poll(ids).toEqual([3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12])
            await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
            await dialog.getByRole("button", { name: "下移 服务器3", exact: true }).click()
            await dialog.getByRole("button", { name: "Close", exact: true }).click()
            expect(writes).toHaveLength(1)
            const edit = page
                .getByRole("row")
                .filter({ has: page.getByText("服务器3", { exact: true }) })
                .getByRole("button", { name: "编辑服务器", exact: true })
            await edit.click()
            await expect(
                dialog.getByText("权重（数字越大，显示越靠前）", { exact: true }),
            ).toHaveCount(0)
            await expect(dialog.locator('[name="display_index"]')).toHaveCount(0)
            await dialog.getByLabel("名称", { exact: true }).fill("已编辑服务器")
            await dialog.locator('button[type="submit"]').click()
            await expect(dialog).toHaveCount(0)
            expect(writes).toHaveLength(2)
            expect(writes[1].path).toBe("/api/v1/server/3")
            expect(writes[1].body).not.toHaveProperty("display_index")
            expect(servers[0].id).toBe(3)
            expect(servers[0].display_index).toBe(12)
            expect(errors).toEqual([])
        })

test("desktop drag and save failure preserve manual draft", async ({ page }) => {
    let attempts = 0
    await page.route("**/api/v1/**", async (r) => {
        const path = new URL(r.request().url()).pathname
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/server")
            data = [1, 2, 3].map((id) => ({
                id,
                name: "拖动" + id,
                uuid: "drag-" + id,
                display_index: 10 - id,
                host: {},
            }))
        if (path === "/api/v1/server/order") {
            attempts++
            expect(r.request().postDataJSON()).toEqual({ server_ids: [3, 1, 2] })
            await new Promise((resolve) => setTimeout(resolve, 300))
            return r.fulfill({
                json:
                    attempts === 1
                        ? { success: false, error: "保存失败，请重试" }
                        : { success: true },
            })
        }
        return r.fulfill({ json: { success: true, data } })
    })
    await page.goto("/dashboard")
    await page.getByRole("button", { name: "服务器排序", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog
        .locator('[data-sort-server="3"]')
        .dragTo(dialog.locator('[data-sort-server="1"]'), { targetPosition: { x: 30, y: 10 } })
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expect(page.getByText("保存失败，请重试", { exact: true })).toBeVisible()
    await expect(dialog.locator("[data-sort-server]").first()).toHaveAttribute(
        "data-sort-server",
        "3",
    )
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(attempts).toBe(2)
})

for (const theme of ["light", "dark"])
    test("hold server while wheeling across screens " + theme, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.addInitScript(
            (theme) => localStorage.setItem("nezha-dashboard-theme", theme),
            theme,
        )
        let servers = Array.from({ length: 40 }, (_, i) => ({
            id: i + 1,
            name: "跨屏服务器" + (i + 1),
            uuid: "wheel-" + (i + 1),
            display_index: 40 - i,
            host: {},
        }))
        const writes: number[][] = []
        await page.route("**/api/v1/**", (r) => {
            const path = new URL(r.request().url()).pathname
            let data: any = []
            if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
            if (path === "/api/v1/setting")
                data = { config: { language: "zh-CN" }, version: "test" }
            if (path === "/api/v1/server") data = servers
            if (path === "/api/v1/server/order") {
                const ids = r.request().postDataJSON().server_ids
                writes.push(ids)
                servers = ids.map((id: number) => servers.find((s) => s.id === id))
            }
            return r.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard")
        const open = () => page.getByRole("button", { name: "服务器排序", exact: true }).click()
        await open()
        const dialog = page.getByRole("dialog"),
            list = dialog.getByLabel("手动排序列表", { exact: true })
        const ids = () =>
            list
                .locator("[data-sort-server]")
                .evaluateAll((rows) =>
                    rows.map((row) => Number(row.getAttribute("data-sort-server"))),
                )
        await list.locator('[data-sort-server="1"]').hover()
        const first = await list.locator('[data-sort-server="1"]').boundingBox()
        expect(first).not.toBeNull()
        const box = await list.boundingBox()
        expect(box).not.toBeNull()
        await page.mouse.move(first!.x + 90, first!.y + first!.height / 2)
        await page.mouse.down()
        if (theme === "light") {
            await page.mouse.move(box!.x + 100, box!.y + box!.height / 2, { steps: 4 })
            await expect(list.locator('[data-dragging="true"]')).toHaveCount(1)
        }
        // Dark mode also covers holding still and scrolling before any pointer movement.
        await page.mouse.wheel(0, 1200)
        await expect(list.locator('[data-dragging="true"]')).toHaveCount(1)
        await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(800)
        await expect
            .poll(async () => {
                const top = await list.evaluate((el) => el.scrollTop)
                await page.waitForTimeout(100)
                return Math.abs((await list.evaluate((el) => el.scrollTop)) - top) < 1
            })
            .toBe(true)
        expect((await ids())[0]).toBe(1)
        expect(writes).toHaveLength(0)
        const target = await list.evaluate((el) => {
            const bounds = el.getBoundingClientRect()
            return Array.from(el.querySelectorAll<HTMLElement>("[data-sort-server]"))
                .map((row) => ({
                    id: Number(row.dataset.sortServer),
                    rect: row.getBoundingClientRect(),
                }))
                .filter(
                    (row) => row.rect.top > bounds.top + 55 && row.rect.bottom < bounds.bottom - 55,
                )[0].id
        })
        expect(target).toBeGreaterThan(8)
        const targetBox = await list.locator('[data-sort-server="' + target + '"]').boundingBox()
        await page.mouse.move(targetBox!.x + 100, targetBox!.y + targetBox!.height - 12, {
            steps: 4,
        })
        await expect(
            list.locator('[data-sort-server="' + target + '"] [data-sort-drop="after"]'),
        ).toHaveCount(1)
        await expect(list.locator("[data-sort-drop]")).toHaveClass(/bg-emerald-500/)
        await page.screenshot({ path: "test-results/server-sort-green-" + theme + ".png" })
        await page.mouse.up()
        const expected = Array.from({ length: 40 }, (_, i) => i + 1).filter((id) => id !== 1)
        expected.splice(expected.indexOf(target) + 1, 0, 1)
        expect(await ids()).toEqual(expected)
        expect(writes).toHaveLength(0)
        await dialog.getByRole("button", { name: "保存", exact: true }).click()
        await expect(dialog).toHaveCount(0)
        expect(writes).toEqual([expected])

        await open()
        await list.locator("[data-sort-server]").first().hover()
        await page.mouse.move(box!.x + 100, box!.y + box!.height / 2)
        await page.mouse.wheel(0, 6000)
        await expect(list.locator('[data-sort-server="40"]')).toBeInViewport()
        await list.locator('[data-sort-server="40"]').hover()
        const last = await list.locator('[data-sort-server="40"]').boundingBox()
        await page.mouse.move(last!.x + 90, last!.y + last!.height / 2)
        await page.mouse.down()
        await page.mouse.move(box!.x + 100, box!.y + box!.height / 2, { steps: 4 })
        const bottomScroll = await list.evaluate((el) => el.scrollTop)
        await page.mouse.wheel(0, -1200)
        await expect
            .poll(() => list.evaluate((el) => el.scrollTop))
            .toBeLessThan(bottomScroll - 800)
        // Escape releases capture and keeps the saved order without closing the dialog.
        await page.keyboard.press("Escape")
        await page.mouse.up()
        await expect(dialog).toBeVisible()
        expect(await ids()).toEqual(expected)
        await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
        expect(writes).toHaveLength(1)

        // A normal click or a release outside the list must not reorder anything.
        const row = await list.evaluate((el) => {
            const b = el.getBoundingClientRect()
            const row = Array.from(el.querySelectorAll<HTMLElement>("[data-sort-server]")).find(
                (r) => {
                    const v = r.getBoundingClientRect()
                    return v.top > b.top + 50 && v.bottom < b.bottom - 50
                },
            )!
            const r = row.getBoundingClientRect()
            return { id: Number(row.dataset.sortServer), x: r.x + 90, y: r.y + r.height / 2 }
        })
        await page.mouse.click(row.x, row.y)
        expect(await ids()).toEqual(expected)
        await page.mouse.move(row.x, row.y)
        await page.mouse.down()
        await page.mouse.move(box!.x + 100, box!.y - 15, { steps: 5 })
        await page.mouse.up()
        expect(await ids()).toEqual(expected)
        await expect(list.locator("[data-dragging]")).toHaveCount(0)
        // Re-read coordinates after the outside release: edge scrolling may have
        // moved the old row point onto a gap between rows.
        const edgeBox = await list.boundingBox()
        const edgeRow = await list.evaluate(el => {
            const bounds = el.getBoundingClientRect()
            const visible = Array.from(el.querySelectorAll<HTMLElement>("[data-sort-server]")).find(item => {
                const rect = item.getBoundingClientRect()
                return rect.top > bounds.top + 50 && rect.bottom < bounds.bottom - 50
            })!
            const grip = visible.querySelector("[data-sort-handle]")!.getBoundingClientRect()
            return { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
        })
        const edgeStart = await list.evaluate((el) => el.scrollTop)
        await page.mouse.move(edgeRow.x, edgeRow.y)
        await page.mouse.down()
        await page.mouse.move(edgeBox!.x + 100, edgeBox!.y + edgeBox!.height - 4, { steps: 5 })
        await expect(list.locator('[data-dragging="true"]')).toHaveCount(1)
        await expect
            .poll(() => list.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(edgeStart + 150)
        await page.keyboard.press("Escape")
        await page.mouse.up()
        const stopped = await list.evaluate((el) => el.scrollTop)
        await page.waitForTimeout(100)
        expect(await list.evaluate((el) => el.scrollTop)).toBe(stopped)
        expect(await ids()).toEqual(expected)
        await dialog.getByRole("button", { name: "Close", exact: true }).click()
        expect(writes).toHaveLength(1)
    })

test.describe("touch server order", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
    test("row swipe scrolls while grip touch reorders", async ({ page }) => {
        await page.route("**/api/v1/**", (r) => {
            const path = new URL(r.request().url()).pathname
            let data: any = []
            if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
            if (path === "/api/v1/setting")
                data = { config: { language: "zh-CN" }, version: "test" }
            if (path === "/api/v1/server")
                data = Array.from({ length: 30 }, (_, i) => ({
                    id: i + 1,
                    name: "触摸服务器" + (i + 1),
                    uuid: "touch-" + i,
                    display_index: 30 - i,
                    host: {},
                }))
            return r.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard")
        await page.getByRole("button", { name: "服务器排序", exact: true }).click()
        const dialog = page.getByRole("dialog"),
            list = dialog.getByLabel("手动排序列表", { exact: true })
        const before = await list
            .locator("[data-sort-server]")
            .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-sort-server")))
        const box = await list.boundingBox()
        const client = await page.context().newCDPSession(page)
        const swipe = async (x: number, from: number, to: number) => {
            await client.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: [{ x, y: from }],
            })
            for (let i = 1; i <= 8; i++) {
                await client.send("Input.dispatchTouchEvent", {
                    type: "touchMove",
                    touchPoints: [{ x, y: from + ((to - from) * i) / 8 }],
                })
                await page.waitForTimeout(20)
            }
            await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
        }
        await swipe(box!.x + 110, box!.y + box!.height - 70, box!.y + 70)
        await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
        expect(
            await list
                .locator("[data-sort-server]")
                .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-sort-server"))),
        ).toEqual(before)
        await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
        await page.waitForTimeout(500)
        await list.evaluate((el) => (el.scrollTop = 0))
        const grip = await list.locator('[data-sort-server="3"] [data-sort-handle]').boundingBox()
        const target = await list.locator('[data-sort-server="1"]').boundingBox()
        await swipe(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2, target!.y + 10)
        await expect(list.locator("[data-sort-server]").first()).toHaveAttribute(
            "data-sort-server",
            "3",
        )
        await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled()
        await expect(list.locator("[data-dragging]")).toHaveCount(0)
    })
})

for (const width of [390, 1440]) test("move position 14 to 11 without changing system IDs " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    let servers = Array.from({ length: 16 }, (_, i) => ({
        id: 101 + i, name: "位置服务器" + (i + 1), uuid: "position-" + i, display_index: 100 - i, user_id: 1,
        host: {}, public_note: "", note: "preserve", hide_for_guest: false, hide_for_display: false, enable_ddns: false,
    }))
    const writes: { path: string; body: { server_ids: number[] } }[] = []
    await page.route("**/api/v1/**", async route => {
        const path = new URL(route.request().url()).pathname
        let data: unknown = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
        if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "fixture" }
        if (path === "/api/v1/server") data = servers
        if (route.request().method() === "POST") {
            const body = route.request().postDataJSON()
            writes.push({ path, body })
            expect(path).toBe("/api/v1/server/order")
            servers = body.server_ids.map((id: number, index: number) => ({ ...servers.find(s => s.id === id)!, display_index: servers.length - index }))
        }
        await route.fulfill({ json: { success: true, data } })
    })
    await page.goto("/dashboard")
    await page.getByRole("button", { name: "服务器排序", exact: true }).click()
    const dialog = page.getByRole("dialog")
    const row = dialog.locator('[data-sort-server="114"]')
    const input = row.getByRole("spinbutton")
    const trigger = row.getByRole("button", { name: "将 位置服务器14 移到第几位", exact: true })
    await expect(dialog.getByRole("spinbutton")).toHaveCount(0)
    await trigger.focus()
    await expect(dialog.getByRole("spinbutton")).toHaveCount(0)
    await trigger.click()
    await expect(input).toBeFocused()
    await input.fill("11")
    await input.press("Escape")
    await expect(input).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(dialog).toBeVisible()
    await expect(row.locator("[data-sort-position]")).toHaveText("14")
    await trigger.press("Enter")
    await expect(input).toBeFocused()
    await expect(input).toHaveValue("")
    await input.fill("11")
    await row.getByText("位置服务器14", { exact: true }).click()
    await expect(input).toHaveCount(0)
    await expect(row.locator("[data-sort-position]")).toHaveText("14")
    await trigger.click()
    await expect(input).toHaveValue("")
    await input.fill("17")
    await input.press("Enter")
    await expect(row.locator("[data-sort-position]")).toHaveText("14")
    await expect(input).toBeVisible()
    await input.fill("11")
    if (width === 390) await row.getByRole("button", { name: "移动 位置服务器14 到指定位置", exact: true }).click()
    else await input.press("Enter")
    await expect(input).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(row.locator("[data-sort-position]")).toHaveText("11")
    await expect(row.getByText("ID 114", { exact: true })).toBeVisible()
    const ids = () => dialog.locator("[data-sort-server]").evaluateAll(rows => rows.map(row => Number(row.getAttribute("data-sort-server"))))
    const expected = Array.from({ length: 16 }, (_, i) => 101 + i)
    expected.splice(13, 1); expected.splice(10, 0, 114)
    expect(await ids()).toEqual(expected)
    await expect(dialog.locator('[data-sort-server="111"] [data-sort-position]')).toHaveText("12")
    await expect(dialog.locator('[data-sort-server="112"] [data-sort-position]')).toHaveText("13")
    await expect(dialog.locator('[data-sort-server="113"] [data-sort-position]')).toHaveText("14")
    expect(writes).toHaveLength(0)
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: "test-results/server-position-input-" + width + ".png" })
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(writes).toEqual([{ path: "/api/v1/server/order", body: { server_ids: expected } }])
    await page.reload()
    await page.getByRole("button", { name: "服务器排序", exact: true }).click()
    expect(await ids()).toEqual(expected)
    expect(servers.every(s => s.uuid === "position-" + (s.id - 101) && s.note === "preserve")).toBe(true)
})
