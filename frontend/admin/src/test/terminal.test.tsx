import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const terminalMocks = vi.hoisted(() => ({
    instances: [] as Array<{
        options: { fontFamily: string; fontSize: number }
        write: ReturnType<typeof vi.fn>
        paste: ReturnType<typeof vi.fn>
        focus: ReturnType<typeof vi.fn>
        dataHandler?: (data: string) => void
        binaryHandler?: (data: string) => void
    }>,
}))

vi.mock("@/components/terminal-commands", () => ({
    TerminalCommandsPanel: ({ open, onClose, onExecute }: { open: boolean; onClose: () => void; onExecute: (value: string) => boolean }) => open
        ? <><button onClick={onClose}>收起快捷命令栏</button><button onClick={() => onExecute("printf ok")}>Test execute</button><button onClick={() => onExecute("ls\n")}>Test invalid</button></> : null,
}))
vi.mock("@/hooks/useTerminal", () => ({ default: () => ({ session_id: "test-session" }) }))
vi.mock("@/components/fm", () => ({ FMCard: () => <button>Files</button> }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: toastMock }))

vi.mock("@xterm/addon-fit", () => ({
    FitAddon: class {
        activate() {}
        dispose() {}
        fit() {}
    },
}))

vi.mock("@xterm/xterm", () => ({
    Terminal: class {
        cols = 80
        rows = 24
        element: HTMLElement | null = null
        write = vi.fn()
        focus = vi.fn()
        dataHandler?: (data: string) => void
        binaryHandler?: (data: string) => void
        paste = vi.fn((data: string) => this.dataHandler?.(data))

        constructor(public options: { fontFamily: string; fontSize: number }) {
            terminalMocks.instances.push(this)
        }

        loadAddon() {}
        open(container: HTMLElement) {
            this.element = document.createElement("div")
            container.appendChild(this.element)
        }
        dispose() {}
        onData(handler: (data: string) => void) {
            this.dataHandler = handler
            return { dispose() {} }
        }
        onBinary(handler: (data: string) => void) {
            this.binaryHandler = handler
            return { dispose() {} }
        }
    },
}))

class FakeWebSocket {
    static readonly OPEN = 1
    static instances: FakeWebSocket[] = []
    url: string
    binaryType = "arraybuffer"
    onopen: ((ev: Event) => unknown) | null = null
    onclose: ((ev: Event) => unknown) | null = null
    onerror: ((ev: Event) => unknown) | null = null
    onmessage: ((ev: MessageEvent) => unknown) | null = null
    readyState = 0
    closeCalls = 0
    send = vi.fn()

    constructor(url: string | URL) {
        this.url = url.toString()
        FakeWebSocket.instances.push(this)
    }

    open() {
        this.readyState = FakeWebSocket.OPEN
        this.onopen?.(new Event("open"))
    }

    close() {
        this.closeCalls += 1
        this.readyState = 3
    }
}

beforeEach(() => {
    FakeWebSocket.instances = []
    terminalMocks.instances = []
    toastMock.mockReset()
    ;(globalThis as { WebSocket: typeof WebSocket }).WebSocket =
        FakeWebSocket as unknown as typeof WebSocket
    vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn(() => 1),
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
})

afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

test("XtermComponent closes the previous WebSocket and recreates xterm when wsUrl changes", async () => {
    const { XtermComponent } = await import("../components/terminal")
    const noop = () => undefined

    const { rerender } = render(
        <XtermComponent wsUrl="/api/v1/ws/terminal/session-1" setClose={noop} />,
    )

    expect(FakeWebSocket.instances).toHaveLength(1)
    const firstSocket = FakeWebSocket.instances[0]
    expect(terminalMocks.instances).toHaveLength(1)

    rerender(<XtermComponent wsUrl="/api/v1/ws/terminal/session-2" setClose={noop} />)

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(firstSocket.closeCalls).toBeGreaterThanOrEqual(1)
    expect(terminalMocks.instances).toHaveLength(2)
})

test("mobile controls send text keys and preserve one-shot Ctrl across xterm paste", async () => {
    const { XtermComponent } = await import("../components/terminal")
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { readText: vi.fn().mockResolvedValue("first line\n第二行") },
    })
    render(<XtermComponent wsUrl="/api/v1/ws/terminal/mobile" setClose={() => undefined} />)
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())

    const control = screen.getByRole("button", { name: "Control modifier for next key" })
    fireEvent.click(control)
    fireEvent.click(screen.getByRole("button", { name: "Paste clipboard" }))

    const terminal = terminalMocks.instances[0]
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledWith("first line\n第二行"))
    expect(control.getAttribute("aria-pressed")).toBe("true")
    expect(socket.send).toHaveBeenCalledWith("first line\n第二行")

    fireEvent.click(screen.getByRole("button", { name: "Left arrow" }))
    expect(socket.send).toHaveBeenLastCalledWith("\x1b[1;5D")
    expect(control.getAttribute("aria-pressed")).toBe("false")
})

test("xterm output and binary input remain byte-safe without AttachAddon", async () => {
    const { XtermComponent } = await import("../components/terminal")
    render(<XtermComponent wsUrl="/api/v1/ws/terminal/bytes" setClose={() => undefined} />)
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    const terminal = terminalMocks.instances[0]

    const output = new window.Uint8Array(new window.ArrayBuffer(16))
    output.set(new TextEncoder().encode("stream 中文"))
    act(() => socket.onmessage?.({ data: output.buffer } as MessageEvent))
    expect(terminal.write).toHaveBeenCalledWith(expect.any(Uint8Array))

    terminal.binaryHandler?.("\x00\xff")
    const binaryCall = socket.send.mock.calls.find(([data]) => ArrayBuffer.isView(data))?.[0]
    expect(Array.from(binaryCall as Uint8Array)).toEqual([0, 0, 255])

    fireEvent.click(screen.getByRole("button", { name: "Escape" }))
    expect(socket.send).toHaveBeenLastCalledWith("\x1b")
})

test.each([ [1000, 16], [390, 13] ])("uses a fixed monospace font at width %i", async (width, size) => {
    const { XtermComponent } = await import("../components/terminal")
    vi.stubGlobal("innerWidth", width)
    const { unmount } = render(<XtermComponent wsUrl="/api/v1/ws/terminal/font" setClose={() => undefined} />)
    expect(terminalMocks.instances[0].options.fontFamily).toBe('ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace')
    expect(terminalMocks.instances[0].options.fontSize).toBe(size)
    unmount()
})

test("fits landscape and short windows without a forced 220/360px minimum", async () => {
    const { XtermComponent } = await import("../components/terminal")
    vi.stubGlobal("visualViewport", undefined)
    vi.stubGlobal("innerHeight", 390)
    let top = 144
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top } as DOMRect))
    const { container, unmount } = render(<XtermComponent wsUrl="/api/v1/ws/terminal/height" setClose={() => undefined} />)
    const shell = container.querySelector<HTMLElement>(".terminal-shell")!
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("238px")
    vi.stubGlobal("innerHeight", 300)
    fireEvent(window, new Event("resize"))
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("148px")
    vi.stubGlobal("innerHeight", 844)
    top = 128
    fireEvent(window, new Event("orientationchange"))
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("708px")
    top = 900
    fireEvent(window, new Event("resize"))
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("0px")
    unmount()
})

test("tracks the visual viewport and full screen, and removes listeners on unmount", async () => {
    const { XtermComponent } = await import("../components/terminal")
    const viewport = Object.assign(new EventTarget(), { height: 300, offsetTop: 0 })
    const remove = vi.spyOn(viewport, "removeEventListener")
    vi.stubGlobal("visualViewport", viewport)
    let top = 128
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top } as DOMRect))
    const { container, unmount } = render(<XtermComponent wsUrl="/api/v1/ws/terminal/keyboard" setClose={() => undefined} />)
    const shell = container.querySelector<HTMLElement>(".terminal-shell")!
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("164px")
    viewport.offsetTop = 50
    act(() => { viewport.dispatchEvent(new Event("scroll")) })
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("214px")
    viewport.height = 240
    act(() => { viewport.dispatchEvent(new Event("resize")) })
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("154px")
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null })
    const fullScreen = vi.spyOn(document, "fullscreenElement", "get").mockReturnValue(shell)
    top = 0
    fireEvent(document, new Event("fullscreenchange"))
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("240px")
    fullScreen.mockReturnValue(null)
    top = 128
    fireEvent(document, new Event("fullscreenchange"))
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("154px")
    unmount()
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function))
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function))
    viewport.height = 500
    act(() => { viewport.dispatchEvent(new Event("resize")) })
    expect(shell.style.getPropertyValue("--terminal-available-height")).toBe("154px")
})

test("dashboard font styling excludes terminal text and measuring elements but keeps page headings", async () => {
    const { DashboardAppearanceProvider } = await import("../components/dashboard-appearance")
    const { dashboardDefaults } = await import("../lib/dashboard-appearance")
    const config = dashboardDefaults()
    config.enabled = true
    for (const feature of Object.values(config.features)) feature.enabled = false
    config.features.font.enabled = true
    config.features.font.family = "MiSans"
    const { container } = render(
        <DashboardAppearanceProvider raw={JSON.stringify(config)}>
            <div id="root"><h1>Terminal</h1><div className="terminal-shell">
                <div className="xterm"><div className="xterm-rows"><span>iiiiWWWW</span></div>
                    <span className="xterm-char-measure-element">W</span>
                </div><button className="terminal-key">Ctrl</button>
            </div></div>
        </DashboardAppearanceProvider>,
    )
    const style = container.querySelector<HTMLStyleElement>("style[data-nz-dashboard-style]")!
    const rule = Array.from(style.sheet!.cssRules).find(rule =>
        rule instanceof CSSStyleRule && rule.style.getPropertyValue("font-family"),
    ) as CSSStyleRule
    expect(container.querySelector("h1")!.matches(rule.selectorText)).toBe(true)
    for (const element of container.querySelectorAll(".terminal-shell, .terminal-shell *")) {
        expect(element.matches(rule.selectorText)).toBe(false)
    }
})

test("terminal CSS uses available height on all widths and isolates text effects", async () => {
    const { readFileSync } = await import("node:fs")
    const css = readFileSync("src/index.css", "utf8")
    const shell = css.match(/\.terminal-shell \{([^}]+)\}/)![1]
    expect(shell).toContain("height: var(--terminal-available-height)")
    expect(shell).toContain("min-height: 0")
    expect(css).not.toMatch(/min-height: (220|360)px/)
    const screen = css.match(/\.terminal-screen \{([^}]+)\}/)![1]
    expect(screen).toContain("text-shadow: none")
    expect(screen).toContain("font-variant: normal")
})

test("quick commands paste then send Enter only on execute and clear one-shot Ctrl", async () => {
    vi.stubGlobal("innerWidth", 1280)
    const { XtermComponent } = await import("../components/terminal")
    render(<XtermComponent wsUrl="/api/v1/ws/terminal/commands" setClose={() => undefined} />)
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    socket.send.mockClear()
    expect(socket.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Control modifier for next key" }))
    fireEvent.click(screen.getByRole("button", { name: "Test execute" }))
    expect(socket.send.mock.calls).toEqual([["printf ok"], ["\r"]])
    expect(screen.getByRole("button", { name: "Control modifier for next key" }).getAttribute("aria-pressed")).toBe("false")
    socket.send.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Test invalid" }))
    expect(socket.send).not.toHaveBeenCalled()
    socket.close()
    fireEvent.click(screen.getByRole("button", { name: "Test execute" }))
    expect(socket.send).not.toHaveBeenCalled()
})

test.each([1280, 320])("page toggle remains available after closing commands at width %s without reconnecting SSH", async (width) => {
    vi.stubGlobal("innerWidth", width)
    const { TerminalPage } = await import("../components/terminal")
    const { MemoryRouter, Routes, Route } = await import("react-router-dom")
    const { container } = render(
        <MemoryRouter initialEntries={["/terminal/63"]}>
            <Routes><Route path="/terminal/:id" element={<TerminalPage />} /></Routes>
        </MemoryRouter>,
    )
    const header = container.querySelector("h1")!.parentElement!
    const topToggle = within(header).getByRole("button", { name: "快捷命令" })
    const bottomToggle = within(screen.getByRole("toolbar")).getByRole("button", { name: "快捷命令" })
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    socket.send.mockClear()
    expect(topToggle.getAttribute("aria-expanded")).toBe(String(width >= 1024))
    if (width < 1024) fireEvent.click(topToggle)
    for (let cycle = 0; cycle < 3; cycle++) {
        fireEvent.click(screen.getByRole("button", { name: "收起快捷命令栏" }))
        expect(topToggle.isConnected).toBe(true)
        expect((topToggle as HTMLButtonElement).disabled).toBe(false)
        expect(topToggle.getAttribute("aria-expanded")).toBe("false")
        expect(bottomToggle.getAttribute("aria-expanded")).toBe("false")
        fireEvent.click(topToggle)
        expect(screen.queryByRole("button", { name: "收起快捷命令栏" })).not.toBeNull()
        expect(topToggle.getAttribute("aria-expanded")).toBe("true")
        expect(bottomToggle.getAttribute("aria-expanded")).toBe("true")
    }
    fireEvent.click(bottomToggle)
    expect(topToggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(bottomToggle)
    expect(topToggle.getAttribute("aria-expanded")).toBe("true")
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(terminalMocks.instances).toHaveLength(1)
    expect(socket.closeCalls).toBe(0)
    expect(socket.send).not.toHaveBeenCalled()
    // Managing saved commands stays accessible even if the terminal is disconnected.
    act(() => { socket.readyState = 3; socket.onerror?.(new Event("error")) })
    fireEvent.click(screen.getByRole("button", { name: "收起快捷命令栏" }))
    fireEvent.click(topToggle)
    expect(screen.queryByRole("button", { name: "收起快捷命令栏" })).not.toBeNull()
})
