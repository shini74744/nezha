import { expect, test } from "@playwright/test"

type ReplayWindow = Window & {
    advanceGlobe: (time: number) => void
}

for (const mobile of [false, true]) {
    test("continuous globe rotation on " + (mobile ? "phone" : "desktop"), async ({ browser }) => {
        test.skip(!process.env.E2E_ACCESS_GATE, "requires isolated access gate")
        test.setTimeout(360_000)
        const context = await browser.newContext({
            viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
            deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
            colorScheme: mobile ? "light" : "dark", reducedMotion: "no-preference",
        })
        try {
            const page = await context.newPage()
            await page.addInitScript(() => {
                const queue = new Map<number, FrameRequestCallback>()
                let id = 0
                window.requestAnimationFrame = cb => { queue.set(++id, cb); return id }
                window.cancelAnimationFrame = key => { queue.delete(key) }
                ;(window as ReplayWindow).advanceGlobe = time => {
                    const callbacks = Array.from(queue.values())
                    queue.clear()
                    for (const callback of callbacks) callback(time)
                }
            })
            await page.goto("http://127.0.0.1:5179/dashboard/", { waitUntil: "domcontentloaded" })
            const result = await page.locator("canvas.gate-globe").evaluate(el => {
                const canvas = el as HTMLCanvasElement
                const sample = document.createElement("canvas")
                sample.width = 96
                sample.height = 72
                const ctx = sample.getContext("2d", { willReadFrequently: true })!
                ctx.imageSmoothingQuality = "high"
                const size = sample.width * sample.height
                let previous: Uint8ClampedArray | undefined
                let worst = 0, worstTick = 0, empty = 0, moving = 0
                // 120 seconds of animation at 100 ms per step, including the two
                // known horizon tangencies (182.9 and 251.6 degrees longitude).
                for (let tick = 0; tick <= 1200; tick++) {
                    ;(window as ReplayWindow).advanceGlobe(1000 + tick * 100)
                    ctx.clearRect(0, 0, sample.width, sample.height)
                    ctx.drawImage(canvas, 0, 0, sample.width, sample.height)
                    const current = ctx.getImageData(0, 0, sample.width, sample.height).data
                    if (current[4 * (36 * sample.width + 48) + 3] < 250) empty++
                    if (previous) {
                        let changed = 0
                        for (let i = 0; i < current.length; i += 4) {
                            const delta = Math.abs(current[i] - previous[i]) +
                                Math.abs(current[i + 1] - previous[i + 1]) +
                                Math.abs(current[i + 2] - previous[i + 2])
                            if (delta > 20) changed++
                        }
                        if (changed) moving++
                        if (changed / size > worst) {
                            worst = changed / size
                            worstTick = tick
                        }
                    }
                    previous = current
                }
                return { samples: 1201, empty, moving, worst, worstTick }
            })
            console.log("globe replay", mobile ? "phone" : "desktop", JSON.stringify(result))
            expect(result.empty).toBe(0)
            expect(result.moving).toBeGreaterThan(1180)
            expect(result.worst).toBeLessThan(0.10)
        } finally { await context.close() }
    })
}
