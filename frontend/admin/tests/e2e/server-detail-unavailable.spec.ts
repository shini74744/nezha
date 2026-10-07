import { test, expect, type Page, type WebSocketRoute } from "@playwright/test"
import { createServer } from "../../../user/src/test/fixtures"

test.use({ ignoreHTTPSErrors: true })
async function fixture(page: Page, theme: string) {
    const origin = "https://127.0.0.1:" + (theme === "default" ? "18477" : "18478")
    const sockets: WebSocketRoute[] = []
    const detailReads: string[] = []
    let available = false, silent = false, settingsFail = false
    const frame = () => {
        const now = Date.now()
        return JSON.stringify({ now, servers: available ? [createServer({
            id: 7, name: "可恢复节点", last_active: new Date(now).toISOString(),
        })] : [], online: available ? 1 : 0 })
    }
    await page.addInitScript(() => {
        localStorage.setItem("language", "zh-CN")
        localStorage.setItem("doraemon-sky", "light")
    })
    await page.routeWebSocket("**/api/v1/ws/server", socket => {
        sockets.push(socket)
        if (!silent) socket.send(frame())
    })
    await page.route("**/*", async route => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) return route.abort()
        if (!url.pathname.startsWith("/api/")) return route.continue()
        if (url.pathname === "/api/v1/profile") return route.fulfill({status:401,json:{success:false}})
        if (url.pathname === "/api/v1/setting") return route.fulfill({json:settingsFail
            ? {success:false,error:"temporary settings failure"}
            : {success:true,data:{config:{language:"zh-CN",site_name:"恢复测试",custom_code:""}}}})
        let data: unknown = []
        if (/\/server\/[^/]+\//.test(url.pathname)) detailReads.push(url.pathname)
        if (url.pathname.endsWith("/metrics")) data = {data_points:[]}
        if (url.pathname.endsWith("/last-report")) data = null
        if (url.pathname === "/api/v1/service") data = {services:{},cycle_transfer_stats:{}}
        return route.fulfill({json:{success:true,data}})
    })
    return {
        origin, detailReads,
        makeAvailable() { available = true; silent = false },
        silence() { silent = true },
        failSettings(value: boolean) { settingsFail = value },
        publish() { for (const socket of sockets) socket.send(frame()) },
    }
}
for (const theme of ["default", "doraemon"]) for (const width of [390, 1440]) {
    test(`invalid and unavailable node is not an endless skeleton ${theme} ${width}`, async ({page}) => {
        await page.setViewportSize({width,height:900})
        const state = await fixture(page,theme)
        for (const id of ["invalid", "0", "-1", "9007199254740992", "99999999"]) {
            await page.goto(state.origin + "/server/" + id)
            await expect(page.getByText("节点不存在或无权查看", {exact:true})).toBeVisible()
            await expect(page.locator("[data-detail-initializing],.server-info-tab")).toHaveCount(0)
            await expect(page.getByRole("link",{name:"返回列表",exact:true})).toBeVisible()
        }
        expect(state.detailReads).toEqual([])
        await page.getByRole("link",{name:"返回列表",exact:true}).click()
        await expect(page).toHaveURL(state.origin + "/")
    })
    test(`unavailable node reload recovers and native tabs support keyboard ${theme} ${width}`, async ({page}) => {
        await page.setViewportSize({width,height:900})
        const state = await fixture(page,theme)
        await page.goto(state.origin + "/server/7")
        await expect(page.getByText("节点不存在或无权查看",{exact:true})).toBeVisible()
        state.makeAvailable()
        await page.getByRole("button",{name:"重新加载",exact:true}).click()
        await expect(page.locator("[data-detail-unavailable]")).toHaveCount(0)
        await expect(page.locator(".server-info-tab")).toBeVisible()
        const network = page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true})
        await network.focus()
        await page.keyboard.press("Enter")
        await expect(network).toHaveAttribute("aria-pressed","true")
        const details = page.locator(".server-info-tab").getByRole("button").first()
        await details.focus()
        await page.keyboard.press("Space")
        await expect(details).toHaveAttribute("aria-pressed","true")
        await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    })
    test(`initial websocket timeout is recoverable not a missing node ${theme} ${width}`, async ({page}) => {
        await page.setViewportSize({width,height:900})
        const state = await fixture(page,theme); state.silence()
        await page.goto(state.origin + "/server/7")
        await expect(page.locator("[data-detail-initializing]")).toBeVisible()
        await expect(page.getByText("暂时无法加载节点信息，请稍后重试",{exact:true})).toBeVisible({timeout:20000})
        await expect(page.getByText("节点不存在或无权查看",{exact:true})).toHaveCount(0)
        state.makeAvailable()
        await page.getByRole("button",{name:"重新加载",exact:true}).click()
        await expect(page.locator(".server-info-tab")).toBeVisible()
    })
    test(`initial settings error retries without losing the node ${theme} ${width}`, async ({page}) => {
        await page.setViewportSize({width,height:900})
        const state = await fixture(page,theme); state.makeAvailable(); state.failSettings(true)
        await page.goto(state.origin + "/server/7")
        await expect(page.getByText("暂时无法加载节点信息，请稍后重试",{exact:true})).toBeVisible({timeout:20000})
        state.failSettings(false)
        await page.getByRole("button",{name:"重新加载",exact:true}).click()
        await expect(page.locator(".server-info-tab")).toBeVisible()
        await expect(page.locator("[data-detail-unavailable]")).toHaveCount(0)
    })
}
