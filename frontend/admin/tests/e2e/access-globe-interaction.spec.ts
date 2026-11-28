import { expect, test } from "@playwright/test"

test("the same longitude moves from daylight through twilight into night", async ({page}) => {
    test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated access gate")
    await page.emulateMedia({reducedMotion:"reduce"})
    await page.addInitScript(() => {
        const proto=CanvasRenderingContext2D.prototype, draw=proto.drawImage
        proto.drawImage=function(...args:any[]) {
            const src=args[0]
            if (this.canvas.matches(".gate-globe") && src instanceof HTMLCanvasElement && src.width===160 && src.height===160) {
                const pixels=src.getContext("2d")!.getImageData(80,80,1,1)
                ;(window as any).nightOpacity=pixels.data[3]
            }
            Reflect.apply(draw,this,args)
        }
    })
    const readings=[]
    // The initial camera faces 137 E. Near the equinox local solar noon is close to 03:00 UTC.
    for(const hour of ["03:00","09:05","15:00"]) {
        await page.clock.setFixedTime(new Date("2024-03-20T"+hour+":00Z"))
        await page.goto("http://127.0.0.1:5179/dashboard/", {waitUntil:"domcontentloaded"})
        readings.push(await page.evaluate(()=>(window as any).nightOpacity as number))
    }
    expect(readings[0]).toBe(0)
    expect(readings[1]).toBeGreaterThan(0)
    expect(readings[1]).toBeLessThan(readings[2])
    expect(readings[2]).toBeGreaterThan(75)
})

for (const mobile of [false, true]) {
    test("inspect a cable, drag and resume on " + (mobile ? "phone" : "desktop"), async ({browser}) => {
        test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated access gate")
        const context = await browser.newContext({
            viewport:mobile ? {width:390,height:844} : {width:1366,height:768},
            deviceScaleFactor:mobile ? 2 : 1, hasTouch:mobile, isMobile:mobile,
            colorScheme:mobile ? "light" : "dark", reducedMotion:"reduce",
        })
        try {
            const page = await context.newPage()
            await page.addInitScript(() => {
                const proto=CanvasRenderingContext2D.prototype
                const stroke=proto.stroke, text=proto.fillText, clear=proto.clearRect
                const probe=(window as any).probe={draws:0,highlights:0,positions:[] as string[]}
                proto.clearRect=function(...args) {
                    if(this.canvas.matches(".gate-globe")) { probe.draws++; probe.highlights=0;probe.positions=[] }
                    clear.apply(this,args)
                }
                proto.stroke=function(...args: any[]) {
                    if(this.canvas.matches(".gate-globe") && Math.abs(this.lineWidth-2.1)<.001) probe.highlights++
                    Reflect.apply(stroke,this,args)
                }
                proto.fillText=function(label,x,y) {
                    if(this.canvas.matches(".gate-globe")) probe.positions.push([label,x.toFixed(2),y.toFixed(2)].join("/"))
                    text.call(this,label,x,y)
                }
            })
            await page.goto("http://127.0.0.1:5179/dashboard/", {waitUntil:"domcontentloaded"})
            const menu=page.getByRole("combobox",{name:"选择光缆线路"})
            const card=page.locator("main.card")
            const note=page.locator(".route-note")
            const position=await card.boundingBox()
            await menu.selectOption("Southern Cross")
            await expect(note).toContainText("澳大利亚")
            await expect(note).toContainText("新西兰")
            await expect.poll(() => page.evaluate(()=>(window as any).probe.highlights)).toBe(1)
            await menu.selectOption("")
            await expect(note).toBeHidden()
            // Pick a point on a real, near-facing, exposed cable at the initial orientation.
            const hit=await page.evaluate(() => {
                const el=document.querySelector<HTMLTemplateElement>("#globe-data")!
                const routes=JSON.parse(el.content.textContent!).routes
                const w=innerWidth,h=innerHeight,R=w<620?Math.min(h*.47,Math.max(w*.54,h*.42)):Math.min(w*.47,h*.482)
                const rad=Math.PI/180, lat=18*rad
                const box=document.querySelector("main")!.getBoundingClientRect()
                for(const r of routes) for(const line of r.lines) for(const p of line) {
                    const d=(p[0]-137)*rad, phi=p[1]*rad
                    if(Math.sin(lat)*Math.sin(phi)+Math.cos(lat)*Math.cos(phi)*Math.cos(d)<.3) continue
                    const x=Math.round(w/2+R*Math.cos(phi)*Math.sin(d))
                    const y=Math.round(h/2-R*(Math.cos(lat)*Math.sin(phi)-Math.sin(lat)*Math.cos(phi)*Math.cos(d)))
                    if(x<30||x>w-30||y<55||y>h-75) continue
                    if(x>box.left-16&&x<box.right+16&&y>box.top-16&&y<box.bottom+16) continue
                    if(document.elementFromPoint(x,y)?.matches(".gate-globe")) return {x,y}
                }
                throw Error("no exposed cable")
            })
            if(mobile) await page.touchscreen.tap(hit.x,hit.y)
            else await page.mouse.move(hit.x,hit.y)
            await expect(note).toBeVisible()
            await expect.poll(() => page.evaluate(()=>(window as any).probe.highlights)).toBe(1)
            const empty={x:2,y:3}
            if(mobile) await page.touchscreen.tap(empty.x,empty.y)
            else await page.mouse.move(empty.x,empty.y)
            await expect(note).toBeHidden()
            const labels=()=>page.evaluate(()=>JSON.stringify((window as any).probe.positions))
            const original=await labels()
            const x=hit.x+ (hit.x<200 ? 80 : -80),y=hit.y+8
            if(mobile) {
                const cdp=await context.newCDPSession(page)
                await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[hit]})
                await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y}]})
                await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]})
            } else {
                await page.mouse.move(hit.x,hit.y)
                await page.mouse.down()
                await page.mouse.move(x,y,{steps:4})
                await page.mouse.up()
            }
            await expect.poll(labels).not.toBe(original)
            await expect(note).toBeHidden()
            const after=await labels()
            await page.emulateMedia({reducedMotion:"no-preference"})
            await page.waitForTimeout(520)
            expect(await labels()).toBe(after)
            await expect.poll(labels,{timeout:5500}).not.toBe(after)
            expect(await card.boundingBox()).toEqual(position)
            await expect(page.locator("#access-password")).toBeEditable()
        } finally { await context.close() }
    })
}
