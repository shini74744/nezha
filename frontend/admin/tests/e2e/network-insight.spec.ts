import { type Page, expect, test } from "@playwright/test"

import { createServer } from "../../../user/src/test/fixtures"
import { graphFor } from "../../../user/src/lib/bgp-graph"

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
    holdFirstFrame = false,
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
            return_route_disabled: disabled,
        })
    const state = { posts: [] as string[], external: [] as string[], reads: 0, tick: () => {} }
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
    await page.routeWebSocket("**/api/v1/ws/server", (ws) => {
        let frame = 0
        state.tick = () => ws.send(JSON.stringify({ now: now + frame++ * 1000, servers: [server], online: offline ? 0 : 1 }))
        if (!holdFirstFrame) state.tick()
    })
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
        if (u.pathname.endsWith("/return-route")) {
            if (req.method() === "POST") {
                state.posts.push(u.pathname)
                expect(req.postData()).toBe(null)
                expect(req.headers()["x-csrf-token"]).toBe("test-signed-csrf")
            }
            const routes = ["北京", "上海", "广州"].flatMap((name, i) => ["电信", "联通", "移动"].map((carrier, j) => ({
                id: i+"-"+j, name, carrier, family: "IPv4", protocol: "tcp",
                status: i===2&&j===2 ? "unsupported" : "reached",
                target: owner ? "101.226.101.195" : undefined,
                route: ["AS36002", "电信 CTGNet", "电信 CN2"],
                hops: [{ttl:1,ip:owner?"59.43.1.1":undefined,asn:"4809",location:"中国 上海",organization:"China Telecom",rtt_ms:28.3,samples:3},{ttl:2,samples:0},{ttl:3,ip:owner?"101.226.101.195":undefined,asn:"4812",rtt_ms:31.7,samples:3}],
            })))
            const snap = {state:"complete",finished_at:now,routes}
            return route.fulfill({json:{success:true,data:{
                ...snap, server_id:7,online:!offline,can_run:owner,can_view_ip:owner,available_families:["IPv4"],
                ...(req.method()==="POST"?{state:"running",finished_at:0,routes:routes.map((r,i)=>i<3?r:{...r,status:"pending",hops:[],route:[]})}:{}),
                history:[snap,{...snap,finished_at:now-3600000,routes:routes.map(r=>({...r,route:["联通 9929"]}))}],
            }}})
        }
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
                can_view_ip: owner,
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
                    await expect(page.getByText("未获取到此协议的公网 IP")).toBeVisible()
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
for (const theme of ["light", "dark"])
for (const width of [320, 390, 1440])
    test("admin four independent switches " + width + " " + theme, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.addInitScript((theme) => localStorage.setItem("nezha-dashboard-theme", theme), theme)
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
        await page.goto((process.env.E2E_BASE_URL || "http://127.0.0.1:18479") + "/dashboard")
        const edit = page
            .getByRole("row")
            .filter({ hasText: "开关测试" })
            .getByRole("button", { name: "编辑服务器", exact: true })
        await edit.click()
        const dialog = page.getByRole("dialog")
        for (const name of ["连通性", "BGP", "回程", "流媒体"])
            await expect(dialog.getByRole("switch", { name, exact: true })).toBeChecked()
        const settings = dialog.locator("[data-network-feature-settings]")
        await settings.scrollIntoViewIfNeeded()
        const helpText = "默认开启；关闭后隐藏前台标签并停止对应检测。"
        await expect(page.getByText(helpText, { exact: true })).toHaveCount(0)
        for (const name of ["连通性", "BGP", "回程", "流媒体"]) {
            const help = settings.getByRole("button", { name: name + "说明", exact: true })
            const toggle = settings.getByRole("switch", { name, exact: true })
            const helpBox = (await help.boundingBox())!
            const toggleBox = (await toggle.boundingBox())!
            expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(toggleBox.x)
            expect(Math.abs(helpBox.y + helpBox.height / 2 - toggleBox.y - toggleBox.height / 2)).toBeLessThan(2)
            await help.click()
            const popover = page.locator("[data-setting-help]")
            await expect(popover).toHaveText(helpText)
            await expect(popover).toBeVisible()
            const box = (await popover.boundingBox())!
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(width)
            if (name === "连通性")
                await page.screenshot({ path: info.outputPath("admin-feature-help.png") })
            await page.keyboard.press("Escape")
            await expect(popover).toHaveCount(0)
            await expect(help).toBeFocused()
            await expect(toggle).toBeChecked()
            expect(updates).toHaveLength(0)
        }
        const help = settings.getByRole("button", { name: "流媒体说明", exact: true })
        await help.focus()
        await page.keyboard.press("Enter")
        await expect(page.locator("[data-setting-help]")).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(page.locator("[data-setting-help]")).toHaveCount(0)
        expect((await settings.locator(":scope > div").first().boundingBox())!.height).toBeLessThan(72)
        await page.screenshot({ path: info.outputPath("admin-switches.png") })
        await dialog.getByRole("switch", { name: "BGP", exact: true }).click()
        await dialog.getByRole("switch", { name: "回程", exact: true }).click()
        await dialog.getByRole("switch", { name: "流媒体", exact: true }).click()
        await dialog.locator('button[type="submit"]').click()
        await expect.poll(() => updates.length).toBe(1)
        expect(updates[0].bgp_disabled).toBe(true)
        expect(updates[0].return_route_disabled).toBe(true)
        expect(updates[0].streaming_disabled).toBe(true)
        expect(updates[0].connectivity_disabled).not.toBe(true)
        await edit.click()
        await expect(dialog.getByRole("switch", { name: "BGP", exact: true })).not.toBeChecked()
        await expect(dialog.getByRole("switch", { name: "回程", exact: true })).not.toBeChecked()
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

for (const width of [390,1440]) test("large BGP topology remains bounded and fit works "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 await setup(page,"default",true,false);
 const paths=Array.from({length:40},(_,i)=>({origin:as(17676,"SoftBank Corp."),direct:as(1299+i%5,"Upstream "+i%5),second:as(30000+i,"Secondary "+i),count:1}));
 await page.route("**/api/v1/server/7/bgp",r=>r.fulfill({json:{success:true,data:{state:"complete",server_id:7,online:true,can_run:false,topologies:[{...topology,total:40,paths}]}}}));
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 const graph=page.locator("[data-bgp-graph]");
 await expect(graph.locator("[data-bgp-asn]")).toHaveCount(6);
 await expect(page.locator(".bgp-scope")).toContainText("已折叠 40 个 AS");
 await page.getByRole("button",{name:"完整图",exact:true}).click();
 await expect(graph.locator("[data-bgp-asn]")).toHaveCount(46);
 expect((await graph.boundingBox())!.height).toBeLessThanOrEqual(720);
 await page.getByRole("button",{name:"适应画布",exact:true}).click();
 await expect(page.getByText(/旧快照仅保存前三层摘要/)).toBeVisible();
 await page.locator('[data-network-insight="bgp"]').screenshot({path:info.outputPath("large-fitted.png")});
 await page.getByRole("button",{name:/展开全部 .* 段分支/}).click();
 await expect(page.locator(".bgp-branch")).toHaveCount(45);
 await page.getByRole("button",{name:"收起分支",exact:true}).click();
 await expect(page.locator(".bgp-branch")).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const width of [320,390,768,1440]) test("observation graph interactions and readonly data "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 const state=await setup(page,"default",false,false);
 const asns=[10,20,30,40,50,60,70,80], path=[10,20,30,40,50,60];
 const graph={version:1,nodes:asns.map((asn,i)=>({...as(asn,"Carrier "+asn,i===2),layer:i<6?i:3,role:i===0?"origin":i===1?"direct":"transit",sample_count:10,collector_count:2,route_server:asn===80})),edges:[...path.slice(1).map((target,i)=>({source:path[i],target})),{source:30,target:70},{source:30,target:80}].map(e=>({...e,kind:"observed",provenance:"RIPE RIS",sample_count:10,collector_count:2})),paths:[{asns:path,count:8,collector_count:2},{asns:[10,20,30,70],count:1,collector_count:1},{asns:[10,20,30,80],count:1,collector_count:1}],observed_path_count:10,included_path_count:10,collector_count:2,truncated:false,supplemental_edges:[{source:40,target:70,kind:"supplemental",provenance:"RIPEstat ASN neighbours",sample_count:0,collector_count:0}],supplemental_status:"available",annotation_status:"available"};
 let reads=0;
 await page.route("**/api/v1/server/7/bgp",r=>{reads++;return r.fulfill({json:{success:true,data:{state:"complete",server_id:7,online:true,can_run:false,topologies:[{...topology,graph}]}}})});
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 const world=page.locator(".bgp-world");
 await expect(page.locator("[data-bgp-asn]")).toHaveCount(7);
 await expect(page.getByRole("button",{name:"补充连线",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"增强解释",exact:true}).click();
 await page.getByRole("button",{name:"补充连线",exact:true}).click();
 await expect(page.getByRole("button",{name:"补充连线",exact:true})).toHaveAttribute("aria-pressed","true");
 await page.getByRole("button",{name:"路由服务器",exact:true}).click();
 await expect(page.locator("[data-bgp-asn]")).toHaveCount(8);
 await page.getByRole("button",{name:"适应画布",exact:true}).click();
 await page.locator('[data-bgp-asn="40"]').click();
 await expect(page.getByRole("complementary",{name:"节点信息"})).toBeVisible();
 await expect(page.locator('[data-bgp-asn="70"]')).toHaveClass(/bgp-dimmed/);
 await page.getByRole("button",{name:"清除选择",exact:true}).click();
 await expect(page.locator(".bgp-dimmed")).toHaveCount(0);
 await page.getByRole("button",{name:"放大",exact:true}).click();
 const before=await world.getAttribute("style");
 const viewport=page.locator("[data-bgp-graph]");await viewport.scrollIntoViewIfNeeded();
 const rect=(await viewport.boundingBox())!;
 await page.mouse.move(rect.x+40,rect.y+80);await page.mouse.down();await page.mouse.move(rect.x+95,rect.y+115,{steps:5});await page.mouse.up();
 expect(await world.getAttribute("style")).not.toBe(before);
 await viewport.focus();await page.keyboard.press("Home");
 await page.getByRole("button",{name:"纵向布局",exact:true}).click();
 await expect(page.locator(".bgp-layer-vertical")).toHaveCount(6);
 await page.getByRole("button",{name:"全屏显示",exact:true}).click();
 await expect(page.getByRole("dialog")).toBeVisible();
 await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
 await expect(page.getByRole("button",{name:"全屏显示",exact:true})).toBeFocused();
 await page.getByRole("button",{name:"横向布局",exact:true}).click();
 await page.getByRole("button",{name:/图例与使用说明/}).click();
 await expect(page.getByText(/灰紫虚线为 RIPEstat 提供的 AS 邻接关系/)).toBeVisible();
 await page.getByRole("button",{name:"采集源",exact:true}).click();
 await page.locator(".bgp-branch").first().click();
 await expect(page.getByRole("complementary",{name:"分支信息"})).toBeVisible();
 await page.getByRole("button",{name:"适应画布",exact:true}).click();
 await page.locator('[data-network-insight="bgp"]').screenshot({path:info.outputPath("observation-"+width+".png")});
 expect(state.posts).toEqual([]);expect(state.external).toEqual([]);expect(reads).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for (const theme of ["default", "doraemon"])
    for (const light of [false, true])
        test("BGP wheel zoom keeps pointer anchored " + theme + " " + light, async ({ page }, info) => {
            await page.setViewportSize({ width: 1440, height: 1100 })
            const errors: string[] = []
            page.on("pageerror", e => errors.push(e.message))
            page.on("console", m => { if (m.type() === "error" && /passive.*event|preventDefault/i.test(m.text())) errors.push(m.text()) })
            const state = await setup(page, theme, light, false)
            await page.locator(".server-info-tab").getByText("BGP", { exact: true }).click()
            const viewport = page.locator("[data-bgp-graph]")
            const view = () => page.locator(".bgp-world").evaluate(el => {
                const m = new DOMMatrix(getComputedStyle(el).transform)
                return { scale: m.a, x: m.e, y: m.f, scroll: window.scrollY }
            })
            async function wheel(delta: number) {
                await viewport.scrollIntoViewIfNeeded()
                const rect = (await viewport.boundingBox())!
                const x = rect.width * .36, y = rect.height * .42
                const before = await view()
                await viewport.evaluate(el => el.addEventListener("wheel", event => {
                    const e = event as WheelEvent, r = el.getBoundingClientRect()
                    el.setAttribute("data-wheel-point", JSON.stringify({ x: e.clientX - r.left - el.clientLeft, y: e.clientY - r.top - el.clientTop }))
                }, { once: true }))
                await page.mouse.move(rect.x + x, rect.y + y)
                await page.mouse.wheel(0, delta)
                await expect.poll(async () => (await view()).scale).not.toBe(before.scale)
                const after = await view()
                expect(delta < 0 ? after.scale > before.scale : after.scale < before.scale).toBe(true)
                expect(Math.abs(after.scroll - before.scroll)).toBeLessThan(1)
                const point = JSON.parse((await viewport.getAttribute("data-wheel-point"))!)
                expect(Math.abs((point.x - before.x) / before.scale - (point.x - after.x) / after.scale)).toBeLessThan(.01)
                expect(Math.abs((point.y - before.y) / before.scale - (point.y - after.y) / after.scale)).toBeLessThan(.01)
            }
            await expect(viewport).toBeVisible()
            const activeContrast = await page.locator('.bgp-segments button[aria-pressed="true"]').first().evaluate(el => {
                const style = getComputedStyle(el)
                const luminance = (rgb: string) => {
                    const channels = rgb.match(/[0-9.]+/g)!.slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
                    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
                }
                const a = luminance(style.color), b = luminance(style.backgroundColor)
                return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
            })
            expect(activeContrast).toBeGreaterThanOrEqual(4.5)
            await wheel(-120)
            await wheel(120)
            await page.getByRole("button", { name: "适应画布", exact: true }).click()
            const node = page.locator('[data-bgp-asn="17676"]')
            await node.hover()
            const beforeNode = await view()
            await page.mouse.wheel(0, -120)
            await expect.poll(async () => (await view()).scale).toBeGreaterThan(beforeNode.scale)
            expect(Math.abs((await view()).scroll - beforeNode.scroll)).toBeLessThan(1)
            // Native wheel units, safety limits, and fullscreen listener reattachment.
            await viewport.evaluate(el => { const r = el.getBoundingClientRect(); for (let i = 0; i < 40; i++) el.dispatchEvent(new WheelEvent("wheel", { clientX: r.left + 100, clientY: r.top + 100, deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true })) })
            await expect.poll(async () => (await view()).scale).toBe(2.5)
            await viewport.evaluate(el => { const r = el.getBoundingClientRect(); for (let i = 0; i < 50; i++) el.dispatchEvent(new WheelEvent("wheel", { clientX: r.left + 100, clientY: r.top + 100, deltaY: 1, deltaMode: 2, bubbles: true, cancelable: true })) })
            await expect.poll(async () => (await view()).scale).toBe(.02)
            await page.getByRole("button", { name: "适应画布", exact: true }).click()
            await page.getByRole("button", { name: "全屏显示", exact: true }).click()
            await expect(page.getByRole("dialog")).toBeVisible()
            await wheel(-120)
            await page.keyboard.press("Escape")
            await expect(page.getByRole("dialog")).toHaveCount(0)
            await wheel(-120)
            await page.locator(".bgp-heading").scrollIntoViewIfNeeded()
            const beforeOutside = await view()
            await page.locator(".bgp-heading").hover()
            await page.mouse.wheel(0, 140)
            await expect.poll(async () => (await view()).scroll).toBeGreaterThan(beforeOutside.scroll)
            expect((await view()).scale).toBe(beforeOutside.scale)
            await page.locator('[data-network-insight="bgp"]').screenshot({ path: info.outputPath("wheel-themed.png") })
            expect(state.posts).toEqual([])
            expect(errors).toEqual([])
        })

for (const theme of ["default", "doraemon"])
    test("BGP themed mobile touch pan and pinch " + theme, async ({ browser }, info) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true })
        try {
            const page = await context.newPage(), errors: string[] = []
            page.on("pageerror", e => errors.push(e.message))
            await setup(page, theme, true, false)
            await page.locator(".server-info-tab").getByText("BGP", { exact: true }).click()
            const viewport = page.locator("[data-bgp-graph]"), world = page.locator(".bgp-world")
            await viewport.scrollIntoViewIfNeeded()
            const rect = (await viewport.boundingBox())!, session = await context.newCDPSession(page)
            const before = await world.getAttribute("style")
            await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x + 60, y: rect.y + 70 }] })
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rect.x + 95, y: rect.y + 95 }] })
            await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
            await expect(world).not.toHaveAttribute("style", before!)
            const scale = await page.locator("output[aria-label='缩放比例']").textContent()
            await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: rect.x + 80, y: rect.y + 80 }, { id: 2, x: rect.x + 180, y: rect.y + 80 }] })
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: rect.x + 55, y: rect.y + 80 }, { id: 2, x: rect.x + 205, y: rect.y + 80 }] })
            await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
            await expect(page.locator("output[aria-label='缩放比例']")).not.toHaveText(scale!)
            await page.getByRole("button", { name: "适应画布", exact: true }).click()
            const lightColor = await viewport.evaluate(el => getComputedStyle(el).backgroundColor)
            await page.locator('[data-network-insight="bgp"]').screenshot({ path: info.outputPath("mobile-light.png") })
            await page.evaluate(() => document.documentElement.classList.add("dark"))
            await expect.poll(() => viewport.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(lightColor)
            await page.locator('[data-network-insight="bgp"]').screenshot({ path: info.outputPath("mobile-dark.png") })
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
            expect(errors).toEqual([])
        } finally { await context.close() }
    })

for (const theme of ["default", "doraemon"])
    for (const light of [true, false])
        for (const width of [390, 1440])
            test("BGP core folds dense branches without changing saved evidence " + theme + " " + light + " " + width, async ({ page }, info) => {
                await page.setViewportSize({ width, height: 1000 })
                await page.clock.install()
                const state = await setup(page, theme, light, false), errors: string[] = []
                page.on("pageerror", e => errors.push(e.message))
                const paths = Array.from({ length: 100 }, (_, i) => ({
                    origin: as(10, "Origin"), direct: as(20 + i % 4, "Direct " + i % 4),
                    second: as(100 + i, "Transit " + i), count: i < 16 ? 40 - i : 1,
                }))
                const graph = graphFor({ ...topology, total: 700, paths })
                graph.legacy = false
                graph.truncated = true
                graph.collector_count = 23
                for (const [i, path] of graph.paths.entries()) {
                    graph.nodes.push({ ...as(1000 + i, "Outer " + i), layer: 3, role: "transit", sample_count: path.count, collector_count: 1 })
                    graph.edges.push({ source: 100 + i, target: 1000 + i, kind: "observed", provenance: "RIPE RIS", sample_count: path.count, collector_count: 1 })
                    path.asns.push(1000 + i)
                }
                let reads = 0
                await page.route("**/api/v1/server/7/bgp", r => {
                    reads++
                    return r.fulfill({ json: { success: true, data: { state: "complete", server_id: 7, online: true, can_run: false, topologies: [{ ...topology, graph }] } } })
                })
                await page.locator(".server-info-tab").getByText("BGP", { exact: true }).click()
                const viewport = page.locator("[data-bgp-graph]"), nodes = page.locator("[data-bgp-asn]")
                await expect(page.getByRole("button", { name: "主干图", exact: true })).toHaveAttribute("aria-pressed", "true")
                const count = await nodes.count()
                expect(count).toBeGreaterThan(10)
                expect(count).toBeLessThanOrEqual(32)
                await expect(page.locator(".bgp-scope")).toContainText(count + " / 205 个 AS")
                await expect(page.getByText(/快照收录.*700/)).toContainText("604 / 700")
                // Initial core view fits all nodes, no manual Fit or vertical scrolling inside the canvas.
                expect(await viewport.evaluate(el => {
                    const box = el.getBoundingClientRect()
                    return [...el.querySelectorAll("[data-bgp-asn]")].every(n => {
                        const r = n.getBoundingClientRect()
                        return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom
                    })
                })).toBe(true)
                await page.locator(".bgp-observation").screenshot({ path: info.outputPath("core.png") })
                await page.getByRole("button", { name: "完整图", exact: true }).click()
                await expect(nodes).toHaveCount(205)
                await expect(page.locator(".bgp-scope")).not.toContainText("已折叠")
                await page.locator('[data-bgp-asn="1099"]').focus()
                await page.keyboard.press("Enter")
                await expect(page.getByRole("complementary", { name: "节点信息" })).toBeVisible()
                await page.getByRole("button", { name: "主干图", exact: true }).click()
                await expect(nodes).toHaveCount(count)
                await expect(page.getByRole("complementary", { name: "节点信息" })).toHaveCount(0)
                await expect(page.locator(".bgp-dimmed")).toHaveCount(0)
                await page.getByRole("button", { name: "全屏显示", exact: true }).click()
                await expect(page.getByRole("dialog")).toBeVisible()
                await expect(nodes).toHaveCount(count)
                await page.getByRole("button", { name: "完整图", exact: true }).click()
                await expect(nodes).toHaveCount(205)
                await page.keyboard.press("Escape")
                await expect(nodes).toHaveCount(205)
                // Reading the same snapshot does not reset the user's display mode.
                const beforeRefresh = reads
                await page.clock.fastForward(31000)
                await expect.poll(() => reads).toBeGreaterThan(beforeRefresh)
                await expect(page.getByRole("button", { name: "完整图", exact: true })).toHaveAttribute("aria-pressed", "true")
                await page.getByRole("button", { name: "主干图", exact: true }).click()
                await page.getByRole("button", { name: "纵向布局", exact: true }).click()
                await expect(page.locator(".bgp-layer-vertical")).toHaveCount(4)
                await page.locator(".bgp-observation").screenshot({ path: info.outputPath("core-vertical.png") })
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
                expect(state.posts).toEqual([])
                expect(state.external).toEqual([])
                expect(errors).toEqual([])
            })

for(const theme of ["default","doraemon"])for(const width of [390,1440])test("BGP guest hides both prefixes and shows IPv6 topology "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:950});
 await setup(page,theme,true,false);
 await page.route("**/api/v1/server/7/bgp",route=>route.fulfill({json:{success:true,data:{
  server_id:7,state:"complete",online:true,can_run:false,can_view_ip:false,
  topologies:[topology,{...topology,family:"IPv6",prefix:"2606:4700::/32"}],
  history:[{finished_at:Date.now(),topologies:[topology]},{finished_at:Date.now()-3600000,topologies:[{...topology,prefix:"126.6.0.0/16"}]}]
 }}}));
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 await expect(page.getByText(/126[.]7[.]0[.]0/)).toHaveCount(0);
 await expect(page.getByText("100 条观测路径",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"IPv6",exact:true}).click();
 await expect(page.locator("[data-bgp-graph]")).toBeVisible();
 await expect(page.getByText(/2606:4700/)).toHaveCount(0);
 await page.getByRole("button",{name:"IPv4",exact:true}).click();
 await page.getByRole("button").filter({hasText:"历史快照"}).click();
 await expect(page.getByText(/126[.]6[.]0[.]0/)).toHaveCount(0);
 await expect(page.getByRole("button",{name:/重新检测/})).toHaveCount(0);
 await page.screenshot({path:info.outputPath("guest-ip-private.png"),fullPage:true});
});

for (const theme of ["default", "doraemon"])
    for (const width of [390, 1440])
        test("BGP families disappear and recover " + theme + " " + width, async ({ page }, info) => {
            await page.setViewportSize({ width, height: 1000 })
            await setup(page, theme, true, false)
            let families = ["IPv4", "IPv6"]
            await page.route("**/api/v1/server/7/bgp", (route) => route.fulfill({
                json: { success: true, data: {
                    server_id: 7, online: true, can_run: false, can_view_ip: false,
                    available_families: families, state: "running",
                    topologies: families.map(family => ({ ...topology, family, prefix: "" })),
                } },
            }))
            await page.locator(".server-info-tab").getByText("BGP", { exact: true }).click()
            const panel = page.locator('[data-network-insight="bgp"]')
            await expect(panel.getByRole("button", { name: "IPv6", exact: true })).toBeVisible()
            await panel.getByRole("button", { name: "IPv6", exact: true }).click()
            await expect(panel.getByRole("button", { name: "IPv6", exact: true })).toHaveAttribute("aria-pressed", "true")
            families = ["IPv4"]
            await expect(panel.getByRole("button", { name: "IPv6", exact: true })).toHaveCount(0, { timeout: 10000 })
            await expect(panel.getByRole("button", { name: "IPv4", exact: true })).toHaveAttribute("aria-pressed", "true")
            await expect(panel.locator("[data-bgp-graph]")).toBeVisible()
            await panel.screenshot({ path: info.outputPath("ipv4-only.png") })
            families = ["IPv4", "IPv6"]
            await expect(panel.getByRole("button", { name: "IPv6", exact: true })).toBeVisible({ timeout: 10000 })
            await expect(panel).not.toContainText("126.7.0.0")
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        })

for (const theme of ["default","doraemon"]) for (const width of [390,1440]) {
 test(`production BGP copy and scheduled history ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await setup(page,theme,true,false);
  const slot=Date.parse("2026-10-06T16:00:00Z"),finished=slot+127000;
  await page.route("**/api/v1/server/7/bgp",route=>route.fulfill({json:{success:true,data:{
   server_id:7,online:true,can_run:false,can_view_ip:false,available_families:["IPv4"],state:"complete",scheduled_at:slot,finished_at:finished,
   topologies:[{...topology,prefix:undefined}],history:[{state:"complete",scheduled_at:slot,finished_at:finished,topologies:[{...topology,prefix:undefined}]}]
  }}}));
  await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
  const view=page.locator('[data-network-insight="bgp"]');
  await expect(view.getByRole("navigation",{name:"BGP 历史快照"}).getByText("2026/10/7 00:00:00",{exact:true})).toBeVisible();
  await view.getByRole("button",{name:"BGP 路由拓扑说明",exact:true}).click();
  await expect(page.getByText(/查看节点的 BGP 路由与历史变化/)).toBeVisible();
  await expect(page.getByText(/管理员和节点所属用户|IP 地址及网段仅管理员可见|固定命令/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await view.getByRole("button",{name:/图例与使用说明/}).click();
  await expect(view.getByText(/完整图展示本次记录收录的全部节点/)).toBeVisible();
  await expect(view.getByText(/BGP 路由观测不代表实际流量路径/)).toBeVisible();
  await expect(view.getByText(/通常最多 32|最多查询 16|外层 hop|外层 transit/)).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await view.locator(".bgp-legend").screenshot({path:info.outputPath("production-legend.png")});
 });
}

for (const theme of ["default", "doraemon"]) test("detail interaction performance " + theme, async ({page}, info) => {
    await page.setViewportSize({width:390,height:900})
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", {rate:4})
    const state = await setup(page, theme, true, false)
    await page.locator(".server-charts svg").first().waitFor()
    const times: any[] = []
    for (const label of ["BGP","流媒体","详细","BGP","流媒体","BGP"]) {
        const tab = label === "详细" ? page.locator(".server-info-tab").getByRole("button").first() : page.locator(".server-info-tab").getByRole("button", {name:label,exact:true})
        const result = await tab.evaluate(async el => {
            const started = performance.now()
            ;(el as HTMLElement).click()
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            return {paint:performance.now()-started,pressed:el.getAttribute("aria-pressed")}
        })
        if(label==="BGP") await expect(page.locator("[data-bgp-graph]")).toBeVisible()
        else if(label==="流媒体") await expect(page.locator("[data-media-card]")).toHaveCount(6)
        else await expect(page.locator(".server-charts")).toBeVisible()
        times.push({label,...result})
    }
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.start")
    for(let i=0;i<10;i++){ state.tick(); await page.waitForTimeout(120) }
    const {profile} = await cdp.send("Profiler.stop")
    await info.attach("cpu-profile", {body:JSON.stringify(profile),contentType:"application/json"})
    const counts=new Map<number,number>()
    for(const id of profile.samples || []) counts.set(id,(counts.get(id)||0)+1)
    const hot=profile.nodes.map((n:any)=>({name:n.callFrame.functionName,url:n.callFrame.url,hits:counts.get(n.id)||0})).sort((a:any,b:any)=>b.hits-a.hits).slice(0,18)
    console.log("DETAIL_PERF", JSON.stringify({theme,times,reads:state.reads,hot}))
    expect(times.every(t=>t.pressed==="true")).toBe(true)
})

for(const theme of ["default","doraemon"]) for(const width of [320,390,1440])
test("snapshot timeline scroll and selection "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const state=await setup(page,theme,true,false);
 const slot=Date.parse("2026-10-06T16:00:00Z");
 const history=Array.from({length:12},(_,i)=>({state:"complete",finished_at:slot-i*3600000+9000,scheduled_at:slot-i*3600000,topologies:[{...topology,total:100+i},{...topology,family:"IPv6",total:200+i}]}));
 await page.route("**/api/v1/server/7/bgp",r=>r.fulfill({json:{success:true,data:{...history[0],server_id:7,online:true,can_run:false,available_families:["IPv4","IPv6"],history}}}));
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 const nav=page.getByRole("navigation",{name:"BGP 历史快照"});
 const buttons=nav.getByRole("button");
 await expect(buttons).toHaveCount(12);
 await expect(buttons.first()).toHaveAttribute("aria-pressed","true");
 await expect(page.getByText("100 条观测路径",{exact:true})).toBeVisible();
 const geometry=await nav.evaluate(el=>({w:el.clientWidth,sw:el.scrollWidth,ys:[...el.children].map(e=>e.getBoundingClientRect().top)}));
 expect(geometry.sw).toBeGreaterThan(geometry.w);
 expect(new Set(geometry.ys.map(Math.round)).size).toBe(1);
 if(width<640){
  const controls=page.locator("[data-mobile-snapshot-controls]");
  await expect(controls).toBeVisible();
  const family=await page.locator("[data-bgp-family]").boundingBox(), arrows=await controls.boundingBox(), row=await nav.boundingBox();
  expect(arrows!.y).toBeGreaterThanOrEqual(family!.y);
  expect(arrows!.y+arrows!.height).toBeLessThanOrEqual(family!.y+family!.height+1);
  expect(row!.y-family!.y-family!.height).toBeLessThanOrEqual(9);
 }
 await page.getByRole("button",{name:"较早快照",exact:true}).click();
 await expect.poll(()=>nav.evaluate(el=>el.scrollLeft)).toBeGreaterThan(30);
 // Scrolling alone must not select a different snapshot.
 await expect(buttons.first()).toHaveAttribute("aria-pressed","true");
 await buttons.last().click();
 await expect(buttons.last()).toHaveAttribute("aria-pressed","true");
 await expect(page.getByText("111 条观测路径",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"IPv6",exact:true}).click();
 await expect(page.getByText("211 条观测路径",{exact:true})).toBeVisible();
 state.tick();
 await expect(buttons.last()).toHaveAttribute("aria-pressed","true");
 await buttons.first().focus(); await page.keyboard.press("Enter");
 await expect(page.getByText("200 条观测路径",{exact:true})).toBeVisible();
 // Keyboard focus may start smooth page scrolling in the themed layout. Send
 // native wheel input only after the timeline is stationary under the pointer.
 await nav.scrollIntoViewIfNeeded();
 await expect.poll(()=>nav.evaluate(async el=>{
  const before=el.getBoundingClientRect();
  await new Promise(resolve=>setTimeout(resolve,180));
  const after=el.getBoundingClientRect();
  return Math.abs(after.top-before.top)<0.5 && Math.abs(after.left-before.left)<0.5;
 })).toBe(true);
 await nav.hover();
 await expect(nav.evaluate(el=>{
  const rect=el.getBoundingClientRect();
  const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
  return !!hit && el.contains(hit);
 })).resolves.toBe(true);
 await page.mouse.wheel(220,0);
 await expect.poll(()=>nav.evaluate(el=>el.scrollLeft)).toBeGreaterThan(20);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator("[data-snapshot-timeline]").screenshot({path:info.outputPath("timeline.png")});
 expect(state.posts).toEqual([]);
});

for(const theme of ["default","doraemon"]) test("snapshot timeline native touch "+theme,async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await setup(page,theme,true,false);
 const history=Array.from({length:8},(_,i)=>({state:"complete",finished_at:Date.now()-i*3600000,topologies:[topology]}));
 await page.route("**/api/v1/server/7/bgp",r=>r.fulfill({json:{success:true,data:{...history[0],server_id:7,online:true,can_run:false,history}}}));
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 const nav=page.getByRole("navigation",{name:"BGP 历史快照"});
 await nav.hover();
 const rect=(await nav.boundingBox())!;
 const cdp=await page.context().newCDPSession(page);
 await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true});
 const startX=rect.x+rect.width*.8,y=rect.y+rect.height/2;
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:startX,y}]});
 for(let step=1;step<=8;step++){
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:startX-step*20,y}]});
  await page.waitForTimeout(20);
 }
 await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
 await expect.poll(()=>nav.evaluate(el=>el.scrollLeft)).toBeGreaterThan(40);
 await expect(nav.getByRole("button").first()).toHaveAttribute("aria-pressed","true");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const theme of ["default","doraemon"])for(const width of [390,1440])test("snapshot selection keeps canvas and scroll stable "+theme+" "+width,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page,theme,true,false);
 const slot=Date.parse("2026-10-07T12:00:00Z");
 const history=[0,1,2].map(i=>({state:"complete",finished_at:slot-i*3600000,topologies:[{...topology,prefix:"126."+i+".0.0/16",observed_at:"2026-10-07T"+(12-i)+":00:00",total:100+i}]}));
 await page.route("**/api/v1/server/7/bgp",r=>r.fulfill({json:{success:true,data:{...history[0],server_id:7,online:true,can_run:false,available_families:["IPv4"],history}}}));
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 const nav=page.getByRole("navigation",{name:"BGP 历史快照"});
 await expect(page.locator("[data-bgp-graph]")).toBeVisible();
 await page.getByRole("button",{name:"完整图",exact:true}).click();
 await nav.scrollIntoViewIfNeeded();
 await page.waitForTimeout(180);
 await page.evaluate(()=>{(window as any).__bgpCanvas=document.querySelector(".bgp-viewport")});
 for(const index of [1,2,0,2,1]){
  const frames=await nav.getByRole("button").nth(index).evaluate(async el=>{
   const points:any[]=[];const before=window.scrollY;
   (el as HTMLElement).click();
   for(let i=0;i<5;i++){await new Promise<void>(r=>requestAnimationFrame(()=>r()));points.push({y:window.scrollY,canvas:document.querySelector(".bgp-viewport")===(window as any).__bgpCanvas,zoom:document.querySelector(".bgp-zoom")?.textContent,top:document.querySelector("[data-snapshot-timeline]")!.getBoundingClientRect().top})}
   return {before,points};
  });
  expect(frames.points.every(p=>p.canvas)).toBe(true);
  expect(frames.points.every(p=>Math.abs(p.y-frames.before)<2)).toBe(true);
  expect(new Set(frames.points.map(p=>p.zoom)).size).toBe(1);
  expect(Math.max(...frames.points.map(p=>p.top))-Math.min(...frames.points.map(p=>p.top))).toBeLessThan(2);
  await expect(page.getByRole("button",{name:"完整图",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByText((100+index)+" 条观测路径",{exact:true})).toBeVisible();
 }
 await page.locator(".server-info-tab").getByText("流媒体",{exact:true}).click();
 await page.getByRole("button",{name:"流媒体解锁说明",exact:true}).click();
 await expect(page.getByText("查看节点对各平台的访问与解锁情况，实际播放以平台结果为准。",{exact:true})).toBeVisible();
 await expect(page.getByText(/需节点支持 sh|允许 Agent 执行固定命令/)).toHaveCount(0);
});

for(const theme of ["default","doraemon"])for(const width of [320,1440]){
 test(`streaming follows available protocols ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const state=await setup(page,theme,true,false);
  let families=["IPv4"];
  const results=["netflix","youtube","disneyplus","bbc","tvb","spotify"].flatMap(id=>["IPv4","IPv6"].map(family=>({
   id,name:id,icon:id,family,status:family==="IPv4"?"unlocked":"network_error",region:family==="IPv4"?"JP":""
  })));
  await page.route("**/api/v1/server/7/streaming",route=>{
   expect(route.request().method()).toBe("GET");
   return route.fulfill({json:{success:true,data:{server_id:7,online:false,can_run:false,state:"complete",available_families:families,results}}});
  });
  for(const available of [["IPv4"],["IPv4","IPv6"],["IPv6"]]){
   families=available;
   await page.reload();
   await page.locator(".server-info-tab").getByRole("button",{name:"流媒体",exact:true}).click();
   const view=page.locator('[data-network-insight="streaming"]');
   await expect(view.locator("[data-media-card]")).toHaveCount(6);
   for(const family of ["IPv4","IPv6"]){
    await expect(view.getByText(family,{exact:true})).toHaveCount(families.includes(family)?6:0);
   }
   await expect(view.getByText("网络不可达",{exact:true})).toHaveCount(families.includes("IPv6")?6:0);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await view.screenshot({path:info.outputPath("streaming-"+families.join("-")+".png")});
  }
  expect(state.posts).toEqual([]);
 });
}

for(const theme of ["default","doraemon"])for(const width of [320,390,768,1440])test("compact BGP vertical gaps "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 await setup(page,theme,true);
 await page.locator(".server-info-tab").getByRole("button",{name:"BGP",exact:true}).click();
 const panel=page.locator('[data-network-insight="bgp"]');
 await expect(panel.locator("[data-bgp-graph]")).toBeVisible();
 const gaps=await panel.evaluate(el=>{
  const header=el.querySelector(":scope > header")!.getBoundingClientRect();
  const family=el.querySelector("[data-bgp-family]")!.getBoundingClientRect();
  const timeline=el.querySelector("[data-snapshot-timeline]")!.getBoundingClientRect();
  const graph=el.querySelector(".bgp-observation")!.getBoundingClientRect();
  const heading=el.querySelector(".bgp-heading")!.getBoundingClientRect();
  return {header:family.top-header.bottom,family:timeline.top-family.bottom,timeline:graph.top-timeline.bottom,inside:heading.top-graph.top};
 });
 expect(gaps.header).toBeLessThanOrEqual(0);expect(gaps.family).toBe(8);expect(gaps.timeline).toBe(8);expect(gaps.inside).toBe(13);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await panel.screenshot({path:info.outputPath("compact-bgp.png")});
});
for (const theme of ["default","doraemon"]) for (const width of [390,1440]) test("overview before stable tabs "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const state=await setup(page,theme,true,true,false,false,true);
 await expect(page.locator("[data-detail-initializing]")).toBeVisible();
 await expect(page.locator(".server-info-tab")).toHaveCount(0);
 await page.waitForTimeout(250);
 await expect(page.locator(".server-info-tab")).toHaveCount(0);
 state.tick();
 await expect(page.locator(".server-detail-overview .server-name")).toContainText("网络检测节点");
 await expect(page.locator(".server-info-tab")).toBeVisible();
 const first=await page.locator(".server-info-tab").boundingBox();
 state.tick();await page.waitForTimeout(350);
 const next=await page.locator(".server-info-tab").boundingBox();
 expect(Math.abs(next!.y-first!.y)).toBeLessThanOrEqual(1);
 await page.locator(".server-info-tab").getByRole("button",{name:"BGP",exact:true}).click();
 await expect(page.locator("[data-bgp-graph]")).toBeVisible();
 const switched=await page.locator(".server-info-tab").boundingBox();
 expect(Math.abs(switched!.y-first!.y)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath("stable-first-frame.png")});
 expect(errors).toEqual([]);
});
for (const theme of ["default","doraemon"]) test("streaming registration labels "+theme,async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await setup(page,theme,true,false);
 await page.route("**/api/v1/server/7/streaming*",route=>route.fulfill({json:{success:true,data:{
  server_id:7,online:true,can_run:false,state:"complete",available_families:["IPv4","IPv6"],results:[
   {id:"spotify",name:"Spotify",icon:"spotify",family:"IPv4",status:"registration_available",region:"JP"},
   {id:"spotify",name:"Spotify",icon:"spotify",family:"IPv6",status:"registration_restricted",region:"CN"},
  ],history:[],
 }}}));
 await page.locator(".server-info-tab").getByRole("button",{name:"流媒体",exact:true}).click();
 await expect(page.locator('[data-media-status="registration_available"]')).toHaveText(/可注册\s*· JP/);
 await expect(page.locator('[data-media-status="registration_restricted"]')).toHaveText(/注册受限\s*· CN/);
 await expect(page.locator('[data-media-status="unlocked"]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
for (const theme of ["default","doraemon"])
for (const light of [false,true])
for (const width of [320,390,1440])
test("return-route responsive UI "+theme+" "+light+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:950})
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 const state=await setup(page,theme,light)
 const tabs=page.locator(".server-info-tab")
 const names=await tabs.innerText();expect(names.indexOf("回程")).toBeGreaterThan(names.indexOf("BGP"));expect(names.indexOf("回程")).toBeLessThan(names.indexOf("流媒体"))
 await tabs.getByText("回程",{exact:true}).click()
 const section=page.locator('[data-network-insight="return-route"]')
 await expect(section.locator("[data-return-route]")).toHaveCount(9)
 await expect(section.getByRole("button",{name:"IPv6",exact:true})).toHaveCount(0)
 const first=section.locator("[data-return-route]").first()
 await first.getByRole("button").click()
 const dialog=page.getByRole("dialog")
 await expect(dialog.getByText("28.3 ms",{exact:true})).toBeVisible()
 await expect(dialog.getByText("未响应",{exact:true})).toBeVisible()
 await expect(dialog.getByText("59.43.1.1",{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath("return-detail-"+width+".png")})
 await page.keyboard.press("Escape")
 await expect(dialog).toHaveCount(0)
 await section.screenshot({path:info.outputPath("return-"+width+".png")})
 await section.getByRole("button").filter({hasText:"历史快照"}).first().click()
 await expect(first.locator("[data-return-summary]")).toContainText("联通 9929")
 await page.getByRole("button",{name:"重新检测回程",exact:true}).click()
 await expect(page.getByRole("button",{name:"重新检测回程",exact:true})).toBeDisabled()
 await expect(section.getByText("3 / 9",{exact:true})).toBeVisible()
 expect(state.posts).toEqual(["/api/v1/server/7/return-route"])
 expect(state.external).toEqual([]);expect(errors).toEqual([])
})
test("return-route readonly, offline and disabled states",async({page})=>{
 await setup(page,"default",true,false)
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click()
 await expect(page.locator("[data-return-route]")).toHaveCount(9)
 await page.locator("[data-return-route] > button").first().click()
 await expect(page.getByText("59.43.1.1",{exact:true})).toHaveCount(0)
 await expect(page.getByRole("button",{name:"重新检测回程"})).toHaveCount(0)
 await page.unrouteAll({behavior:"wait"});await setup(page,"default",true,true,false,true)
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click()
 await expect(page.getByRole("button",{name:"重新检测回程"})).toBeDisabled()
 await page.unrouteAll({behavior:"wait"});await setup(page,"default",true,true,true)
 await expect(page.locator(".server-info-tab").getByText("回程",{exact:true})).toHaveCount(0)
})

test("return-route IPv6-only uses the available family and survives read retry",async({page})=>{
 await page.setViewportSize({width:320,height:900});await setup(page)
 let fail=true
 await page.route("**/api/v1/server/7/return-route",r=>fail?r.fulfill({status:503,json:{success:false,error:"temporary"}}):r.fulfill({json:{success:true,data:{
  state:"complete",server_id:7,online:true,can_run:false,available_families:["IPv6"],finished_at:Date.now(),
  routes:[{id:"v6",name:"上海",carrier:"电信",family:"IPv6",protocol:"tcp",target:"240e:96c:6000:d80::b00:40",status:"reached",hops:[{ttl:1,ip:"240e:96c:6000:d80::b00:40",samples:3,rtt_ms:2.1}]}]
 }}}))
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click()
 await expect(page.getByRole("alert")).toContainText("读取回程结果失败")
 fail=false;await page.getByRole("button",{name:"刷新",exact:true}).click()
 await expect(page.getByRole("button",{name:"IPv6",exact:true})).toHaveAttribute("aria-pressed","true")
 await expect(page.getByRole("button",{name:"IPv4",exact:true})).toHaveCount(0)
 await page.locator("[data-return-route] > button").click()
 await expect(page.getByRole("dialog").getByText("2.1 ms",{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
})
for(const width of [320,390,1440]) test("return-route long details stay bounded "+width,async({page},info)=>{
 await page.setViewportSize({width,height:800});await setup(page);
 const now=Date.now(),hops=Array.from({length:30},(_,i)=>({
  ttl:i+1,samples:i>=7&&i<=14?0:3,asn:"4809",network:"电信 CN2",
  stage:i===0?"origin":i===5?"landing":i===29?"destination":"international",
  ip_hidden:true,location:"中国 上海",rtt_ms:30+i,
 }));
 const routes=Array.from({length:9},(_,i)=>({id:String(i),name:"上海",carrier:"电信",family:"IPv4",protocol:"tcp",status:"reached",line:"CN2（类型待确认）",route:["电信 CTGNet","电信 CN2"],evidence:["跨境关键跳缺失，保留待确认。"],hops}));
 await page.route("**/api/v1/server/7/return-route",r=>r.fulfill({json:{success:true,data:{state:"complete",server_id:7,online:true,can_run:true,routes,finished_at:now,history:Array.from({length:10},(_,i)=>({state:"complete",finished_at:now-i*3600000,scheduled_at:now-i*3600000,routes}))}}}));
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();
 const first=page.locator("[data-return-route]").first(),card=await first.boundingBox();
 await first.getByRole("button").click();const dialog=page.getByRole("dialog");
 await expect(dialog).toBeVisible();await expect(dialog.getByText("8 跳未响应",{exact:true})).toBeVisible();
 const box=await dialog.boundingBox();expect(box!.height).toBeLessThanOrEqual(681);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
 const scroll=dialog.locator("[data-return-hop-scroll]");
 expect(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await expect(dialog.getByText("登陆点·推测",{exact:true})).toHaveCount(1);
 await dialog.getByRole("button",{name:"逐跳显示未响应"}).click();await expect(dialog.getByText("未响应",{exact:true})).toHaveCount(8);
 await scroll.evaluate(el=>el.scrollTo(0,el.scrollHeight));await expect(dialog.getByText("到达",{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath("bounded-dialog-"+width+".png")});
 await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(first.getByRole("button")).toBeFocused();
 expect(Math.abs((await first.boundingBox())!.height-card!.height)).toBeLessThan(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test("return-route queued manual demand reuses task and shows progress",async({page})=>{
 await setup(page);let posts=0,state="queued";
 await page.route("**/api/v1/server/7/return-route",r=>{
  if(r.request().method()==="POST"){posts++;state="running"}
  return r.fulfill({json:{success:true,data:{state,server_id:7,online:true,can_run:true,queue_position:2,routes:[]}}});
 });
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();
 await expect(page.getByText("等待检测 · 排队第 2 位",{exact:true})).toBeVisible();
 const run=page.getByRole("button",{name:"重新检测回程"});await expect(run).toHaveText("优先检测");await expect(run).toBeEnabled();await run.click();
 await expect(run).toBeDisabled();await expect(run).toHaveText("检测中…");expect(posts).toBe(1);await expect(page.getByRole("alert")).toHaveCount(0);
});

for(const theme of ["default","doraemon"])
for(const light of [true,false])
for(const width of [320,390,1440])
test("return comparison, quality and final RTT "+theme+" "+light+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const state=await setup(page,theme,light,false);let posts=0;
 const now=Date.now();
 const mk=(id:string,asn:string,rtt:number)=>({id,name:"北京",carrier:id==="ct"?"电信":"联通",family:"IPv4",protocol:"tcp",comparison_key:id,status:"reached",line:asn==="4809"?"CN2（类型待确认）":"电信 163",route:["AS2914",asn==="4809"?"电信 CN2":"电信 163"],hops:[
  {ttl:1,samples:3,asn:"2914",ip_hidden:true,rtt_ms:1},
  {ttl:2,samples:3,asn,network:asn==="4809"?"电信 CN2":"电信 163",ip_hidden:true,rtt_ms:25},
  {ttl:3,samples:0},
  {ttl:4,samples:3,asn:"4812",ip_hidden:true,stage:"destination",rtt_ms:rtt},
 ]});
 const latest={state:"complete",finished_at:now,scheduled_at:now,routes:[mk("ct","4809",112.3),mk("cu","4134",30)]};
 const older={...latest,finished_at:now-3600000,scheduled_at:now-3600000,routes:[mk("ct","4134",100),mk("cu","4134",25)]};
 const oldest={...older,finished_at:now-7200000,scheduled_at:now-7200000,routes:[{...mk("ct","4134",100),comparison_key:"changed-target"}]};
 const v6={...mk("ct","4809",40),family:"IPv6",comparison_key:"v6",hops:[{ttl:1,samples:3,stage:"destination",ip_hidden:true,rtt_ms:40}]};
 latest.routes.push(v6 as any);older.routes.push(v6 as any);
 const data={...latest,state:"running",finished_at:0,server_id:7,online:true,can_run:false,available_families:["IPv4","IPv6"],history:[latest,older,oldest]};
 await page.route("**/api/v1/server/7/return-route",route=>{
  if(route.request().method()!=="GET")posts++;
  return route.fulfill({json:{success:true,data}});
 });
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();
 const section=page.locator('[data-network-insight="return-route"]');
 await expect(section.locator("[data-final-rtt]").first()).toHaveText("112.3 ms");
 const h=await section.locator("header h2").boundingBox(),f=await section.locator("[data-return-family]").boundingBox();
 if(width>=640){expect(Math.abs(h!.y+h!.height/2-f!.y-f!.height/2)).toBeLessThan(2);expect(f!.x).toBeGreaterThan(h!.x+h!.width)}
 await section.locator("[data-return-route]").first().getByRole("button").click();
 await expect(page.getByRole("dialog").locator("[data-route-quality]")).toHaveText(["优质线路"]);
 await page.keyboard.press("Escape");
 const compare=section.getByRole("button",{name:"快照对比",exact:true});await compare.click();
 const dialog=page.getByRole("dialog");await expect(dialog.getByRole("heading",{name:"回程快照对比"})).toBeVisible();
 await expect(dialog.locator("[data-return-comparison]")).toHaveCount(2);
 await expect(dialog.locator("[data-latency-delta]").first()).toHaveText("延迟差 +12.3 ms");
 await dialog.getByText("逐跳对照 · 4 个 TTL",{exact:true}).first().click();
 await expect(dialog.locator("[data-hop-difference=changed]")).toHaveCount(1);
 await expect(dialog.getByText("地址已隐藏").first()).toBeVisible();
 const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
 expect(box!.height).toBeLessThanOrEqual(811);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await dialog.screenshot({path:info.outputPath("compare-"+width+".png")});
 await dialog.getByLabel("只看路由或状态变化").check();await expect(dialog.locator("[data-return-comparison]")).toHaveCount(1);
 await dialog.getByRole("button",{name:"IPv6",exact:true}).click();await expect(dialog.getByText("没有路由或状态变化",{exact:true})).toBeVisible();
 await dialog.getByRole("button",{name:"IPv4",exact:true}).click();await dialog.getByLabel("只看路由或状态变化").uncheck();
 await dialog.getByLabel("基准快照",{exact:true}).selectOption(String(oldest.finished_at));
 await expect(dialog.getByText("目标或协议不同／无法确认一致",{exact:true})).toBeVisible();
 await expect(dialog.locator("[data-latency-delta]")).toHaveCount(0);
 // Live polling must not replace the comparison session's historical snapshots.
 data.history=[];await page.waitForTimeout(2800);await expect(dialog.getByLabel("基准快照",{exact:true})).toHaveValue(String(oldest.finished_at));
 await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
 expect(posts).toBe(0);expect(state.posts).toEqual([]);expect(errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await section.screenshot({path:info.outputPath("compact-header-"+width+".png")});
});
test("return comparison needs two completed snapshots",async({page})=>{
 await setup(page);
 await page.route("**/api/v1/server/7/return-route",r=>r.fulfill({json:{success:true,data:{state:"complete",server_id:7,online:true,can_run:false,history:[{state:"complete",finished_at:Date.now(),routes:[]},{state:"running",finished_at:0,routes:[]}],routes:[]}}}));
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();
 await expect(page.getByRole("button",{name:"快照对比",exact:true})).toBeDisabled();
});

test("return comparison closes private session when view permission is lost",async({page})=>{
 await setup(page);let privateView=true;const now=Date.now();
 const route={id:"ct",name:"北京",carrier:"电信",family:"IPv4",target:"1.1.1.1",comparison_key:"1",protocol:"tcp",status:"reached",hops:[{ttl:1,samples:3,ip:"1.1.1.1",stage:"destination",rtt_ms:10}]};
 await page.route("**/api/v1/server/7/return-route",r=>{
  const result=privateView?route:{...route,target:undefined,hops:route.hops.map(h=>({...h,ip:undefined,ip_hidden:true}))};
  return r.fulfill({json:{success:true,data:{state:"running",server_id:7,online:true,can_run:true,can_view_ip:privateView,routes:[result],history:[{state:"complete",finished_at:now,routes:[result]},{state:"complete",finished_at:now-1000,routes:[result]}]}}});
 });
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();
 await page.getByRole("button",{name:"快照对比",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();
 privateView=false;await expect(page.getByRole("dialog")).toHaveCount(0,{timeout:7000});
 await page.getByRole("button",{name:"快照对比",exact:true}).click();
 await page.getByRole("dialog").locator("summary").first().click();
 await expect(page.getByRole("dialog").getByText("1.1.1.1",{exact:true})).toHaveCount(0);
 await expect(page.getByRole("dialog").getByText("地址已隐藏",{exact:true}).first()).toBeVisible();
});

for(const theme of ["default","doraemon"]) for(const light of [false,true]) for(const width of [320,390,1440])
test("single return retest inside details "+theme+" "+light+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:850});await setup(page,theme,light);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const now=Date.now(), routes=["北京","上海"].map((name,i)=>({id:i+"-0",name,carrier:"电信",family:"IPv4",protocol:"tcp",status:"reached",tested_at:now-60000,hops:[{ttl:1,samples:3,rtt_ms:20,stage:"destination"}]}));
 const snap={state:"complete",finished_at:now-60000,routes};let posts=0,phase="idle",fail=true;
 await page.route("**/api/v1/server/7/return-route**",r=>{
  if(r.request().method()==="POST"){
   posts++;expect(new URL(r.request().url()).pathname).toBe("/api/v1/server/7/return-route/0-0/IPv4");
   expect(r.request().postData()).toBe(null);expect(r.request().headers()["x-csrf-token"]).toBe("test-signed-csrf");
   if(fail)return r.fulfill({status:400,json:{success:false,error:"该节点正在进行另一项检测，请完成后重试"}});
   phase="running";
  }
  return r.fulfill({json:{success:true,data:{...snap,can_run:true,can_view_ip:true,online:true,server_id:7,available_families:["IPv4"],history:[snap],
   ...(phase!=="idle"?{state:phase,retest:{id:"0-0",family:"IPv4"},finished_at:phase==="running"?0:now,routes:[{...routes[0],status:phase==="running"?"pending":"reached",tested_at:phase==="running"?undefined:now},routes[1]]}:{})}}})
 });
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();
 const first=page.locator("[data-return-route]").first();await first.getByRole("button").click();
 const dialog=page.getByRole("dialog"),button=dialog.getByRole("button",{name:"单独检测北京电信"});
 await expect(button).toBeVisible();expect(posts).toBe(0);
 await button.click();await expect(dialog.getByRole("alert")).toContainText("另一项检测");
 fail=false;await button.click();await expect(button).toBeDisabled();expect(posts).toBe(2);
 await expect(dialog).toBeVisible();phase="complete";await expect(button).toBeEnabled({timeout:10000});
 await expect(dialog.getByText("本项检测时间：",{exact:false})).toBeVisible();
 const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await dialog.screenshot({path:info.outputPath("single-retest.png")});
 await page.keyboard.press("Escape");
 await expect(page.locator("[data-return-route]").nth(1)).toContainText(new Date(now-60000).getFullYear().toString());
 await expect(page.getByText("本次为单项重测，其余线路保留原检测结果与时间。")).toBeVisible();
 expect(errors).toEqual([]);
});

for(const theme of ["default","doraemon"]) for(const light of [false,true]) for(const width of [320,390,1440])
test("BGP snapshot comparison responsive "+theme+" "+light+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:850});const state=await setup(page,theme,light);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const now=Date.now(), graph=graphFor(topology);graph.legacy=false;
 const old={state:"complete",finished_at:now-3600000,topologies:[{...topology,graph}]};
 const changed=structuredClone(old);changed.finished_at=now;
 changed.topologies[0].graph.paths[0].asns=[17676,1299,99999];
 changed.topologies[0].graph.truncated=true;
 const history=[changed,old,{...old,finished_at:now-7200000,topologies:[{...topology,status:"error"}]}];
 await page.route("**/api/v1/server/7/bgp",r=>r.fulfill({json:{success:true,data:{...changed,server_id:7,online:true,can_run:true,can_view_ip:true,available_families:["IPv4"],history}}}));
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 const panel=page.locator('[data-network-insight="bgp"]');await panel.getByRole("button",{name:"快照对比",exact:true}).click();
 const dialog=page.getByRole("dialog");await expect(dialog.getByRole("heading",{name:"BGP 快照对比"})).toBeVisible();
 await expect(dialog.locator('[data-bgp-path-change="added"]')).toHaveCount(1);
 await expect(dialog.locator('[data-bgp-path-change="removed"]')).toHaveCount(1);
 await expect(dialog.locator("[data-bgp-as-diff]")).toContainText("AS99999");
 await expect(dialog.getByText("存在截断记录：",{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 const box=await dialog.boundingBox();expect(box!.height).toBeLessThanOrEqual(766);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
 await dialog.screenshot({path:info.outputPath("bgp-compare.png")});
 await dialog.getByLabel("基准快照",{exact:true}).selectOption(String(now-7200000));
 await expect(dialog.getByText("所选协议族缺少两份成功观测，不计算路径增减。")).toBeVisible();
 await expect(dialog.locator("[data-bgp-path-change]")).toHaveCount(0);
 await page.keyboard.press("Escape");await expect(panel.getByRole("button",{name:"快照对比",exact:true})).toBeFocused();
 expect(state.posts).toEqual([]);expect(errors).toEqual([]);
});

test("BGP comparison freezes snapshots and closes on permission downgrade",async({page})=>{
 await setup(page);
 const now=Date.now();let readable=true,changed=false,posts=0;
 await page.route("**/api/v1/server/7/bgp",r=>{
  if(r.request().method()==="POST")posts++;
  const a={...topology,prefix:readable?"8.8.8.0/24":undefined,total:changed?99:100};
  return r.fulfill({json:{success:true,data:{state:"running",server_id:7,can_run:readable,can_view_ip:readable,online:true,topologies:[a],history:[{state:"complete",finished_at:now,topologies:[a]},{state:"complete",finished_at:now-1000,topologies:[{...a,total:88}]}]}}});
 });
 await page.locator(".server-info-tab").getByText("BGP",{exact:true}).click();
 await page.getByRole("button",{name:"快照对比",exact:true}).click();
 const dialog=page.getByRole("dialog");await expect(dialog.locator("[data-bgp-compare-summary]").last()).toContainText("100 条观测路径");
 changed=true;await page.waitForTimeout(3000);
 await expect(dialog.locator("[data-bgp-compare-summary]").last()).toContainText("100 条观测路径");
 readable=false;await expect(dialog).toHaveCount(0,{timeout:10000});
 await page.getByRole("button",{name:"快照对比",exact:true}).click();await expect(dialog).not.toContainText("8.8.8.0/24");
 await expect(dialog).toContainText("不能确认两次前缀是否一致");expect(posts).toBe(0);
});
test("single retest is unavailable for readonly and offline viewers",async({page})=>{
 await setup(page,"default",true,false);
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();await page.locator("[data-return-route] > button").first().click();
 await expect(page.getByRole("button",{name:"单独检测北京电信"})).toHaveCount(0);
 await page.unrouteAll({behavior:"wait"});await setup(page,"default",true,true,false,true);
 await page.locator(".server-info-tab").getByText("回程",{exact:true}).click();await page.locator("[data-return-route] > button").first().click();
 await expect(page.getByRole("button",{name:"单独检测北京电信"})).toBeDisabled();
});
