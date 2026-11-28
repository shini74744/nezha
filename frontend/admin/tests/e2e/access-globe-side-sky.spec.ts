import { createHash } from "node:crypto"
import { expect, test } from "@playwright/test"

const scenarios = [
    { name: "dark desktop", width: 1752, height: 768, dark: true, visible: true, moving: true },
    { name: "light desktop", width: 1366, height: 768, visible: true, moving: true },
    { name: "portrait phone", width: 390, height: 844, visible: false, touch: true },
    { name: "portrait tablet", width: 1024, height: 1366, visible: false, touch: true },
    { name: "reduced motion", width: 1440, height: 900, visible: true, reduced: true },
    { name: "two-core desktop", width: 1366, height: 768, visible: true, cores: 2 },
    { name: "forced colours", width: 1440, height: 900, visible: false, forced: true },
]

for (const s of scenarios) {
    test(`background stars on ${s.name}`, async ({ browser }) => {
        test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated access gate")
        const context = await browser.newContext({
            viewport: { width: s.width, height: s.height },
            isMobile: !!s.touch, hasTouch: !!s.touch,
            reducedMotion: s.reduced ? "reduce" : "no-preference",
            colorScheme: s.dark ? "dark" : "light", forcedColors: s.forced ? "active" : "none",
        })
        try {
            await context.addInitScript(cores => Object.defineProperty(navigator, "hardwareConcurrency", { value: cores }), s.cores ?? 8)
            const page = await context.newPage()
            const photo = "/access-media/galactic-dust-8d65591e13d4.webp"
            await page.addInitScript(() => {
                const proto = CanvasRenderingContext2D.prototype
                const draw = proto.drawImage
                Object.assign(window, { starPaints:0 })
                proto.drawImage = function (...args: any[]) {
                    if (this.canvas.className === "sky-plane") (window as any).starPaints++
                    Reflect.apply(draw,this,args)
                }
            })
            const seen: string[] = []
            page.on("request", req => { if (req.url().endsWith(photo)) seen.push(req.url()) })
            await page.goto("http://127.0.0.1:5179/dashboard/")
            const sky = page.locator(".gate-sky")
            await expect(sky).toHaveAttribute("aria-hidden", "true")
            const login = page.locator("#access-password")
            await login.fill("example")
            await expect(login).toHaveValue("example")
            if (!s.visible) {
                await expect(sky).toBeHidden()
                expect(seen).toHaveLength(0)
                expect(await page.evaluate(() => (window as any).starPaints)).toBe(0)
                return
            }
            await expect(sky).toBeVisible()
            await expect(page.getByRole("link", {name:/ESO\/S\. Brunier/})).toBeVisible()
            await expect.poll(() => seen.length).toBe(1)
            const asset = await page.request.get("http://127.0.0.1:5179" + photo)
            expect(asset.headers()["content-type"]).toBe("image/webp")
            expect(asset.headers()["cache-control"]).toContain("immutable")
            expect(createHash("sha256").update(await asset.body()).digest("hex").slice(0,12)).toBe(photo.match(/-([a-f0-9]+)\.webp/)![1])
            if (s.cores === 2) await expect(page.locator(".globe-base")).toBeAttached()
            await expect(sky).toHaveCSS("pointer-events", "none")
            const layers = sky.locator(".sky-plane")
            await expect(layers).toHaveCount(s.moving ? 4 : 1)
            const paints = () => page.evaluate(() => (window as any).starPaints as number)
            const painted = await paints()
            expect(painted).toBeGreaterThan(500)
            const form = await login.boundingBox()
            const shifts = () => layers.evaluateAll(els => els.map(el => new DOMMatrix(getComputedStyle(el).transform).m41))
            if (s.moving) {
                const ambient = await layers.last().evaluate(el => getComputedStyle(el).translate)
                await expect.poll(() => layers.last().evaluate(el => getComputedStyle(el).translate)).not.toBe(ambient)
                await page.mouse.move(s.width - 55, 83)
                await expect.poll(async () => {const x=await shifts(); return Math.abs(x[3]-x[0])}).toBeGreaterThan(8)
                expect(await paints()).toBe(painted)
                await page.emulateMedia({reducedMotion:"reduce"})
                await expect(layers).toHaveCount(1)
            }
            await expect(layers.first()).toHaveCSS("animation-name","none")
            await expect(layers.first()).toHaveCSS("transform","none")
            expect(await login.boundingBox()).toEqual(form)
        } finally { await context.close() }
    })
}

test("a persistently slow desktop keeps interactive depth with one star layer", async ({ browser }) => {
    test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated access gate")
    const context = await browser.newContext({viewport:{width:1366,height:768},reducedMotion:"no-preference"})
    try {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, "hardwareConcurrency", {value:8})
            window.requestAnimationFrame = cb => window.setTimeout(() => cb(performance.now()), 95)
            window.cancelAnimationFrame = id => clearTimeout(id)
        })
        const page = await context.newPage()
        await page.goto("http://127.0.0.1:5179/dashboard/")
        const planes = page.locator(".sky-plane")
        await expect(planes).toHaveCount(4)
        await expect(planes).toHaveCount(1,{timeout:13000})
        await expect(planes.first()).toHaveCSS("animation-name","none")
        await page.mouse.move(1260,120)
        await expect.poll(() => planes.first().evaluate(el => Math.abs(new DOMMatrix(getComputedStyle(el).transform).m41))).toBeGreaterThan(4)
        await expect(page.locator("#access-password")).toBeEditable()
    } finally { await context.close() }
})
