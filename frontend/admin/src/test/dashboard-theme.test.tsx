import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { DASHBOARD_THEME_STORAGE_KEY, ThemeProvider, useTheme } from "../components/theme-provider"

let dark = false
let listeners: Set<() => void>
beforeEach(() => {
    localStorage.clear()
    dark = false
    listeners = new Set()
    vi.stubGlobal("matchMedia", () => ({
        get matches() { return dark },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Probe() {
    const { theme, setTheme } = useTheme()
    return <div><span data-testid="theme">{theme}</span>{(["light","dark","system"] as const).map(value =>
        <button key={value} onClick={() => setTheme(value)}>{value}</button>)}</div>
}
test("dashboard defaults are independent from both public theme choices", () => {
    localStorage.setItem("vite-ui-theme", "dark")
    localStorage.setItem("doraemon-ui-theme", "dark")
    const view = render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId("theme").textContent).toBe("system")
    expect(document.documentElement.classList.contains("light")).toBe(true)
    fireEvent.click(screen.getByText("light", {selector:"button"}))
    expect(localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY)).toBe("light")
    expect(localStorage.getItem("vite-ui-theme")).toBe("dark")
    expect(localStorage.getItem("doraemon-ui-theme")).toBe("dark")
    view.unmount()
    localStorage.setItem("vite-ui-theme", "system")
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId("theme").textContent).toBe("light")
})
test("system follows media changes, explicit modes do not; listener is cleaned up", () => {
    const view = render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => { dark = true; listeners.forEach(fn => fn()) })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    fireEvent.click(screen.getByText("light", {selector:"button"}))
    expect(listeners.size).toBe(0)
    expect(document.documentElement.classList.contains("light")).toBe(true)
    fireEvent.click(screen.getByText("system", {selector:"button"}))
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
})
test("invalid values fall back to system, not the public theme", () => {
    localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, "invalid value")
    localStorage.setItem("vite-ui-theme", "dark")
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId("theme").textContent).toBe("system")
})
test("unavailable browser storage does not prevent selecting a theme", () => {
    vi.spyOn(Storage.prototype,"getItem").mockImplementation(() => { throw Error("blocked") })
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(() => { throw Error("blocked") })
    render(<ThemeProvider><Probe /></ThemeProvider>)
    fireEvent.click(screen.getByText("dark", {selector:"button"}))
    expect(document.documentElement.classList.contains("dark")).toBe(true)
})
test.each(["light","dark","system"])("initial HTML paint uses the same independent key: %s", theme => {
    localStorage.setItem("vite-ui-theme", theme === "light" ? "dark" : "light")
    localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, theme)
    const html = readFileSync("index.html", "utf8")
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
    const applied: string[] = []
    runInNewContext(script, {
        localStorage,
        matchMedia: () => ({ matches: true }),
        document: { documentElement: { classList: { add: (v: string) => applied.push(v) } } },
    })
    expect(applied).toEqual([theme === "system" ? "dark" : theme])
})
