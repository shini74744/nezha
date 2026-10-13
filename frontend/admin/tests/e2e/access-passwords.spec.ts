import { expect, test } from "@playwright/test"

for (const width of [320, 390, 768, 1024, 1440]) for (const theme of ["light", "dark"]) {
    test("profile access passwords " + width + " " + theme, async ({ page }, info) => {
        test.setTimeout(60000)
        await page.setViewportSize({ width, height: 900 })
        await page.addInitScript(theme => localStorage.setItem("nezha-dashboard-theme", theme), theme)
        const errors: string[] = []
        const writes: any[] = []
        page.on("pageerror", error => errors.push(error.message))
        let settings = { frontend_password_schedule: {enabled:false,start:"08:00",end:"23:00"}, backend_password_schedule: {enabled:false,start:"08:00",end:"23:00"}, frontend_password_required: true, backend_password_required: false, backend_password_failures: 1, backend_password_ban_minutes: 15 }
        await page.route("**/api/v1/**", async route => {
            const url = new URL(route.request().url())
            let data: any = []
            if (url.pathname === "/api/v1/profile") data = { id: 1, role: 0, username: "admin-long-profile-name-for-mobile-layout", login_ip: "2001:db8:aaaa:bbbb:cccc:dddd:eeee:1111" }
            if (url.pathname === "/api/v1/setting") data = { config: { language: "zh-CN", oauth2_providers: [], frontend_password_required: true }, version: "test" }
            if (url.pathname === "/api/v1/profile/totp") data = { enabled: false, password_enabled: true, github_enabled: false, recovery_remaining: 0 }
            if (url.pathname === "/api/v1/setting/access-passwords") {
                if (route.request().method() === "PATCH") {
                    const patch = route.request().postDataJSON(); writes.push(patch)
                    settings = { ...settings, frontend_password_schedule: patch.frontend_password_schedule ?? settings.frontend_password_schedule, backend_password_schedule: patch.backend_password_schedule ?? settings.backend_password_schedule, backend_password_required: patch.clear_backend_password ? false : !!patch.backend_password || settings.backend_password_required,
                        frontend_password_required: patch.clear_frontend_password ? false : !!patch.frontend_password || settings.frontend_password_required,
                        backend_password_failures: patch.backend_password_failures ?? settings.backend_password_failures,
                        backend_password_ban_minutes: patch.backend_password_ban_minutes ?? settings.backend_password_ban_minutes }
                }
                data = settings
            }
            await route.fulfill({ json: { success: true, data } })
        })
        await page.goto("/dashboard/profile")
        const card = page.getByTestId("access-password-settings")
        await expect(card).toBeVisible()
        await expect(card.getByLabel("新前台访问密码", {exact:true})).toHaveCount(0)
        await expect(card.getByRole("button", {name:"展开设置"})).toHaveAttribute("aria-expanded","false")
        expect((await card.boundingBox())!.height).toBeLessThan(210)
        await page.screenshot({path:info.outputPath("profile-collapsed.png"),fullPage:true,animations:"disabled"})
        await card.getByRole("button", {name:"展开设置"}).click()
        await expect(card.getByLabel("输错次数（次）")).toHaveValue("1")
        await expect(card.getByLabel("封禁时长（分钟）")).toHaveValue("15")
        await expect(card.getByRole("button", { name: "保存访问设置" })).toBeDisabled()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
        expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.screenshot({ path: info.outputPath("profile-access.png"), fullPage: true, animations: "disabled" })
        await card.getByLabel("新后台访问密码", { exact: true }).fill("fixture-new-backend")
        await card.getByLabel("确认后台访问密码").fill("mismatch")
        await card.getByRole("button", { name: "保存访问设置" }).click()
        await expect(card.getByRole("alert")).toContainText("不一致")
        expect(writes).toHaveLength(0)
        await card.getByLabel("确认后台访问密码").fill("fixture-new-backend")
        await card.getByLabel("输错次数（次）").fill("2")
        await card.getByLabel("封禁时长（分钟）").fill("30")
        await card.getByRole("button", { name: "保存访问设置" }).click()
        await expect(card.getByLabel("新后台访问密码", { exact: true })).toHaveValue("")
        expect(writes).toEqual([{ backend_password: "fixture-new-backend", backend_password_failures: 2, backend_password_ban_minutes: 30 }])
        await page.reload()
        await card.getByRole("button", {name:"展开设置"}).click()
        await expect(card.getByLabel("输错次数（次）")).toHaveValue("2")
        await expect(card.getByLabel("清除并关闭后台访问密码")).toBeVisible()
        await card.getByLabel("清除并关闭后台访问密码").check()
        await card.getByRole("button", { name: "保存访问设置" }).click()
        await expect(card.getByLabel("清除并关闭后台访问密码")).toHaveCount(0)
        expect(writes.at(-1)).toEqual({ clear_backend_password: true })
        // Separate daily schedules, cross midnight, validation and cancellation.
        await card.getByLabel("前台仅在指定时间段验证").check()
        await card.getByLabel("前台开始时间").fill("22:00")
        await card.getByLabel("前台结束时间").fill("22:00")
        await card.getByRole("button", {name:"保存访问设置"}).click()
        await expect(card.getByRole("alert")).toContainText("不同")
        expect(writes).toHaveLength(2)
        await card.getByLabel("前台结束时间").fill("07:00")
        await card.getByLabel("后台仅在指定时间段验证").check()
        await card.getByLabel("后台开始时间").fill("09:00")
        await card.getByLabel("后台结束时间").fill("18:00")
        await expect(card.getByText("结束时间（次日）")).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
        expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        const boxes=await card.locator('input[type="time"]').evaluateAll(inputs => inputs.map(el=>({width:el.getBoundingClientRect().width, scroll:el.scrollWidth, client:el.clientWidth})))
        expect(boxes.every(b=>b.width>70 && b.scroll<=b.client+1)).toBe(true)
        await page.screenshot({path:info.outputPath("profile-schedules.png"),fullPage:true,animations:"disabled"})
        await card.getByRole("button", {name:"保存访问设置"}).click()
        await expect(card.getByRole("button", {name:"保存访问设置"})).toBeDisabled()
        expect(writes.at(-1)).toEqual({frontend_password_schedule:{enabled:true,start:"22:00",end:"07:00"},backend_password_schedule:{enabled:true,start:"09:00",end:"18:00"}})
        await card.getByRole("button", {name:"收起设置"}).click()
        await expect(card.getByText("22:00–07:00（次日）")).toBeVisible()
        await page.reload()
        await expect(card.getByText("22:00–07:00（次日）")).toBeVisible()
        await card.getByRole("button",{name:"展开设置"}).focus()
        await page.keyboard.press("Enter")
        await expect(card.getByLabel("后台开始时间")).toHaveValue("09:00")
        await card.getByLabel("后台开始时间").fill("10:00")
        await card.getByRole("button",{name:"取消修改"}).click()
        expect(writes).toHaveLength(3)
        await card.getByRole("button",{name:"展开设置"}).click()
        await expect(card.getByLabel("后台开始时间")).toHaveValue("09:00")
        await card.getByLabel("前台仅在指定时间段验证").uncheck()
        await card.getByRole("button",{name:"保存访问设置"}).click()
        await expect(card.getByRole("button",{name:"保存访问设置"})).toBeDisabled()
        expect(writes.at(-1)).toEqual({frontend_password_schedule:{enabled:false,start:"22:00",end:"07:00"}})
        expect(errors).toEqual([])
    })
}

test("member cannot see global access password controls", async ({page}) => {
    let requests=0
    await page.route("**/api/v1/**", async route => {
        const path=new URL(route.request().url()).pathname
        if(path==="/api/v1/setting/access-passwords")requests++
        const data=path==="/api/v1/profile"?{id:2,role:2,username:"member"}:
            path==="/api/v1/setting"?{config:{language:"zh-CN",oauth2_providers:[]}}:
            path==="/api/v1/profile/totp"?{enabled:false,password_enabled:true}: []
        await route.fulfill({json:{success:true,data}})
    })
    await page.goto("/dashboard/profile")
    await expect(page.getByText("member",{exact:true}).first()).toBeVisible()
    await expect(page.getByTestId("access-password-settings")).toHaveCount(0)
    expect(requests).toBe(0)
})

test("load retry and failed save preserve access password edits", async ({page},info)=>{
    await page.setViewportSize({width:390,height:844})
    let failRead=true, failSave=true
    const writes:any[]=[]
    await page.route("**/api/v1/**",async route=>{
        const path=new URL(route.request().url()).pathname
        let data:any=[]
        if(path==="/api/v1/profile") data={id:1,role:0,username:"admin"}
        if(path==="/api/v1/setting") data={config:{language:"zh-CN",oauth2_providers:[]}}
        if(path==="/api/v1/profile/totp") data={enabled:false,password_enabled:true}
        if(path==="/api/v1/setting/access-passwords"){
            if(route.request().method()==="GET" && failRead){await route.fulfill({status:503,json:{success:false,error:"fixture failure"}});return}
            if(route.request().method()==="PATCH"){
                writes.push(route.request().postDataJSON())
                if(failSave){await route.fulfill({json:{success:false,error:"隔离测试：保存失败"}});return}
            }
            data={frontend_password_required:true,backend_password_required:false,backend_password_failures:1,backend_password_ban_minutes:15}
        }
        await route.fulfill({json:{success:true,data}})
    })
    await page.goto("/dashboard/profile")
    const card=page.getByTestId("access-password-settings")
    await expect(card.getByRole("alert")).toContainText("读取失败")
    failRead=false
    await card.getByRole("button",{name:"重新读取"}).click()
    await card.getByRole("button",{name:"展开设置"}).click()
    await card.getByLabel("新前台访问密码",{exact:true}).fill("fixture-front")
    await card.getByLabel("确认前台访问密码").fill("fixture-front")
    await card.getByRole("button",{name:"保存访问设置"}).click()
    await expect(card.getByRole("alert")).toContainText("保存失败")
    await expect(card.getByLabel("新前台访问密码",{exact:true})).toHaveValue("fixture-front")
    await page.screenshot({path:info.outputPath("profile-save-error.png"),fullPage:true,animations:"disabled"})
    failSave=false
    await card.getByRole("button",{name:"保存访问设置"}).click()
    await expect(card.getByLabel("新前台访问密码",{exact:true})).toHaveValue("")
    expect(writes).toEqual([{frontend_password:"fixture-front"},{frontend_password:"fixture-front"}])
})