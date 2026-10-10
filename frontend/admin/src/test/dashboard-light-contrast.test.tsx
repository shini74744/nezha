import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import { DashboardAppearanceProvider } from "../components/dashboard-appearance"
import { dashboardDefaults } from "../lib/dashboard-appearance"

afterEach(cleanup)
const light = "html[data-nz-dashboard]:not(.dark)"
function config() {
    const c = dashboardDefaults()
    c.enabled = true
    c.features.font.enabled = false
    c.features.effects.enabled = false
    return c
}
function styles(c = config()) {
    return render(
        <DashboardAppearanceProvider raw={JSON.stringify(c)}>
            <section className="dashboard-page-frame"><div className="dashboard-page-surface">服务器</div></section>
        </DashboardAppearanceProvider>,
    )
}
test("whole light page follows saved opacity while controls keep contrast", () => {
    const c = config(), before = JSON.stringify(c)
    const view = styles(c)
    const css = view.container.querySelector("style")!.textContent!
    expect(css).toContain(light + "{")
    expect(css).toContain("background-color:rgb(255 255 255 / 0.48)")
    expect(css).toContain("--background:0 0% 100% / 0.48")
    expect(css).toContain("height:auto;min-height:100vh;min-height:100dvh")
    expect(css).toContain("flex:1 0 auto;background-color:transparent")
    expect(css).not.toContain("background-color:rgb(255 255 255 / 0.64)")
    expect(css).toContain("--popover:0 0% 100% / 0.96")
    expect(css).toContain("--muted-foreground:0 0% 5%")
    expect(css).toContain("html[data-nz-dashboard].dark{--background:0 0% 5% / 0.58")
    expect(JSON.stringify(c)).toBe(before)
})
test.each(["disabled", "background-off", "empty-image"])("%s does not receive the light surface", mode => {
    const c = config()
    if (mode === "disabled") c.enabled = false
    if (mode === "background-off") c.features.background.enabled = false
    if (mode === "empty-image") c.features.background.image = ""
    const view = styles(c)
    expect(view.container.querySelector("style")?.textContent ?? "").not.toContain(light)
})
test("higher opacity is respected; disabling appearance keeps a readable solid surface", () => {
    const c = config()
    c.features.appearance.lightBackgroundOpacity = .98
    const view = styles(c)
    expect(view.container.querySelector("style")!.textContent).toContain("background-color:rgb(255 255 255 / 0.98)")
    c.features.appearance.enabled = false
    view.rerender(<DashboardAppearanceProvider raw={JSON.stringify(c)}><div /></DashboardAppearanceProvider>)
    const css = view.container.querySelector("style")!.textContent!
    expect(css).toContain("--background:0 0% 100% / 1")
    expect(css).toContain("background-color:rgb(255 255 255 / 1)")
    expect(css).toContain("backdrop-filter:none")
})
test("disabling beauty removes the safety layer and dashboard marker", () => {
    const c = config(), view = styles(c)
    expect(document.documentElement.getAttribute("data-nz-dashboard")).toBe("true")
    c.enabled = false
    view.rerender(<DashboardAppearanceProvider raw={JSON.stringify(c)}><div /></DashboardAppearanceProvider>)
    expect(view.container.querySelector("style")).toBeNull()
    expect(document.documentElement.hasAttribute("data-nz-dashboard")).toBe(false)
})
test("mobile fixed wallpaper has its own viewport layer; scroll backgrounds are preserved", () => {
    const c = config(), view = styles(c)
    expect(view.container.querySelector("style")!.textContent).toContain('body::before')
    c.features.background.attachment = "scroll"
    view.rerender(<DashboardAppearanceProvider raw={JSON.stringify(c)}><div /></DashboardAppearanceProvider>)
    expect(view.container.querySelector("style")!.textContent).not.toContain('body::before')
})

test.each([0, .1, .48, 1])("main background opacity %s is not silently clamped", value => {
    const c = config()
    c.features.appearance.lightBackgroundOpacity = value
    const view = styles(c)
    const css = view.container.querySelector("style")!.textContent!
    expect(css).toContain("background-color:rgb(255 255 255 / " + value + ")")
    expect(css).toContain("--background:0 0% 100% / " + value)
})
