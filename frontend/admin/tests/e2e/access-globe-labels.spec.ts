import { expect, test } from "@playwright/test"

type Label = { name: string, x: number, y: number, width: number, alpha: number }
type Probe = Window & { names: Label[], step: (now: number) => void, motionChanged?: boolean }

for (const mobile of [false, true]) {
    test("geographic labels rotate clear of the form on " + (mobile ? "phone" : "desktop"), async ({ browser }) => {
        test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated access gate")
        const context = await browser.newContext({
            viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
            deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
            colorScheme: mobile ? "light" : "dark", reducedMotion: "no-preference",
        })
        try {
            const page = await context.newPage()
            await page.addInitScript(() => {
                const probe = window as Probe
                probe.names = []
                const queued = new Map<number, FrameRequestCallback>()
                let next = 0
                window.requestAnimationFrame = fn => { queued.set(++next, fn); return next }
                window.cancelAnimationFrame = id => { queued.delete(id) }
                probe.step = now => {
                    const work = [...queued.values()]
                    queued.clear()
                    for (const fn of work) fn(now)
                }
                const proto = CanvasRenderingContext2D.prototype
                const clear = proto.clearRect, text = proto.fillText
                proto.clearRect = function(x,y,w,h) {
                    if (this.canvas.matches(".gate-globe")) probe.names = []
                    clear.call(this,x,y,w,h)
                }
                proto.fillText = function(name,x,y,maxWidth) {
                    if (this.canvas.matches(".gate-globe")) {
                        probe.names.push({name,x,y,width:this.measureText(name).width,alpha:this.globalAlpha})
                    }
                    if (maxWidth === undefined) text.call(this,name,x,y)
                    else text.call(this,name,x,y,maxWidth)
                }
            })
            await page.goto("http://127.0.0.1:5179/dashboard/", {waitUntil:"domcontentloaded"})
            const result = await page.evaluate(() => {
                const probe = window as Probe
                const atlas = document.querySelector<HTMLTemplateElement>("#globe-data")!
                const places: {name:string,point:[number,number]}[] = JSON.parse(atlas.content.textContent!).labels
                const coords = new Map(places.map(p => [p.name,p.point]))
                const boxes = [".card",".map-legend"].map(s => document.querySelector(s)!.getBoundingClientRect())
                const rad = Math.PI / 180
                let moved = false, max = 0, violations = 0
                const first = new Map<string,number>()
                for (let frame=0; frame<=150; frame++) {
                    probe.step(1000 + frame*100)
                    const occupied = [...boxes]
                    for (const label of probe.names) {
                        const {name,x,y,width,alpha} = label
                        const box = new DOMRect(x-width/2,y-7,width,14)
                        const point = coords.get(name)
                        const lon = (137 + frame*.3)*rad
                        if (!point || Math.sin(18*rad)*Math.sin(point[1]*rad) +
                            Math.cos(18*rad)*Math.cos(point[1]*rad)*Math.cos(lon-point[0]*rad) <= 0) violations++
                        if (box.left<0 || box.top<0 || box.right>innerWidth || box.bottom>innerHeight ||
                            occupied.some(b => box.left<b.right && box.right>b.left && box.top<b.bottom && box.bottom>b.top)) violations++
                        occupied.push(box)
                        if (frame===0 && alpha>.3) first.set(name,x)
                        if (first.has(name) && Math.abs(first.get(name)!-x)>3) moved = true
                    }
                    max = Math.max(max,probe.names.length)
                }
                return { initial:[...first.keys()], max, moved, violations, count:places.length }
            })
            console.log("map labels", mobile ? "phone" : "desktop", JSON.stringify(result))
            expect(result.count).toBeGreaterThan(150)
            expect(result.initial.length).toBeGreaterThan(0)
            expect(result.max).toBeLessThanOrEqual(mobile ? 5 : 12)
            expect(result.moved).toBe(true)
            expect(result.violations).toBe(0)
            await page.evaluate(() => {
                matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", event => {
                    ;(window as Probe).motionChanged = event.matches
                }, {once:true})
            })
            await page.emulateMedia({reducedMotion:"reduce"})
            await expect.poll(() => page.evaluate(() => (window as Probe).motionChanged)).toBe(true)
            const still = await page.evaluate(() => {
                const probe=window as Probe
                const first=JSON.stringify(probe.names)
                probe.step(30000)
                probe.step(30100)
                return JSON.stringify(probe.names)===first && probe.names.length>0
            })
            expect(still).toBe(true)
        } finally { await context.close() }
    })
}
