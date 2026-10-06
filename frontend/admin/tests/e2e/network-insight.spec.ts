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
    test("admin three independent switches " + width + " " + theme, async ({ page }, info) => {
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
        await page.goto("http://127.0.0.1:18479/dashboard")
        const edit = page
            .getByRole("row")
            .filter({ hasText: "开关测试" })
            .getByRole("button", { name: "编辑服务器", exact: true })
        await edit.click()
        const dialog = page.getByRole("dialog")
        for (const name of ["连通性", "BGP", "流媒体"])
            await expect(dialog.getByRole("switch", { name, exact: true })).toBeChecked()
        const settings = dialog.locator("[data-network-feature-settings]")
        await settings.scrollIntoViewIfNeeded()
        const helpText = "默认开启；关闭后隐藏前台标签并停止对应检测。"
        await expect(page.getByText(helpText, { exact: true })).toHaveCount(0)
        for (const name of ["连通性", "BGP", "流媒体"]) {
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
 await page.getByRole("button",{name:/图例与口径说明/}).click();
 await expect(page.getByText(/灰紫虚线为 RIPEstat ASN 邻接补充/)).toBeVisible();
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
