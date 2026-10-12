import { expect, test } from "@playwright/test"

for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
    test("actual server group IDs " + width + " " + theme, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 850 })
        await page.addInitScript(theme => localStorage.setItem("nezha-dashboard-theme", theme), theme)
        let groups = [1, 2, 3].map(id => ({
            group: { id, name: "分组" + id, created_at: "created-" + id, updated_at: "updated-" + id },
            servers: [47, 63], revision: "revision-" + id,
        }))
        const writes: any[] = [], errors: string[] = []
        page.on("pageerror", e => errors.push(e.message))
        await page.route("**/api/v1/**", async route => {
            const req = route.request(), url = new URL(req.url())
            let data: any = []
            if (url.pathname === "/api/v1/profile") data = { id: 1, role: 0, username: "admin" }
            if (url.pathname === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
            if (url.pathname === "/api/v1/server") data = [{ id: 47, name: "服务器47" }, { id: 63, name: "服务器63" }]
            if (req.method() === "POST" && url.pathname === "/api/v1/batch-delete/server-group") {
                const ids = req.postDataJSON() as number[]
                const revisions = JSON.parse(url.searchParams.get("revisions")!)
                for (const id of ids) expect(revisions[id]).toBe(groups.find(g => g.group.id === id)!.revision)
                writes.push({ ids, revisions })
                groups = groups.filter(g => !ids.includes(g.group.id)).map((g, i) => ({
                    ...g, group: { ...g.group, id: i + 1 }, revision: g.revision + "-moved",
                }))
            }
            if (req.method() === "PATCH" && url.pathname.startsWith("/api/v1/server-group/")) {
                const id = Number(url.pathname.split("/").at(-1)), body = req.postDataJSON()
                const group = groups.find(g => g.group.id === id)!
                expect(body.revision).toBe(group.revision)
                group.group.name = body.name
                writes.push({ id, name: body.name })
            }
            if (url.pathname === "/api/v1/server-group") data = groups
            await route.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard/server-group")
        const rows = page.locator("tbody tr")
        await expect(rows).toHaveCount(3)
        await expect(page.getByRole("columnheader", { name: "ID", exact: true })).toBeVisible()
        await expect(rows.first().locator("td").nth(1)).toHaveText("1")
        // Keep a selection on the row that will shift; it must not jump to a different group.
        await rows.nth(1).getByRole("checkbox").check()
        await rows.first().locator("button").last().click()
        await page.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click()
        await expect(rows).toHaveCount(2)
        await expect(rows.first()).toContainText("分组2")
        await expect(rows.first().locator("td").nth(1)).toHaveText("1")
        await expect(rows.nth(1).locator("td").nth(1)).toHaveText("2")
        await expect(rows.first().getByRole("checkbox")).not.toBeChecked()
        await expect(rows.first()).toContainText("47,63")
        await rows.first().getByRole("button").first().click()
        const dialog = page.getByRole("dialog")
        await expect(dialog.getByPlaceholder("Group Name")).toHaveValue("分组2")
        await dialog.getByPlaceholder("Group Name").fill("分组2已编辑")
        await dialog.locator('button[type="submit"]').click()
        await expect(dialog).not.toBeVisible()
        await expect(rows.first()).toContainText("分组2已编辑")
        await rows.nth(1).locator("button").last().click()
        await page.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click()
        await expect(rows).toHaveCount(1)
        await expect(rows.first().locator("td").nth(1)).toHaveText("1")
        expect(writes[0].ids).toEqual([1])
        expect(writes[1]).toEqual({ id: 1, name: "分组2已编辑" })
        expect(writes[2].ids).toEqual([2])
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        expect(await rows.first().locator("td").nth(2).evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(128)
        await page.locator("table").evaluate(el => { el.parentElement!.scrollLeft = 0 })
        await page.screenshot({ path: info.outputPath("group-ids.png"), animations: "disabled" })
        expect(errors).toEqual([])
    })
}
