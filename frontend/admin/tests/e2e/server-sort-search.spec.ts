import { expect, test } from "@playwright/test"

for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
    test("sort search preserves full order " + width + " " + theme, async ({ page }, info) => {
        await page.setViewportSize({ width, height: width === 320 ? 640 : 900 })
        await page.addInitScript(theme => localStorage.setItem("nezha-dashboard-theme", theme), theme)
        const names: Record<number, string> = { 3: "HK 物理机一", 17: "hk 物理机二", 30: "HK Japan [test]" }
        let servers = Array.from({ length: 40 }, (_, i) => ({
            id: 100 + i + 1, name: names[i + 1] || "普通节点 " + (i + 1),
            uuid: "search-" + (i + 1), display_index: 40 - i, user_id: 1, host: {},
            public_note: "", note: "preserved", hide_for_guest: false, hide_for_display: false,
        }))
        const writes: number[][] = []
        const errors: string[] = []
        page.on("pageerror", e => errors.push(e.message))
        await page.route("**/api/v1/**", async r => {
            const path = new URL(r.request().url()).pathname
            let data: any = []
            if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
            if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
            if (path === "/api/v1/server") data = servers
            if (["POST", "PATCH", "DELETE"].includes(r.request().method())) {
                expect(path).toBe("/api/v1/server/order")
                const ids = r.request().postDataJSON().server_ids
                writes.push(ids)
                await new Promise(resolve => setTimeout(resolve, 250))
                servers = ids.map((id: number, index: number) => ({ ...servers.find(s => s.id === id), display_index: 40 - index }))
            }
            return r.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard")
        const open = () => page.getByRole("button", { name: "服务器排序", exact: true }).click()
        await open()
        const dialog = page.getByRole("dialog")
        const search = dialog.getByRole("searchbox", { name: "搜索服务器名称或系统 ID" })
        const list = dialog.getByLabel("手动排序列表", { exact: true })
        const ids = () => list.locator("[data-sort-server]").evaluateAll(rows => rows.map(row => Number(row.getAttribute("data-sort-server"))))
        await expect(search).toBeInViewport()
        await expect(dialog.getByText("拖动调整顺序，完成后点击保存。", { exact: true })).toBeVisible()
        await expect(dialog.getByRole("status")).toHaveText("显示 40 / 40 台")
        await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
        await list.evaluate(el => { el.scrollTop = el.scrollHeight })
        await search.fill("  hK  ")
        await expect.poll(ids).toEqual([103, 117, 130])
        await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0)
        await expect(list.locator("[data-sort-position]")).toHaveText(["3", "17", "30"])
        await expect(dialog.getByRole("status")).toHaveText("显示 3 / 40 台")
        await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
        await search.fill("找不到的机器")
        await expect(list.getByText("未找到匹配的服务器")).toBeVisible()
        await expect.poll(ids).toEqual([])
        await search.fill("117")
        await expect.poll(ids).toEqual([117])
        await list.getByRole("button", { name: "上移 hk 物理机二", exact: true }).click()
        await expect(list.locator("[data-sort-position]")).toHaveText(["16"])
        await search.fill("物理机")
        await expect.poll(ids).toEqual([103, 117])
        const row = list.locator('[data-sort-server="117"]')
        await row.getByRole("button", { name: "将 hk 物理机二 移到第几位", exact: true }).click()
        await row.getByRole("spinbutton").fill("2")
        await row.getByRole("spinbutton").press("Enter")
        await expect.poll(ids).toEqual([117, 103])
        await expect(list.locator("[data-sort-position]")).toHaveText(["2", "4"])
        await search.fill("[test]")
        await expect.poll(ids).toEqual([130])
        await search.fill("HK")
        await page.screenshot({ path: info.outputPath("sort-search.png") })
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await expect(search).toBeInViewport()
        await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeInViewport()
        if (width === 1440) {
            await list.locator('[data-sort-server="130"]').dragTo(list.locator('[data-sort-server="103"]'), { targetPosition: { x: 30, y: 10 } })
            await expect.poll(ids).toEqual([117, 130, 103])
        }
        await dialog.getByRole("button", { name: "清除搜索", exact: true }).click()
        await expect(search).toHaveValue("")
        await expect(search).toBeFocused()
        const expected = Array.from({ length: 40 }, (_, i) => 101 + i).filter(id => id !== 117)
        expected.splice(1, 0, 117)
        if (width === 1440) {
            expected.splice(expected.indexOf(130), 1)
            expected.splice(expected.indexOf(103), 0, 130)
        }
        await expect.poll(ids).toEqual(expected)
        await search.fill("HK")
        expect(writes).toEqual([])
        await dialog.getByRole("button", { name: "保存", exact: true }).click()
        await expect(search).toBeDisabled()
        await expect(dialog).toHaveCount(0)
        expect(writes).toEqual([expected])
        expect(servers.every(s => s.note === "preserved" && s.uuid === "search-" + (s.id - 100))).toBe(true)
        await open()
        await expect(search).toHaveValue("")
        await expect.poll(ids).toEqual(expected)
        await search.fill("not found")
        await dialog.getByRole("button", { name: "Close", exact: true }).click()
        await open()
        await expect(search).toHaveValue("")
        expect(writes).toHaveLength(1)
        expect(errors).toEqual([])
    })
}
