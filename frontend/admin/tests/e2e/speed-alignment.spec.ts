import { expect, test } from "@playwright/test"
import fs from "node:fs"

import { createServer } from "../../../user/src/test/fixtures"

test.use({ ignoreHTTPSErrors: true })
const definitions = JSON.parse(
    fs.readFileSync(new URL("../../../user/src/appearance/manifest.json", import.meta.url), "utf8"),
)
for (const width of [320, 390, 1366, 1920]) {
    for (const theme of ["light", "dark"]) {
        test("speed icon alignment " + width + " " + theme, async ({ page, baseURL }, testInfo) => {
            expect(baseURL).toBe("https://127.0.0.1:18476")
            const config = {
                version: 1,
                enabled: true,
                features: Object.fromEntries(
                    definitions.map((d: any) => [
                        d.key,
                        { ...d.defaults, enabled: d.key === "speed" },
                    ]),
                ),
            }
            const errors: string[] = []
            page.on("pageerror", (e) => errors.push(e.message))
            const now = Date.now()
            const servers = [
                createServer({
                    id: 11,
                    name: "对齐测试节点",
                    last_active: new Date(now).toISOString(),
                    state: {
                        net_out_speed: (705 / 8) * 1048576,
                        net_in_speed: (712 / 8) * 1048576,
                    },
                }),
            ]
            await page.setViewportSize({ width, height: 900 })
            await page.addInitScript((value) => {
                for (const key of ["showMap", "showServices", "inline"])
                    localStorage.setItem(key, "0")
                localStorage.setItem("vite-ui-theme", value)
            }, theme)
            await page.routeWebSocket("**/api/v1/ws/server", (ws) =>
                ws.send(JSON.stringify({ now, online: 1, servers })),
            )
            await page.route("**/*", async (route) => {
                const url = new URL(route.request().url())
                if (url.pathname === "/api/v1/setting")
                    return route.fulfill({
                        json: {
                            success: true,
                            data: {
                                config: {
                                    language: "zh-CN",
                                    site_name: "网络显示校验",
                                    custom_code: "",
                                    appearance_config: JSON.stringify(config),
                                },
                            },
                        },
                    })
                if (url.pathname === "/api/v1/profile")
                    return route.fulfill({ json: { success: false } })
                if (url.pathname.includes("/service"))
                    return route.fulfill({
                        json: { success: true, data: { services: {}, cycle_transfer_stats: {} } },
                    })
                if (url.pathname.startsWith("/api/"))
                    return route.fulfill({ json: { success: true, data: [] } })
                if (url.origin !== baseURL) return route.abort()
                return route.continue()
            })
            for (const enabled of [true, false]) {
                config.features.speed.enabled = enabled
                await page.goto("/")
                const rates = page.locator(".nz-network-speed")
                await expect(rates).toHaveCount(2)
                await expect(rates.first()).toHaveText(enabled ? "705Mbps" : "88.13 MiB/s")
                await expect(page.locator("html")).toHaveClass(new RegExp(theme))
                await page.evaluate(() => document.fonts.ready)
                for (const font of ["Inter", "Arial", "Georgia"]) {
                    await rates.evaluateAll(
                        (elements, family) =>
                            elements.forEach(
                                (el) => ((el as HTMLElement).style.fontFamily = family),
                            ),
                        font,
                    )
                    for (const rate of await rates.all()) {
                        await expect(rate).toHaveCSS("align-items", "baseline")
                        await expect(rate.locator("svg")).toHaveCSS("margin", "0px")
                        const geometry = await rate.evaluate((el) => {
                            const icon = el.querySelector("svg")!.getBoundingClientRect()
                            const value = el.querySelector(".nz-rate-value")!
                            const box = value.getBoundingClientRect(),
                                style = getComputedStyle(value)
                            const ctx = document.createElement("canvas").getContext("2d")!
                            ctx.font = style.font
                            const digit = ctx.measureText("705")
                            const baseline =
                                box.top +
                                (box.height -
                                    digit.fontBoundingBoxAscent -
                                    digit.fontBoundingBoxDescent) /
                                    2 +
                                digit.fontBoundingBoxAscent
                            return {
                                difference: Math.abs(
                                    icon.y +
                                        icon.height / 2 -
                                        (baseline - digit.actualBoundingBoxAscent / 2),
                                ),
                                iconHeight: icon.height,
                                fontSize: parseFloat(style.fontSize),
                            }
                        })
                        expect(geometry.difference, font + " optical digit alignment").toBeLessThan(
                            1.1,
                        )
                        expect(geometry.iconHeight).toBeCloseTo(geometry.fontSize, 1)
                    }
                    const [up, down] = await rates.all()
                    const upIcon = (await up.locator("svg").boundingBox())!,
                        downIcon = (await down.locator("svg").boundingBox())!
                    if (width >= 640) expect(Math.abs(upIcon.y - downIcon.y)).toBeLessThan(0.1)
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth),
                    ).toBeLessThanOrEqual(width)
                }
                await rates.evaluateAll((elements) =>
                    elements.forEach((el) =>
                        (el as HTMLElement).style.removeProperty("font-family"),
                    ),
                )
                await page.screenshot({
                    path: testInfo.outputPath(enabled ? "overview.png" : "plain.png"),
                    fullPage: true,
                })
                if (enabled && width >= 1366) {
                    const box = (await rates.first().boundingBox())!
                    await page.screenshot({
                        path: testInfo.outputPath("rate-detail.png"),
                        clip: { x: box.x - 10, y: box.y - 7, width: 208, height: 27 },
                    })
                }
            }
            expect(errors).toEqual([])
        })
    }
}
