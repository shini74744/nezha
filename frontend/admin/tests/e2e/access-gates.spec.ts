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
                await expect(page.locator(".gate-backdrop")).toHaveCount(path === "/dashboard/" ? 1 : 0)
                if (path === "/dashboard/") {
                    await expect(page.locator("canvas.gate-globe")).toBeVisible()
                    const box = (await page.locator("main").boundingBox())!
                    expect(box.x + box.width/2).toBeCloseTo(width/2, 0)
                    expect(box.y + box.height/2).toBeCloseTo(400, 0)
                    await expect(page.getByLabel("光缆地图图例")).toBeVisible()
                    await expect(page.locator(".card .glass-sample")).toBeVisible()
                    await expect(page.locator(".card")).toHaveCSS("backdrop-filter", "none")
                    await expect(page.locator(".primary")).toHaveCSS("background-color",
                        theme === "dark" ? "rgb(49, 93, 206)" : "rgb(34, 89, 206)")
                    await expect(page.getByText("请输入管理员设置的后台访问密码。",{exact:true})).toBeVisible()
                    await expect(page.getByText("尚未登录账号时，验证后将进入账号登录页。",{exact:true})).toBeVisible()
                    await expect(page.getByRole("link",{name:"返回前台"})).toHaveAttribute("href","/")
                    await expect(page.getByLabel("访问密码",{exact:true})).toHaveAttribute("aria-describedby","access-description")
                }
                await expect(page.getByLabel("访问密码",{exact:true})).toBeFocused()
                expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
                metrics.push(await page.locator("main").evaluate(el=>{
                    const s=getComputedStyle(el);return [el.getBoundingClientRect().width,s.borderRadius,s.fontFamily]
                }))
                const field=await page.getByLabel("访问密码",{exact:true}).boundingBox()
                expect(field!.height).toBeGreaterThanOrEqual(44)
                await page.screenshot({path:info.outputPath(title+".png"),animations:"disabled"})
            }
            expect(metrics[0]).toEqual(metrics[1])
        })
    }
    test("mapped sea and land cables use offline data and a hashed script", async ({page}) => {
        const external: string[] = []
        page.on("request", request => {
            if (new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url())
        })
        const response = await page.goto("http://127.0.0.1:5179/dashboard/")
        expect(response!.headers()["content-security-policy"]).toMatch(/script-src 'sha256-[^']+'/)
        const routes = await page.locator("#globe-data").evaluate(el =>
            JSON.parse((el as HTMLTemplateElement).content.textContent!).routes)
        for (const [name, kind] of [["Southern Cross", "sea"], ["WACS", "sea"], ["Dempster Fibre Line", "land"]]) {
            expect(routes).toContainEqual(expect.objectContaining({name, kind}))
        }
        await page.getByText("地图来源", {exact:true}).click()
        await expect(page.getByRole("link", {name:/匠大 · 365 Tools/})).toHaveAttribute("href","https://365-tools.cn/submarine_cable/")
        await expect(page.getByRole("link", {name: /2015 年全球光缆/})).toBeVisible()
        expect(external).toEqual([])
    })
    for (const [width,height] of [[320,568],[390,844],[667,375]]) for (const theme of ["light","dark"] as const) {
        test("touch credits " + width + " " + theme, async ({browser}, info) => {
            const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:2,colorScheme:theme})
            try {
                const page = await context.newPage()
                await page.addInitScript(() => {
                    const clear = CanvasRenderingContext2D.prototype.clearRect
                    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                        if (this.canvas.matches(".gate-globe")) this.canvas.dataset.frames = String(Number(this.canvas.dataset.frames || 0) + 1)
                        return clear.apply(this,args)
                    }
                })
                await page.goto("http://127.0.0.1:5179/dashboard/")
                const frames = () => page.locator(".gate-globe").evaluate(el => Number(el.getAttribute("data-frames")))
                await expect.poll(frames).toBeGreaterThan(2)
                const summary = page.locator(".map-legend summary")
                const credit = page.getByRole("region",{name:"地图来源说明"})
                await summary.tap()
                await expect(credit).toBeVisible()
                await page.waitForTimeout(100)
                const frozen = await frames()
                const bounds = (await credit.boundingBox())!
                expect(bounds.x).toBeGreaterThanOrEqual(0)
                expect(bounds.y).toBeGreaterThanOrEqual(0)
                expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1)
                expect(bounds.y+bounds.height).toBeLessThanOrEqual(height+1)
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
                const source = credit.getByRole("link",{name:/匠大 · 365 Tools/})
                await expect(source).toBeInViewport()
                await expect(source).toHaveAttribute("rel","noopener noreferrer")
                for (const link of await credit.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
                await page.screenshot({path:info.outputPath("mobile-sources.png")})
                const license = credit.locator("[lang=en]")
                await license.scrollIntoViewIfNeeded()
                await expect(license).toBeInViewport()
                expect(await frames()).toBe(frozen)
                await summary.tap()
                await expect(credit).toBeHidden()
                await expect.poll(frames).toBeGreaterThan(frozen)
                await page.getByLabel("访问密码",{exact:true}).fill("test-input")
                await expect(page.getByLabel("访问密码",{exact:true})).toHaveValue("test-input")
            } finally { await context.close() }
        })
    }
    test("world rotates behind a stationary centred form and reduced motion freezes it", async ({page}) => {
        await page.setViewportSize({width:1280,height:760})
        await page.emulateMedia({reducedMotion:"no-preference"})
        await page.goto("http://127.0.0.1:5179/dashboard/")
        const canvas = page.locator(".gate-globe")
        const data = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())
        const initial = await data()
        await expect.poll(async () => (await data()) !== initial).toBe(true)
        const card = await page.locator("main").boundingBox()
        expect(card!.x + card!.width/2).toBeCloseTo(640, 0)
        expect(card!.y + card!.height/2).toBeCloseTo(380, 0)
        await page.emulateMedia({reducedMotion:"reduce"})
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        const stopped = await data()
        await page.waitForTimeout(155)
        expect((await data()) === stopped).toBe(true)
        expect(await page.locator("main").boundingBox()).toEqual(card)
    })
    test("the password gate still works with scripts disabled", async ({browser}) => {
        const context = await browser.newContext({javaScriptEnabled:false})
        try {
            const page = await context.newPage()
            await page.goto("http://127.0.0.1:5179/dashboard/")
            await page.getByLabel("访问密码", {exact:true}).fill("fixture-backend")
            await page.getByRole("button", {name:"验证并继续"}).click()
            await expect(page.getByRole("heading", {name:"账号登录"})).toBeVisible()
        } finally { await context.close() }
    })
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
