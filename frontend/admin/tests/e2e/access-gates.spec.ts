import { expect, test } from "@playwright/test"

test.describe("real access gate fixture", () => {
    test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated Go fixture on loopback")
    for (const width of [320,390,768,1440]) for (const theme of ["light","dark"] as const) {
        test("shared gate layout " + width + " " + theme, async ({page},info) => {
            await page.setViewportSize({width,height:800})
            await page.emulateMedia({colorScheme:theme})
            const metrics:any[]=[]
            for (const [path,title] of [["/","前台访问密码"],["/dashboard/","后台访问验证"]]) {
                await page.goto("http://127.0.0.1:5179"+path)
                await expect(page.getByRole("heading",{name:title})).toBeVisible()
                if (path === "/dashboard/") {
                    await expect(page.getByText("请输入管理员设置的后台访问密码。",{exact:true})).toBeVisible()
                    await expect(page.getByText("尚未登录账号时，验证后将进入账号登录页。",{exact:true})).toBeVisible()
                    await expect(page.getByRole("link",{name:"返回前台"})).toHaveAttribute("href","/")
                    await expect(page.getByLabel("访问密码",{exact:true})).toHaveAttribute("aria-describedby","access-description")
                }
                await expect(page.getByLabel("访问密码",{exact:true})).toBeFocused()
                expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
                metrics.push(await page.locator("main").evaluate(el=>{
                    const s=getComputedStyle(el);return [el.getBoundingClientRect().width,s.borderRadius,s.backgroundColor,s.fontFamily]
                }))
                const field=await page.getByLabel("访问密码",{exact:true}).boundingBox()
                expect(field!.height).toBeGreaterThanOrEqual(44)
                await page.screenshot({path:info.outputPath(title+".png"),animations:"disabled"})
            }
            expect(metrics[0]).toEqual(metrics[1])
        })
    }
    test("correct password leads to account login; incorrect backend password bans only backend", async ({page,context},info)=>{
        await page.setViewportSize({width:390,height:844})
        await page.goto("http://127.0.0.1:5179/dashboard/")
        await page.getByLabel("访问密码",{exact:true}).fill("fixture-backend")
        await page.getByRole("button",{name:"验证并继续"}).click()
        await expect(page.getByRole("heading",{name:"账号登录"})).toBeVisible()
        await context.clearCookies()
        await page.goto("http://127.0.0.1:5179/dashboard/")
        await page.getByLabel("访问密码",{exact:true}).fill("wrong-fixture")
        await page.getByRole("button",{name:"验证并继续"}).click()
        await expect(page.getByRole("alert")).toContainText("已封禁")
        await expect(page.getByLabel("访问密码",{exact:true})).toHaveCount(0)
        await expect(page.getByRole("heading",{name:"访问暂时受限"})).toBeVisible()
        await expect(page.getByRole("link",{name:"返回前台"})).toBeVisible()
        await page.screenshot({path:info.outputPath("backend-banned.png"),animations:"disabled"})
        const response=await page.goto("http://127.0.0.1:5179/dashboard/")
        expect(response!.status()).toBe(429)
        await page.goto("http://127.0.0.1:5179/")
        await expect(page.getByRole("heading",{name:"前台访问密码"})).toBeVisible()
        await page.getByLabel("访问密码",{exact:true}).fill("fixture-backend")
        await page.getByRole("button",{name:"进入前台"}).click()
        await expect(page.getByRole("heading",{name:"监控前台"})).toBeVisible()
    })
})
