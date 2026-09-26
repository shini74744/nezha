import { Page, expect, test } from "@playwright/test"
import fs from "node:fs"

const manifest = JSON.parse(
    fs.readFileSync(new URL("../../src/lib/appearance-manifest.json", import.meta.url), "utf8"),
) as any[]
const baseConfig = () => ({
    version: 1,
    enabled: false,
    features: Object.fromEntries(manifest.map((d) => [d.key, structuredClone(d.defaults)])),
})
async function setup(page: Page, custom_code = "", current_template = "user-dist") {
    const updates: any[] = []
    let state = { config: baseConfig(), custom_code, current_template, revision: "first" }
    let conflict = false
    await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        let data: any = []
        if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 }
        if (path === "/api/v1/setting")
            data = { config: { site_name: "Test", language: "zh-CN" }, version: "test" }
        if (path === "/api/v1/setting/appearance") {
            if (route.request().method() === "PATCH") {
                const body = route.request().postDataJSON()
                updates.push(body)
                if (conflict)
                    return route.fulfill({
                        json: { success: false, error: "appearance changed; reload settings" },
                    })
                state = {
                    ...state,
                    config: body.config,
                    revision: "second",
                    custom_code: body.remaining_custom_code ?? state.custom_code,
                }
            }
            data = state
        }
        await route.fulfill({ json: { success: true, data } })
    })
    await page.goto("/dashboard/settings/appearance")
    await expect(page.getByRole("heading", { name: "美化设置", exact: true })).toBeVisible()
    return {
        updates,
        conflict: () => {
            conflict = true
        },
    }
}
test("30 native sections, second-row tab, independent save and untouched custom code", async ({
    page,
}) => {
    const { updates } = await setup(page)
    await expect(page.locator("h2")).toHaveCount(24)
    const appearanceTab = page.getByRole("tab", { name: "美化设置", exact: true }),
        systemTab = page.getByRole("tab", { name: "系统设置", exact: true })
    expect((await appearanceTab.boundingBox())!.y).toBeGreaterThan(
        (await systemTab.boundingBox())!.y,
    )
    await page.getByRole("button", { name: "站点品牌", exact: true }).click()
    await page.getByRole("switch", { name: "启用内置美化", exact: true }).click()
    await page.getByLabel("站点说明", { exact: true }).fill("native test")
    await page.getByRole("button", { name: "保存美化设置", exact: true }).click()
    await expect.poll(() => updates.length).toBe(1)
    expect(Object.keys(updates[0].config.features)).toHaveLength(30)
    expect(updates[0].config.features.branding.description).toBe("native test")
    expect(updates[0]).not.toHaveProperty("remaining_custom_code")
    await expect(page.getByRole("button", { name: "保存美化设置", exact: true })).toBeDisabled()
})
test("unknown custom source is never cleared by migration", async ({ page }) => {
    const { updates } = await setup(page, "<script>unknown()</script>")
    await page.getByRole("button", { name: "迁移已核对的原有美化" }).click()
    await expect(page.getByText(/当前自定义代码与已核对版本不同/)).toBeVisible()
    expect(updates).toHaveLength(0)
})
test("other theme retains editable settings and shows default-only warning", async ({ page }) => {
    await setup(page, "", "other-theme")
    await expect(page.getByText("当前不是默认主题，保存配置不会影响当前前台。")).toBeVisible()
    await expect(page.locator("h2")).toHaveCount(24)
})
test("save conflict retains unsaved input", async ({ page }) => {
    const state = await setup(page)
    state.conflict()
    await page.getByRole("button", { name: "站点品牌", exact: true }).click()
    await page.getByLabel("站点说明", { exact: true }).fill("unsaved input")
    await page.getByRole("button", { name: "保存美化设置", exact: true }).click()
    await expect(page.getByText("配置已被其他页面修改，请重新读取后再保存。")).toBeVisible()
    await expect(page.getByLabel("站点说明", { exact: true })).toHaveValue("unsaved input")
})
test("exact legacy migration carries parameters and supplies atomic replacement guard", async ({
    page,
}) => {
    const file = process.env.LEGACY_APPEARANCE_FIXTURE
    test.skip(!file, "requires the private verified fixture on the build server")
    const original = JSON.parse(fs.readFileSync(file!, "utf8")).custom_code
    const { updates } = await setup(page, original)
    await page.getByRole("button", { name: "迁移已核对的原有美化" }).click()
    await expect(
        page.getByText("本次保存将归档原始美化代码并停止旧脚本执行，避免与内置功能重复。"),
    ).toBeVisible()
    await page.getByRole("button", { name: "保存美化设置", exact: true }).click()
    await expect.poll(() => updates.length).toBe(1)
    expect(updates[0].expected_custom_code).toBe(original)
    expect(updates[0].remaining_custom_code).toBe("")
    expect(updates[0].config.features.sponsor.sponsors).toHaveLength(3)
    expect(updates[0].config.features.analytics.measurementId).toBe("G-S5CPS1PHE4")
    expect(updates[0].config.enabled).toBe(true)
})

test("background editor saves multiline media, ordered schedules and region settings", async ({
    page,
}) => {
    const { updates } = await setup(page)
    await page.getByRole("button", { name: "背景图片与视频", exact: true }).click()
    const desktop = page.getByLabel("电脑背景地址", { exact: true })
    await desktop.fill("https://media.test/a.jpg\n")
    await desktop.press("End")
    await desktop.pressSequentially("https://media.test/b.mp4")
    await expect(desktop).toHaveValue("https://media.test/a.jpg\nhttps://media.test/b.mp4")
    await page.getByLabel("手机背景地址", { exact: true }).fill("https://media.test/mobile-api")
    await page.getByRole("button", { name: "添加分时规则" }).click()
    await page.getByLabel("分时规则名称 2", { exact: true }).fill("晚间")
    await page.getByLabel("分时电脑背景 2", { exact: true }).fill("https://media.test/night.webm")
    await page.getByLabel("启用分时规则 2", { exact: true }).click()
    await page.getByLabel("背景规则优先级", { exact: true }).selectOption("schedule-first")
    await page.getByLabel("国家或地区代码", { exact: true }).fill("CN, HK")
    await page.getByLabel("运营商字段路径", { exact: true }).fill("asn.org")
    await page.getByRole("button", { name: "保存美化设置", exact: true }).click()
    await expect.poll(() => updates.length).toBe(1)
    const f = updates[0].config.features.background
    expect(f.desktopMedia.map((m: any) => m.type)).toEqual(["image", "video"])
    expect(f.mobileMedia).toEqual([{ src: "https://media.test/mobile-api", type: "auto" }])
    expect(f.scheduleRules[1]).toMatchObject({
        name: "晚间",
        enabled: true,
        start: "22:00",
        end: "06:00",
    })
    expect(f.priority).toBe("schedule-first")
    expect(f.regionCountries).toEqual(["CN", "HK"])
    await page.getByRole("button", { name: "重新读取", exact: true }).click()
    await expect(desktop).toHaveValue("https://media.test/a.jpg\nhttps://media.test/b.mp4")
    await expect(page.getByLabel("分时规则名称 2", { exact: true })).toHaveValue("晚间")
    await page.screenshot({ path: "test-results/background-editor.png", fullPage: true })
})
test("background editor rejects unsafe URLs and previews custom region API fields", async ({
    page,
}) => {
    await setup(page)
    await page.getByRole("button", { name: "背景图片与视频", exact: true }).click()
    await page.getByLabel("电脑背景地址", { exact: true }).fill("javascript:alert(1)")
    await expect(page.getByRole("button", { name: "保存美化设置", exact: true })).toBeDisabled()
    await page.getByLabel("电脑背景地址", { exact: true }).fill("https://media.test/api")
    await page.route("https://region.test/query", (route) =>
        route.fulfill({ json: { asn: { org: "AS123 Example" }, data: { country: "CN" } } }),
    )
    await page.getByLabel("运营商查询地址", { exact: true }).fill("https://region.test/query")
    await page.getByLabel("运营商字段路径", { exact: true }).fill("asn.org")
    await page.getByLabel("地区字段路径", { exact: true }).fill("data.country")
    await page.getByRole("button", { name: "测试运营商查询", exact: true }).click()
    await expect(page.getByText("运营商：AS123 Example；地区：CN", { exact: true })).toBeVisible()
})

test("all sections collapse independently without toggling or losing unsaved data", async ({
    page,
}) => {
    await setup(page)
    const buttons = page.locator("section h2 button")
    await expect(buttons).toHaveCount(24)
    for (const button of await buttons.all())
        await expect(button).toHaveAttribute("aria-expanded", "false")
    const greeting = page.getByRole("button", { name: "分时段问候", exact: true })
    const toggle = page.getByRole("switch", { name: "分时段问候", exact: true })
    await toggle.click()
    await expect(greeting).toHaveAttribute("aria-expanded", "false")
    await greeting.focus()
    await page.keyboard.press("Enter")
    await expect(greeting).toHaveAttribute("aria-expanded", "true")
    await page.getByLabel("问候语 1-1", { exact: true }).fill("未保存草稿")
    await greeting.click()
    await expect(page.getByLabel("问候语 1-1", { exact: true })).not.toBeVisible()
    await greeting.click()
    await expect(page.getByLabel("问候语 1-1", { exact: true })).toHaveValue("未保存草稿")
    await expect(toggle).not.toBeChecked()
    await expect(page.getByRole("button", { name: "时钟渐变", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false",
    )
})
test("greeting add/delete, custom periods and clock colors persist after reload", async ({
    page,
}) => {
    const { updates } = await setup(page)
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.getByRole("button", { name: "分时段问候", exact: true }).click()
    await expect(page.getByLabel("问候语 1-1", { exact: true })).toHaveValue(
        "🌅 早上好，新的一天开始啦～",
    )
    await page.getByRole("button", { name: "删除问候语 1-2", exact: true }).click()
    await page.getByRole("button", { name: "添加问候语 1", exact: true }).click()
    await page.getByLabel("问候语 1-10", { exact: true }).fill("你好，新文案")
    await page.getByRole("button", { name: "添加问候时段", exact: true }).click()
    await page.getByLabel("问候时段名称 8", { exact: true }).fill("自定义夜间")
    await page.getByLabel("问候开始时间 8", { exact: true }).fill("22:30")
    await page.getByLabel("问候结束时间 8", { exact: true }).fill("06:15")
    await page.getByLabel("问候语 8-1", { exact: true }).fill("晚安")
    await page.getByRole("button", { name: "时钟渐变", exact: true }).click()
    await page.getByLabel("小时结束色", { exact: true }).fill("#123456")
    await page.getByLabel("分钟起始色", { exact: true }).fill("#abcdef")
    await page.getByLabel("秒钟结束色", { exact: true }).fill("#010203")
    await page.getByRole("button", { name: "保存美化设置", exact: true }).click()
    await expect.poll(() => updates.length).toBe(1)
    expect(updates[0].config.features.greeting.rules).toHaveLength(8)
    expect(updates[0].config.features.greeting.rules[0].messages).toContain("你好，新文案")
    expect(updates[0].config.features.greeting.rules[0].messages).not.toContain(
        "☀️ 早安，今天也要充满朝气哦！",
    )
    expect(updates[0].config.features.greeting.rules[7]).toMatchObject({
        start: "22:30",
        end: "06:15",
        messages: ["晚安"],
    })
    await page.reload()
    await page.getByRole("button", { name: "分时段问候", exact: true }).click()
    await expect(page.getByLabel("问候语 1-10", { exact: true })).toHaveValue("你好，新文案")
    await expect(page.getByLabel("问候语 8-1", { exact: true })).toHaveValue("晚安")
    await page.getByRole("button", { name: "分时段问候", exact: true }).click()
    await page.getByRole("button", { name: "时钟渐变", exact: true }).click()
    await expect(page.getByLabel("小时结束色", { exact: true })).toHaveValue("#123456")
    await expect(page.getByLabel("分钟起始色", { exact: true })).toHaveValue("#abcdef")
    await page.getByLabel("小时结束色", { exact: true }).fill("invalid")
    await expect(page.getByRole("button", { name: "保存美化设置", exact: true })).toBeDisabled()
    await page.getByLabel("小时结束色", { exact: true }).fill("#123456")
    await page.getByLabel("小时结束色", { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: "test-results/clock-settings-desktop.png" })
    expect(errors).toEqual([])
})
test("phone editors fit the viewport and support color picker and period deletion", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setup(page)
    await page.getByRole("button", { name: "时钟渐变", exact: true }).click()
    await page.getByLabel("小时起始色选色", { exact: true }).fill("#112233")
    await expect(page.getByLabel("小时起始色", { exact: true })).toHaveValue("#112233")
    await page.getByLabel("小时起始色", { exact: true }).scrollIntoViewIfNeeded()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: "test-results/clock-settings-mobile.png" })
    await page.getByRole("button", { name: "时钟渐变", exact: true }).click()
    await page.getByRole("button", { name: "分时段问候", exact: true }).click()
    await page.getByRole("button", { name: "删除问候时段 7", exact: true }).click()
    await expect(page.getByLabel("问候时段名称 7", { exact: true })).toHaveCount(0)
    await page.getByLabel("问候时段名称 1", { exact: true }).scrollIntoViewIfNeeded()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: "test-results/greeting-settings-mobile.png" })
})

test("six effects share a second-level group with independent switches and saved drafts",async({page})=>{
 const {updates}=await setup(page);
 const group=page.getByRole("button",{name:"页面特效",exact:true});
 await expect(group).toHaveAttribute("aria-expanded","false");
 await expect(page.getByRole("switch",{name:"雪花",exact:true})).not.toBeVisible();
 await group.click();
 const titles=["鼠标连线","雪花","点击碎片与返回顶部","点击爱心","页面樱花","鼠标星星"];
 for(const title of titles){
  await expect(page.getByRole("heading",{level:3,name:title,exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:title,exact:true})).toHaveAttribute("aria-expanded","false");
 }
 await expect(page.getByRole("switch",{name:"页面特效",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"雪花",exact:true}).click();
 await page.getByLabel("桌面雪花数量",{exact:true}).fill("55");
 await page.getByRole("switch",{name:"点击爱心",exact:true}).click();
 await group.click();await expect(page.getByLabel("桌面雪花数量",{exact:true})).not.toBeVisible();
 await group.click();await expect(page.getByLabel("桌面雪花数量",{exact:true})).toHaveValue("55");
 await expect(page.getByRole("switch",{name:"雪花",exact:true})).toBeChecked();
 await expect(page.getByRole("switch",{name:"点击爱心",exact:true})).not.toBeChecked();
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();
 await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].config.features.snow.count).toBe(55);
 expect(updates[0].config.features.heart.enabled).toBe(false);
 expect(Object.keys(updates[0].config.features)).toHaveLength(30);
 await page.reload();await group.click();await page.getByRole("button",{name:"雪花",exact:true}).click();
 await expect(page.getByLabel("桌面雪花数量",{exact:true})).toHaveValue("55");
 await page.getByRole("button",{name:"雪花",exact:true}).click();
 await group.scrollIntoViewIfNeeded();await page.screenshot({path:"test-results/effects-group-desktop.png"});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole("button",{name:"雪花",exact:true}).click();
 await page.getByLabel("桌面雪花数量",{exact:true}).scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/effects-group-mobile.png"});
});

test("speed card and overview have separate nested editors and persistent switches",async({page})=>{
 const {updates}=await setup(page);
 const parent=page.getByRole("button",{name:"网络速率与颜色",exact:true});
 const card=page.getByRole("button",{name:"单台服务器卡片速率",exact:true});
 const overview=page.getByRole("button",{name:"网络概览卡片速率",exact:true});
 await expect(card).not.toBeVisible();await parent.click();
 await expect(card).toHaveAttribute("aria-expanded","false");await expect(overview).toHaveAttribute("aria-expanded","false");
 await card.click();await overview.click();
 const cardBits=page.getByRole("switch",{name:"单台服务器卡片速率：转换成 Mbps/Gbps",exact:true});
 const overviewColor=page.getByRole("switch",{name:"网络概览卡片速率：启用上下行颜色",exact:true});
 await cardBits.click();await overviewColor.click();
 await expect(page.getByRole("switch",{name:"网络概览卡片速率：转换成 Mbps/Gbps",exact:true})).toBeChecked();
 await expect(page.getByRole("switch",{name:"单台服务器卡片速率：启用上下行颜色",exact:true})).toBeChecked();
 await parent.click();await parent.click();
 await expect(cardBits).not.toBeChecked();await expect(overviewColor).not.toBeChecked();
 await page.getByRole("switch",{name:"单台服务器卡片速率",exact:true}).click();
 await expect(page.getByRole("switch",{name:"网络概览卡片速率",exact:true})).toBeChecked();
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();
 await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].config.features.speed).toMatchObject({enabled:true,cardEnabled:false,bits:false,color:true,animation:true,overviewEnabled:true,overviewBits:true,overviewColor:false,overviewAnimation:true});
 await page.reload();await parent.click();await card.click();await overview.click();
 await expect(cardBits).not.toBeChecked();await expect(overviewColor).not.toBeChecked();
 await expect(page.getByRole("switch",{name:"单台服务器卡片速率",exact:true})).not.toBeChecked();
 await parent.scrollIntoViewIfNeeded();await page.screenshot({path:"test-results/speed-settings-desktop.png"});
 await page.setViewportSize({width:390,height:844});
 await card.scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/speed-settings-mobile.png"});
});

for (const width of [390,1366]) test("visitor IP settings expand and retain values "+width,async({page})=>{
 await page.setViewportSize({width,height:900});const {updates}=await setup(page);
 const section=page.locator("section").filter({has:page.getByRole("button",{name:"访客 IP 与网络检测",exact:true})});
 await section.getByText("IP、地区、ASN、测速点切换和本地缓存",{exact:true}).click();
 await expect(page.getByLabel("缓存有效期（毫秒）",{exact:true})).toBeVisible();
 await expect(page.getByLabel("底部隐藏距离（像素）",{exact:true})).toBeVisible();
 await page.getByLabel("缓存有效期（毫秒）",{exact:true}).fill("60000");
 await page.getByLabel("底部隐藏距离（像素）",{exact:true}).fill("36");
 await page.getByRole("switch",{name:"访客 IP 与网络检测",exact:true}).click();
 await expect(page.getByLabel("缓存有效期（毫秒）",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"访客 IP 与网络检测",exact:true}).click();
 await page.getByRole("button",{name:"访客 IP 与网络检测",exact:true}).click();
 await expect(page.getByLabel("缓存有效期（毫秒）",{exact:true})).toHaveValue("60000");
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].config.features.visitorIP).toMatchObject({enabled:false,cacheDuration:60000,bottomThreshold:36});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [390,1366])test("runtime prefix precedes start date "+width,async({page})=>{
 await page.setViewportSize({width,height:900});const {updates}=await setup(page);
 await page.getByRole("button",{name:"网站运行时间",exact:true}).click();
 const prefix=page.getByLabel("前缀",{exact:true}),start=page.getByLabel("开始时间（包含时区）",{exact:true});
 const a=(await prefix.boundingBox())!,b=(await start.boundingBox())!;
 if(width<640)expect(a.y).toBeLessThan(b.y);else{expect(a.x).toBeLessThan(b.x);expect(a.y).toBe(b.y)}
 await prefix.fill("测试运行时间");await start.fill("2024-11-28T00:00:00+08:00");
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].config.features.runtime).toMatchObject({prefix:"测试运行时间",startDate:"2024-11-28T00:00:00+08:00"});
});

for(const width of [390,1366])test("visitor IP complete editor saves all settings "+width,async({page})=>{
 await page.setViewportSize({width,height:900});const {updates}=await setup(page);await page.getByRole("button",{name:"访客 IP 与网络检测",exact:true}).click();
 await expect(page.getByLabel("检测节点名称 1",{exact:true})).toHaveValue("Google");await expect(page.getByLabel("检测节点名称 2",{exact:true})).toHaveValue("CF");
 await page.getByRole("button",{name:"添加查询接口",exact:true}).click();await page.getByLabel("IP 查询接口 4",{exact:true}).fill("https://custom.test/json");
 await page.getByRole("button",{name:"删除查询接口 2",exact:true}).click();
 await page.getByLabel("信息补全接口（留空关闭）",{exact:true}).fill("https://fallback.test/json");
 for(const [label,value] of [["IP 查询超时（毫秒）","900"],["信息补全超时（毫秒）","800"],["首次检测超时（毫秒）","700"],["切换节点超时（毫秒）","600"]])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole("button",{name:"添加检测节点",exact:true}).click();
 await page.getByLabel("检测节点名称 3",{exact:true}).fill("Custom");await page.getByLabel("检测节点地址 3",{exact:true}).fill("https://custom.test/ping");
 await page.getByRole("button",{name:"上移检测节点 3",exact:true}).click();await page.getByRole("button",{name:"删除检测节点 3",exact:true}).click();
 for(const name of ["显示地区","显示 ASN","显示运营商","显示浏览器估算带宽"])await page.getByRole("switch",{name,exact:true}).click();
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].config.features.visitorIP).toMatchObject({queryTimeout:900,fallbackTimeout:800,checkTimeout:700,switchTimeout:600,showRegion:false,showASN:false,showOrganization:false,showDownlink:false,fallbackUrl:"https://fallback.test/json"});
 expect(updates[0].config.features.visitorIP.ipApiUrls).toHaveLength(3);expect(updates[0].config.features.visitorIP.checkNodes.map((n:any)=>n.name)).toEqual(["Google","Custom"]);
 await page.getByRole("button",{name:"重新读取",exact:true}).click();await expect(page.getByLabel("检测节点名称 2",{exact:true})).toHaveValue("Custom");
 await page.getByLabel("检测节点地址 2",{exact:true}).fill("javascript:alert(1)");await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
 await page.getByLabel("检测节点地址 2",{exact:true}).fill("https://custom.test/ping");await page.getByLabel("检测节点名称 2",{exact:true}).fill("Google");await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
 await page.getByLabel("检测节点名称 2",{exact:true}).fill("Custom");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator("section").filter({has:page.getByRole("button",{name:"访客 IP 与网络检测",exact:true})}).last().screenshot({path:"test-results/visitor-settings-"+width+".png"});
});

test("independent peak-cut and mutually exclusive mascot settings save and reload",async({page})=>{
 const {updates}=await setup(page);
 await page.getByRole("button",{name:"网络图削峰",exact:true}).click();
 await page.getByRole("switch",{name:"手机端启用",exact:true}).click();
 await page.getByRole("switch",{name:"电脑端启用",exact:true}).click();
 await page.getByRole("button",{name:"看板娘",exact:true}).click();
 await page.getByLabel("看板娘类型",{exact:true}).selectOption("sakana");
 await page.getByLabel("Sakana 默认角色",{exact:true}).selectOption("takina");
 await page.getByLabel("Sakana 尺寸（像素）",{exact:true}).fill("180");
 await expect(page.getByLabel("模型资源目录",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();
 await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].config.features.peakCut).toEqual({enabled:true,desktop:false,mobile:true});
 expect(updates[0].config.features.live2d.provider).toBe("sakana");
 expect(updates[0].config.features.live2d.character).toBe("takina");
 await page.reload();await page.getByRole("button",{name:"看板娘",exact:true}).click();
 await expect(page.getByLabel("看板娘类型",{exact:true})).toHaveValue("sakana");
 await page.getByLabel("看板娘类型",{exact:true}).selectOption("live2d");
 await expect(page.getByLabel("模型资源目录",{exact:true})).toBeVisible();
 await expect(page.getByLabel("Sakana 默认角色",{exact:true})).toHaveCount(0);
});

test("custom Sakana roles add, save, reload, validate and delete selected",async({page})=>{
 const {updates}=await setup(page);await page.getByRole("button",{name:"看板娘",exact:true}).click();
 await page.getByLabel("看板娘类型",{exact:true}).selectOption("sakana");
 await page.getByRole("button",{name:"添加自定义角色",exact:true}).click();
 await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
 await page.getByLabel("自定义角色名称 1",{exact:true}).fill("我的看板娘");
 await page.getByLabel("自定义角色图片 1",{exact:true}).fill("javascript:alert(1)");
 await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
 await page.getByLabel("自定义角色图片 1",{exact:true}).fill("https://images.test/role.png");
 await page.getByLabel("自定义角色缩放 1",{exact:true}).fill("201");await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
 await page.getByLabel("自定义角色缩放 1",{exact:true}).fill("150");
 await page.getByLabel("Sakana 默认角色",{exact:true}).selectOption({label:"我的看板娘"});
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].config.features.live2d.customCharacters[0].name).toBe("我的看板娘");
 expect(updates[0].config.features.live2d.customCharacters[0].scale).toBe(150);
 expect(updates[0].config.features.live2d.character).toBe(updates[0].config.features.live2d.customCharacters[0].id);
 await page.reload();await page.getByRole("button",{name:"看板娘",exact:true}).click();
 await expect(page.getByLabel("自定义角色图片 1",{exact:true})).toHaveValue("https://images.test/role.png");
 await expect(page.getByLabel("自定义角色缩放 1",{exact:true})).toHaveValue("150");
 await page.getByRole("button",{name:"恢复100%",exact:true}).click();await expect(page.getByLabel("自定义角色缩放 1",{exact:true})).toHaveValue("100");
 await page.getByRole("button",{name:"删除自定义角色 1",exact:true}).click();
 await expect(page.getByLabel("Sakana 默认角色",{exact:true})).toHaveValue("chisato");
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(2);
 expect(updates[1].config.features.live2d.customCharacters).toEqual([]);
});
