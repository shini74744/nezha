import { type Page, expect, test } from "@playwright/test"

import { createServer } from "../../../user/src/test/fixtures"

test.use({ ignoreHTTPSErrors: true })
const origin = (theme: string) => "https://127.0.0.1:" + (theme === "doraemon" ? "18478" : "18477")
const as = (asn: number, name: string, tier1 = false) => ({ asn, name, tier1 })
const topology = {
    family: "IPv4",
    prefix: "126.7.0.0/16",
    observed_at: "2026-10-06T00:00:00",
    total: 100,
    status: "ok",
    source: "RIPE RIS / RIPEstat",
    paths: [
        {
            origin: as(17676, "SoftBank Corp."),
            direct: as(1299, "Arelion Sweden", true),
            second: as(174, "Cogent Communications", true),
            count: 35,
        },
        {
            origin: as(17676, "SoftBank Corp."),
            direct: as(3320, "Deutsche Telekom", true),
            second: as(3356, "Level 3 Parent LLC", true),
            count: 25,
        },
        {
            origin: as(17676, "SoftBank Corp."),
            direct: as(6453, "TATA Communications", true),
            second: as(24482, "SG.GS"),
            count: 20,
        },
        {
            origin: as(17676, "SoftBank Corp."),
            direct: as(3257, "GTT Communications", true),
            second: as(6762, "Telecom Italia Sparkle", true),
            count: 20,
        },
    ],
}
async function setup(
    page: Page,
    theme = "default",
    light = false,
    owner = true,
    disabled = false,
    offline = false,
) {
    const base = origin(theme),
        now = Date.now(),
        server = createServer({
            id: 7,
            name: "网络检测节点",
            country_code: "jp",
            last_active: offline ? "0001-01-01T00:00:00Z" : new Date(now).toISOString(),
            bgp_disabled: disabled,
            streaming_disabled: disabled,
        })
    const state = { posts: [] as string[], external: [] as string[], reads: 0 }
    const media = [
        ["netflix", "Netflix", "netflix", "unlocked"],
        ["youtube", "YouTube Premium", "youtube", "restricted"],
        ["disneyplus", "Disney+", "disneyplus", "unknown"],
        ["bbc", "BBC iPlayer", "bbc", "timeout"],
        ["tvb", "TVBAnywhere+", "", "unlocked"],
        ["spotify", "Spotify", "spotify", "challenge"],
    ].flatMap(([id, name, icon, status]) => [
        { id, name, icon, family: "IPv4", status, region: id === "netflix" ? "JP" : "" },
        { id, name, icon, family: "IPv6", status: "no_address" },
    ])
    await page.addInitScript(
        ({ light }) => {
            localStorage.setItem("language", "zh-CN")
            for (const k of ["vite-ui-theme", "doraemon-ui-theme", "doraemon-sky"])
                localStorage.setItem(k, light ? "light" : "dark")
        },
        { light },
    )
    await page.context().addCookies([{ name: "nz-csrf", value: "test-signed-csrf", url: base }])
    await page.routeWebSocket("**/api/v1/ws/server", (ws) =>
        ws.send(JSON.stringify({ now, servers: [server], online: offline ? 0 : 1 })),
    )
    await page.route("**/*", (route) => {
        const req = route.request(),
            u = new URL(req.url())
        if (u.origin !== base) {
            if (
                ![
                    "https://fastly.jsdelivr.net/gh/lipis/flag-icons@7.0.0/css/flag-icons.min.css",
                    "https://fastly.jsdelivr.net/npm/font-logos@1/assets/font-logos.css",
                ].includes(u.href)
            )
                state.external.push(u.href)
            return route.abort()
        }
        if (!u.pathname.startsWith("/api/")) return route.continue()
        let data: any = []
        if (u.pathname === "/api/v1/setting")
            data = {
                tsdb_enabled: true,
                config: {
                    language: "zh-CN",
                    site_name: "网络检测",
                    show_network_in_detail: true,
                    custom_code: "",
                },
            }
        if (u.pathname === "/api/v1/profile") {
            if (!owner)
                return route.fulfill({
                    status: 401,
                    json: { success: false, error: "unauthorized" },
                })
            data = { id: 1, role: 0, username: "qa" }
        }
        if (u.pathname === "/api/v1/service") data = { services: {}, cycle_transfer_stats: {} }
        if (u.pathname.endsWith("/last-report"))
            data = {
                server_id: 7,
                tsdb_enabled: true,
                history_days: 30,
                last_report_at: now - 3600000,
                metrics: {},
                recent: {},
            }
        if (u.pathname.endsWith("/metrics")) data = { data_points: [] }
        if (/\/(bgp|streaming)$/.test(u.pathname)) {
            state.reads++
            if (req.method() === "POST") {
                state.posts.push(u.pathname)
                expect(req.postData()).toBe(null)
                expect(req.headers()["x-csrf-token"]).toBe("test-signed-csrf")
            }
            const snap = {
                state: "complete",
                finished_at: now,
                topologies: [
                    topology,
                    {
                        family: "IPv6",
                        status: "no_public_ip",
                        paths: [],
                        total: 0,
                        source: "RIPE RIS",
                    },
                ],
            }
            data = {
                ...snap,
                server_id: 7,
                online: !offline,
                can_run: owner,
                results: media,
                history: [
                    snap,
                    {
                        ...snap,
                        finished_at: now - 3600000,
                        topologies: [{ ...topology, prefix: "126.6.0.0/16" }],
                    },
                ],
            }
        }
        return route.fulfill({ json: { success: true, data } })
    })
    await page.goto(base + "/server/7")
    return state
}
for (const theme of ["default", "doraemon"])
    for (const light of [false, true])
        for (const width of [320, 390, 768, 1440]) {
            test(
                "network insight UI " + theme + " " + light + " " + width,
                async ({ page }, info) => {
                    await page.setViewportSize({ width, height: 1000 })
                    const errors: string[] = []
                    page.on("pageerror", (e) => errors.push(e.message))
                    const state = await setup(page, theme, light)
                    await page.locator(".server-info-tab").getByText("BGP", { exact: true }).click()
                    await expect(page.getByRole("heading", { name: "BGP 路由拓扑" })).toBeVisible({
                        timeout: 15000,
                    })
                    await expect(
                        page.locator("[data-bgp-graph]").getByText("SoftBank Corp."),
                    ).toBeVisible()
                    expect(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth <= innerWidth + 1,
                        ),
                    ).toBe(true)
                    await page
                        .locator('[data-network-insight="bgp"]')
                        .screenshot({ path: info.outputPath("bgp.png") })
                    await page.getByRole("button", { name: "IPv6", exact: true }).click()
                    await expect(page.getByText("节点未上报此协议的公网 IP")).toBeVisible()
                    await page.getByRole("button", { name: "IPv4", exact: true }).click()
                    await page.getByRole("button").filter({ hasText: "历史快照" }).click()
                    await expect(page.getByText(/126.6.0.0/)).toBeVisible()
                    await page.getByRole("button", { name: "重新检测BGP 路由拓扑" }).click()
                    await expect.poll(() => state.posts.length).toBe(1)
                    await page
                        .locator(".server-info-tab")
                        .getByText("流媒体", { exact: true })
                        .click()
                    await expect(page.locator("[data-media-card]")).toHaveCount(6)
                    await expect(
                        page
                            .locator('[data-media-card="netflix"]')
                            .getByText("解锁", { exact: false }),
                    ).toBeVisible()
                    await expect(
                        page.locator('[data-media-card="disneyplus"]').getByText("无法判断"),
                    ).toBeVisible()
                    expect(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth <= innerWidth + 1,
                        ),
                    ).toBe(true)
                    await page
                        .locator('[data-network-insight="streaming"]')
                        .screenshot({ path: info.outputPath("streaming.png") })
                    await page.getByRole("button", { name: "重新检测流媒体解锁" }).click()
                    await expect.poll(() => state.posts.length).toBe(2)
                    expect(state.external).toEqual([])
                    expect(errors).toEqual([])
                },
            )
        }
test("visitors are readonly and disabled tabs absent", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    const state = await setup(page, "default", true, false)
    await page.locator(".server-info-tab").getByText("流媒体", { exact: true }).click()
    await expect(page.locator("[data-media-card]")).toHaveCount(6)
    await expect(page.getByRole("button", { name: /重新检测/ })).toHaveCount(0)
    expect(state.posts).toEqual([])
    await page.unrouteAll({ behavior: "wait" })
    await page.close()
})
test("switches hide both tabs without probe requests", async ({ page }) => {
    const state = await setup(page, "default", false, true, true)
    await expect(page.locator(".server-info-tab").getByText("BGP", { exact: true })).toHaveCount(0)
    await expect(page.locator(".server-info-tab").getByText("流媒体", { exact: true })).toHaveCount(
        0,
    )
    expect(state.reads).toBe(0)
})
test("offline node keeps cached streaming and blocks retest", async ({ page }) => {
    await setup(page, "doraemon", false, true, false, true)
    await page.locator(".server-info-tab").getByText("流媒体", { exact: true }).click()
    await expect(page.locator("[data-media-card]")).toHaveCount(6)
    await expect(page.getByRole("button", { name: "重新检测流媒体解锁" })).toBeDisabled()
    await expect(page.getByText(/节点离线，显示已保存结果/)).toBeVisible()
})
for (const width of [390, 1440])
    test("admin three independent switches " + width, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 })
        let server: any = {
            id: 11,
            name: "开关测试",
            uuid: "test",
            host: { version: "2.3.5" },
            display_index: 0,
            user_id: 1,
            public_note: "{}",
            note: "",
        }
        const updates: any[] = []
        await page.route("**/api/v1/**", (route) => {
            const p = new URL(route.request().url()).pathname
            let data: any = []
            if (p === "/api/v1/profile") data = { id: 1, role: 0, username: "admin" }
            if (p === "/api/v1/setting") data = { config: { language: "zh-CN" } }
            if (p === "/api/v1/server") data = [server]
            if (p === "/api/v1/server/11" && route.request().method() === "PATCH") {
                updates.push(route.request().postDataJSON())
                server = { ...server, ...updates.at(-1) }
            }
            return route.fulfill({ json: { success: true, data } })
        })
        await page.goto("http://127.0.0.1:18479/dashboard")
        const edit = page
            .getByRole("row")
            .filter({ hasText: "开关测试" })
            .getByRole("button", { name: "编辑服务器", exact: true })
        await edit.click()
        const dialog = page.getByRole("dialog")
        for (const name of ["连通性", "BGP", "流媒体"])
            await expect(dialog.getByRole("switch", { name, exact: true })).toBeChecked()
        await dialog.locator("[data-network-feature-settings]").scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("admin-switches.png") })
        await dialog.getByRole("switch", { name: "BGP", exact: true }).click()
        await dialog.getByRole("switch", { name: "流媒体", exact: true }).click()
        await dialog.locator('button[type="submit"]').click()
        await expect.poll(() => updates.length).toBe(1)
        expect(updates[0].bgp_disabled).toBe(true)
        expect(updates[0].streaming_disabled).toBe(true)
        expect(updates[0].connectivity_disabled).not.toBe(true)
        await edit.click()
        await expect(dialog.getByRole("switch", { name: "BGP", exact: true })).not.toBeChecked()
        await expect(dialog.getByRole("switch", { name: "流媒体", exact: true })).not.toBeChecked()
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
    })

test("BGP loads asynchronously and can recover from a read error", async ({ page }, info) => {
    const state = await setup(page, "default", true, false)
    let release!: () => void
    const paused = new Promise<void>((resolve) => {
        release = resolve
    })
    await page.route("**/api/v1/server/7/bgp", async (route) => {
        await paused
        return route.fulfill({
            status: 503,
            json: { success: false, error: "temporarily unavailable" },
        })
    })
    await page.locator(".server-info-tab").getByText("BGP", { exact: true }).click()
    await expect(page.getByRole("heading", { name: "BGP 路由拓扑" })).toBeVisible()
    await expect(page.getByRole("status", { name: "正在加载结果" })).toBeVisible()
    await page.screenshot({ path: info.outputPath("full-page-loading.png") })
    release()
    await expect(page.getByRole("alert")).toContainText("读取结果失败")
    await page.unroute("**/api/v1/server/7/bgp")
    await page.getByRole("button", { name: "刷新", exact: true }).click()
    await expect(page.locator("[data-bgp-graph]")).toBeVisible()
    expect(state.posts).toEqual([])
})

test("long translated tabs remain reachable on narrow screens",async({page},info)=>{
 await page.setViewportSize({width:320,height:1000});
 await setup(page,"default",true,false);
 await page.addInitScript(()=>localStorage.setItem("language","en"));
 await page.reload();
 const tabs=page.locator(".server-info-tab");
 await tabs.getByText("Streaming",{exact:true}).click();
 await expect(page.locator("[data-media-card]")).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath("mobile-tabs.png")});
 await tabs.getByText("BGP",{exact:true}).click();
 await expect(page.locator("[data-bgp-graph]")).toBeVisible();
});

for (const width of [390,1440]) test("large BGP topology stays compact and expands "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 await setup(page,"default",true,false);
 const paths=Array.from({length:40},(_,i)=>({origin:as(17676,"SoftBank Corp."),direct:as(1299+i%5,"Upstream "+i%5),second:as(30000+i,"Secondary "+i),count:1}));
 await page.route("**/api/v1/server/7/bgp",r=>r.fulfill({json:{success:true,data:{state:"complete",server_id:7,online:true,can_run:false,topologies:[{...topology,total:40,paths}]}}}));
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 const graph=page.locator("[data-bgp-graph]");
 await expect(graph.getByRole("link")).toHaveCount(14);
 expect((await graph.boundingBox())!.height).toBeLessThanOrEqual(700);
 await page.locator('[data-network-insight="bgp"]').screenshot({path:info.outputPath("large-compact.png")});
 await page.getByRole("button",{name:/展开全部 AS/}).click();
 await expect(graph.getByRole("link")).toHaveCount(46);
 await page.getByRole("button",{name:"收起为主要 AS"}).click();
 await expect(graph.getByRole("link")).toHaveCount(14);
 expect((await graph.boundingBox())!.height).toBeLessThanOrEqual(700);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
