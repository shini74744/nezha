import { expect, test } from "@playwright/test"

type EffectProbe = Window & {
    effects: { lengths: number[], colors: Set<string>, echoes: number }
    advanceEffects: (time: number) => void
}

for (const mobile of [false, true]) {
    test("cable trails, arrival echoes and focus light on " + (mobile ? "phone" : "desktop"), async ({browser}) => {
        test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated access gate")
        test.setTimeout(90_000)
        const context = await browser.newContext({
            viewport: mobile ? {width:390,height:844} : {width:1366,height:768},
            hasTouch:mobile, isMobile:mobile, colorScheme:mobile ? "dark" : "light", reducedMotion:"no-preference",
        })
        try {
            const page = await context.newPage()
            await page.addInitScript(() => {
                const probe = window as EffectProbe
                const stats = probe.effects = {lengths:[] as number[],colors:new Set<string>(),echoes:0}
                const queue = new Map<number, FrameRequestCallback>()
                let id = 0
                window.requestAnimationFrame = fn => { queue.set(++id,fn); return id }
                window.cancelAnimationFrame = key => { queue.delete(key) }
                probe.advanceEffects = time => {
                    const work = [...queue.values()]
                    queue.clear()
                    for (const fn of work) fn(time)
                }
                const proto = CanvasRenderingContext2D.prototype
                const make = proto.createLinearGradient, stroke = proto.stroke
                proto.createLinearGradient = function(x,y,endX,endY) {
                    const gradient = make.call(this,x,y,endX,endY)
                    if (this.canvas.matches(".gate-globe")) {
                        stats.lengths.push(Math.hypot(endX-x,endY-y))
                        const add = gradient.addColorStop.bind(gradient)
                        gradient.addColorStop = (offset, color) => { stats.colors.add(color); add(offset,color) }
                    }
                    return gradient
                }
                proto.stroke = function(path?: Path2D) {
                    if (this.canvas.matches(".gate-globe") && this.lineWidth === 1 && this.globalAlpha > 0) stats.echoes++
                    if (path) stroke.call(this,path)
                    else Reflect.apply(stroke,this,[])
                }
            })
            await page.goto("http://127.0.0.1:5179/dashboard/",{waitUntil:"domcontentloaded"})
            const card = page.locator("main.card"), field = page.locator("#access-password")
            const edge = () => card.evaluate(el => getComputedStyle(el,"::after").animationName)
            const position = await card.boundingBox()
            await expect(field).toBeFocused()
            expect(await edge()).toBe("none")
            if (mobile) await field.tap({force:true})
            else await field.click({force:true})
            expect(await edge()).toBe("gate-edge-sweep")
            await expect.poll(() => card.evaluate(el => getComputedStyle(el,"::after").opacity)).toBe("0")
            await page.keyboard.press("Tab")
            expect(await edge()).toBe("none")
            await page.keyboard.press("Shift+Tab")
            expect(await edge()).toBe("gate-edge-sweep")
            expect(await card.boundingBox()).toEqual(position)
            const result = await page.evaluate(() => {
                const probe = window as EffectProbe, stats = probe.effects
                let maxEchoes = 0, echoFrames = 0
                for (let i=0; i<=140; i++) {
                    stats.echoes = 0
                    probe.advanceEffects(1000+i*80)
                    maxEchoes = Math.max(maxEchoes,stats.echoes)
                    if (stats.echoes) echoFrames++
                }
                const css = getComputedStyle(document.body)
                return {maxEchoes,echoFrames,longest:Math.max(...stats.lengths),colors:[...stats.colors],
                    sea:css.getPropertyValue("--signal").trim(), land:css.getPropertyValue("--signal-violet").trim()}
            })
            expect(result.maxEchoes).toBe(2)
            expect(result.echoFrames).toBeGreaterThan(3)
            expect(result.longest).toBeGreaterThan(mobile ? 9 : 18)
            expect(result.longest).toBeLessThanOrEqual(mobile ? 13.01 : 28.01)
            expect(result.colors.sort()).toEqual(["transparent", result.sea, result.land].sort())
            await page.evaluate(() => { const s=(window as EffectProbe).effects; s.lengths.length=0; s.echoes=0 })
            await page.emulateMedia({reducedMotion:"reduce"})
            await expect.poll(edge).toBe("none")
            const still = await page.evaluate(() => {
                const p=window as EffectProbe
                for(let i=0;i<10;i++) p.advanceEffects(14000+i*80)
                return [p.effects.lengths.length,p.effects.echoes]
            })
            expect(still).toEqual([0,0])
        } finally { await context.close() }
    })
}
