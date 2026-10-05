import { expect, test } from "@playwright/test"
import fs from "node:fs"

import { createServer } from "../../../user/src/test/fixtures"

test.use({ ignoreHTTPSErrors: true })
const definitions = JSON.parse(
    fs.readFileSync(new URL("../../../user/src/appearance/manifest.json", import.meta.url), "utf8"),
)
const fontFile = process.env.E2E_SPEED_FONT_FILE
for (const width of [320, 390, 1366, 1920]) {
    for (const theme of ["light", "dark"]) {
        test("speed icon alignment " + width + " " + theme, async ({ page, baseURL }, testInfo) => {
            test.setTimeout(60000)
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
                if (fontFile && url.pathname === "/qa-speed-font.ttf")
                    return route.fulfill({
                        contentType: "font/ttf",
                        body: fs.readFileSync(fontFile),
                    })
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
            for (const scenario of [
                { name: "mbps", enabled: true, up: 705 / 8, down: 712 / 8, expected: "705Mbps" },
                // The reported case: scaled, bordered Gbps upload versus an unscaled idle download.
                { name: "gbps", enabled: true, up: 1.04 * 128, down: 0, expected: "1.04Gbps" },
                {
                    name: "plain",
                    enabled: false,
                    up: 705 / 8,
                    down: 712 / 8,
                    expected: "88.13 MiB/s",
                },
            ]) {
                config.features.speed.enabled = scenario.enabled
                servers[0].state.net_out_speed = scenario.up * 1048576
                servers[0].state.net_in_speed = scenario.down * 1048576
                await page.goto("/")
                const rates = page.locator(".nz-network-speed")
                await expect(rates).toHaveCount(2)
                await expect(rates.first()).toHaveText(scenario.expected)
                await expect(page.locator("html")).toHaveClass(new RegExp(theme))
                if (scenario.name === "gbps")
                    await expect(rates.first()).toHaveClass(/nz-overview-speed-5/)
                if (fontFile) {
                    await page.evaluate(async () => {
                        const face = new FontFace("QA Speed Font", "url(/qa-speed-font.ttf)", {
                            weight: "700",
                        })
                        document.fonts.add(await face.load())
                    })
                }
                await page.evaluate(() => document.fonts.ready)
                for (const font of [
                    "Inter",
                    "Arial",
                    "Georgia",
                    ...(fontFile ? ["QA Speed Font"] : []),
                ]) {
                    // Apply to both SVG and text, matching the real global custom-font rule.
                    await page.addStyleTag({
                        content:
                            ".nz-network-speed,.nz-network-speed *{font-family:" +
                            JSON.stringify(font) +
                            " !important}",
                    })
                    for (const rate of await rates.all()) {
                        await expect(rate).toHaveCSS("align-items", "center")
                        await expect(rate.locator("svg")).toHaveCSS("margin", "0px")
                        await expect(rate.locator("svg")).toHaveCSS("top", "auto")
                        const geometry = await rate.evaluate((el) => {
                            const badge = el.getBoundingClientRect()
                            const svg = el.querySelector("svg")!,
                                value = el.querySelector(".nz-rate-value")!
                            const icon = svg.getBoundingClientRect(),
                                text = value.getBoundingClientRect()
                            const center = (r: DOMRect) => r.top + r.height / 2
                            return {
                                iconToBadge: Math.abs(center(icon) - center(badge)),
                                iconToValue: Math.abs(center(icon) - center(text)),
                                // Check equal top/bottom space even when transform:scale(1.15) is active.
                                paddingDifference: Math.abs(
                                    icon.top - badge.top - (badge.bottom - icon.bottom),
                                ),
                                lineHeight: getComputedStyle(value).lineHeight,
                                svgHeight: getComputedStyle(svg).height,
                            }
                        })
                        expect(geometry.iconToBadge, font + " badge center").toBeLessThan(0.1)
                        expect(geometry.iconToValue, font + " value center").toBeLessThan(0.1)
                        expect(geometry.paddingDifference, font + " vertical spacing").toBeLessThan(
                            0.1,
                        )
                        expect(geometry.svgHeight).toBe(geometry.lineHeight)
                    }
                    if (width >= 640) {
                        const [up, down] = await rates.all(),
                            a = (await up.locator("svg").boundingBox())!,
                            b = (await down.locator("svg").boundingBox())!
                        expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(0.1)
                    }
                    expect(
                        await page.evaluate(() => document.documentElement.scrollWidth),
                    ).toBeLessThanOrEqual(width)
                }
                await page.screenshot({
                    path: testInfo.outputPath(scenario.name + ".png"),
                    fullPage: true,
                })
                if (width >= 1366) {
                    const box = (await rates.first().boundingBox())!
                    await page.screenshot({
                        path: testInfo.outputPath(scenario.name + "-detail.png"),
                        clip: { x: box.x - 9, y: box.y - 8, width: 110, height: 34 },
                    })
                }
            }
            expect(errors).toEqual([])
        })
    }
}
