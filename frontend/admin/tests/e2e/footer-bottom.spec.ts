import { expect, test } from "@playwright/test"
import { origin, setupNativeLayout } from "./native-layout-fixture"

test.use({ ignoreHTTPSErrors: true })

for (const scheme of ["light", "dark"] as const) {
    test("network card stays at the bottom after filtering, " + scheme, async ({ page }, info) => {
        await page.setViewportSize({ width: 1518, height: 920 })
        await page.addInitScript(t => localStorage.setItem("vite-ui-theme", t), scheme)
        await setupNativeLayout(page, { visitorIP:{ipApiUrls:[origin + "/visitor"]} }, ["footer", "footerIP"], 3)
        await page.goto(origin)
        const panel = page.locator("[data-native-footer-ip]")
        const box = page.locator(".nz-net-card")
        const gap = () => box.evaluate(el => innerHeight - el.getBoundingClientRect().bottom)
        await expect(page.locator(".server-overview")).toBeVisible()
        await expect(panel).toHaveAttribute("data-visible", "false")
        await page.locator(".server-overview > :nth-child(3)").click()
        await expect(page.getByText("Anchor QA 23",{exact:true}).first()).toBeVisible()
        await expect(page.getByText("Anchor QA 0",{exact:true})).toHaveCount(0)
        await expect(panel).toHaveAttribute("data-visible", "true")
        await expect(box).toContainText("203.0.113.9")
        await expect(box).toHaveCSS("transform", /matrix\(1, 0, 0, 1, 0, 0\)|none/)
        const shortGap = await gap()
        console.log("short-list bottom gap", scheme, shortGap)
        await page.screenshot({path:info.outputPath("three-offline.png")})
        expect(Math.abs(shortGap)).toBeLessThanOrEqual(2)
        const left = page.locator(".nz-footer-left")
        expect((await left.boundingBox())!.y).toBeLessThan((await box.boundingBox())!.y - 40)
        await page.locator(".server-overview > :first-child").click()
        await expect(panel).toHaveAttribute("data-visible", "false")
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
        await expect(panel).toHaveAttribute("data-visible", "true")
        await expect.poll(gap).toBeCloseTo(0, 0)
        await page.setViewportSize({width:700,height:760})
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
        await expect(panel).toHaveAttribute("data-visible", "true")
        await expect.poll(gap).toBeCloseTo(0, 0)
        const rect = (await box.boundingBox())!
        expect(Math.abs(rect.x * 2 + rect.width - 700)).toBeLessThanOrEqual(2)
        await box.getByRole("button",{name:"收起网络信息"}).click()
        await expect(panel).toHaveAttribute("data-visible", "false")
    })
}

test("briefly touching the bottom cancels the reveal; settling reveals once without resizing", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await setupNativeLayout(page, {}, ["footer", "footerIP"], 3)
    await page.goto(origin)
    await expect(page.getByText("Anchor QA 23", { exact:true }).first()).toBeAttached()
    const panel = page.locator("[data-native-footer-ip]")
    await expect(panel).toHaveAttribute("data-visible", "false")
    const card = panel.locator(".nz-net-card")
    const transitions = await panel.evaluate(async el => {
        const reveal: string[] = []
        const observer = new MutationObserver(() => reveal.push(el.getAttribute("data-visible")!))
        observer.observe(el, { attributes: true, attributeFilter: ["data-visible"] })
        const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
        const bottom = document.documentElement.scrollHeight
        scrollTo(0, bottom)
        dispatchEvent(new Event("scroll"))
        scrollBy(0, -160)
        dispatchEvent(new Event("scroll"))
        await pause(310)
        const cancelled = reveal.length === 0
        scrollTo(0, bottom)
        for (let i = 0; i < 8; i++) {
            dispatchEvent(new Event("scroll"))
            await pause(24)
        }
        await pause(300)
        observer.disconnect()
        return { cancelled, reveal, heightChange: document.documentElement.scrollHeight - bottom }
    })
    expect(transitions).toEqual({ cancelled: true, reveal: ["true"], heightChange: 0 })
    await expect(card).toHaveCSS("transform", "none")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(card).toHaveCSS("transition-duration", "0s")
    await expect(panel).toHaveCSS("transition-duration", "0s")
})

test("touch phone keeps the footer network card hidden", async ({browser})=>{
    const ctx=await browser.newContext({ignoreHTTPSErrors:true, viewport:{width:390,height:844}, hasTouch:true,isMobile:true,userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"})
    try {
        const page=await ctx.newPage()
        await setupNativeLayout(page, {}, ["footer","footerIP"], 3)
        await page.goto(origin)
        await expect(page.locator(".server-overview")).toBeVisible()
        await page.locator(".server-overview > :nth-child(3)").click()
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
        await expect(page.locator(".nz-footer-left")).toBeInViewport()
        await expect(page.locator("[data-native-footer-ip]")).toHaveCount(0)
    } finally { await ctx.close() }
})
