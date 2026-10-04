import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { SWRConfig } from "swr"
import { TerminalCommandsPanel } from "../components/terminal-commands"
import { terminalCommandError } from "../lib/terminal-commands"

const mocks = vi.hoisted(() => ({ fetcher: vi.fn(), owner: 7 }))
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { id: mocks.owner } }) }))
vi.mock("@/api/api", () => ({ fetcher: mocks.fetcher, FetcherMethod: { GET: "GET", POST: "POST", PUT: "PUT", DELETE: "DELETE" } }))
let rows = [{ id: 1, name: "出口命令", command: "curl ip.sb", version: 1 }]
beforeEach(() => {
    rows = [{ id: 1, name: "出口命令", command: "curl ip.sb", version: 1 }]
    mocks.owner = 7
    mocks.fetcher.mockReset()
    mocks.fetcher.mockImplementation(async (method: string, _url: string, form?: any) => {
        if (method === "GET") return [...rows]
        if (method === "DELETE") { rows = []; return null }
        const saved = { id: method === "POST" ? 2 : 1, ...form, version: method === "POST" ? 1 : 2 }
        rows = method === "POST" ? [...rows, saved] : [saved]
        return saved
    })
    vi.stubGlobal("innerWidth", 1280)
})
afterEach(() => vi.unstubAllGlobals())
function mount(connected = true) {
    const onExecute = vi.fn(() => true), onClose = vi.fn()
    const result = render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
        <TerminalCommandsPanel open connected={connected} onClose={onClose} onExecute={onExecute} />
    </SWRConfig>)
    return { ...result, onExecute, onClose }
}
test("selection never sends; explicit execution sends once and guards double click", async () => {
    const { onExecute } = mount()
    fireEvent.click(await screen.findByRole("button", { name: "选择命令：出口命令" }))
    expect(onExecute).not.toHaveBeenCalled()
    const execute = screen.getByRole("button", { name: "执行" })
    fireEvent.click(execute)
    fireEvent.click(execute)
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(onExecute).toHaveBeenCalledWith("curl ip.sb")
})
test("create and edit persist without execution; delete needs confirmation", async () => {
    const { onExecute } = mount()
    await screen.findByRole("button", { name: "选择命令：出口命令" })
    fireEvent.click(screen.getByRole("button", { name: "新建" }))
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "磁盘" } })
    fireEvent.change(screen.getByLabelText("命令内容"), { target: { value: "df -h" } })
    fireEvent.click(screen.getByRole("button", { name: "保存命令" }))
    await screen.findByRole("button", { name: "选择命令：磁盘" })
    expect(onExecute).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "编辑命令：出口命令" }))
    fireEvent.change(screen.getByLabelText("命令内容"), { target: { value: "printf ok" } })
    fireEvent.click(screen.getByRole("button", { name: "保存命令" }))
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull())
    expect(mocks.fetcher).toHaveBeenCalledWith("PUT", "/api/v1/terminal-commands/1", expect.objectContaining({ version: 1, command: "printf ok" }))
    fireEvent.click(screen.getByRole("button", { name: "删除" }))
    expect(mocks.fetcher.mock.calls.some(call => call[0] === "DELETE")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
    await screen.findByText("还没有快捷命令")
    expect(onExecute).not.toHaveBeenCalled()
})
test("disconnected terminals can select/edit but cannot execute", async () => {
    const { onExecute } = mount(false)
    fireEvent.click(await screen.findByRole("button", { name: "选择命令：出口命令" }))
    expect((screen.getByRole("button", { name: "执行" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "编辑命令：出口命令" }))
    expect((screen.getByLabelText("命令内容") as HTMLTextAreaElement).value).toBe("curl ip.sb")
    expect(onExecute).not.toHaveBeenCalled()
})
test("mobile opens as a focus-contained dialog and closes after explicit execution", async () => {
    vi.stubGlobal("innerWidth", 390)
    const { onClose, onExecute } = mount()
    expect(screen.getByRole("dialog", { name: "快捷命令" }).getAttribute("aria-modal")).toBe("true")
    fireEvent.click(await screen.findByRole("button", { name: "选择命令：出口命令" }))
    fireEvent.click(screen.getByRole("button", { name: "执行" }))
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
})
test("failed save retains the draft and displays server error", async () => {
    mount()
    await screen.findByRole("button", { name: "选择命令：出口命令" })
    fireEvent.click(screen.getByRole("button", { name: "编辑命令：出口命令" }))
    fireEvent.change(screen.getByLabelText("命令内容"), { target: { value: "df -h" } })
    mocks.fetcher.mockRejectedValueOnce(new Error("命令已被修改，请刷新列表"))
    fireEvent.click(screen.getByRole("button", { name: "保存命令" }))
    await screen.findByRole("alert")
    expect((screen.getByLabelText("命令内容") as HTMLTextAreaElement).value).toBe("df -h")
})
test("commands reject control sequences, newlines, and oversized UTF8 text", () => {
    for (const value of ["", "a\n", "a\r", "a\t", "a\x1b", "中".repeat(3000)]) expect(terminalCommandError(value)).toBeTruthy()
    expect(terminalCommandError("curl ip.sb")).toBeFalsy()
})

test("closing and reopening preserves selection and an unsaved command draft", async () => {
    const onClose = vi.fn(), onExecute = vi.fn()
    const cache = new Map()
    const config = { provider: () => cache, dedupingInterval: 0 }
    const panel = (open: boolean) => <SWRConfig value={config}>
        <TerminalCommandsPanel open={open} connected onClose={onClose} onExecute={onExecute} />
    </SWRConfig>
    const { rerender } = render(panel(true))
    fireEvent.click(await screen.findByRole("button", { name: "选择命令：出口命令" }))
    fireEvent.click(screen.getByRole("button", { name: "编辑命令：出口命令" }))
    fireEvent.change(screen.getByLabelText("命令内容"), { target: { value: "printf draft" } })
    fireEvent.click(screen.getByRole("button", { name: "收起快捷命令栏" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(panel(false))
    expect(screen.queryByLabelText("命令内容")).toBeNull()
    rerender(panel(true))
    expect((screen.getByLabelText("命令内容") as HTMLTextAreaElement).value).toBe("printf draft")
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(screen.getByRole("button", { name: "选择命令：出口命令" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.queryByText("已选中：出口命令")).not.toBeNull()
    expect(onExecute).not.toHaveBeenCalled()
    expect(mocks.fetcher.mock.calls.every(call => call[0] === "GET")).toBe(true)
})

test("mobile sheet follows the visual viewport and preserves editor draft through keyboard and rotation", async () => {
    vi.stubGlobal("innerWidth", 390)
    vi.stubGlobal("innerHeight", 844)
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 })
    vi.stubGlobal("visualViewport", viewport)
    const remove = vi.spyOn(viewport, "removeEventListener")
    const { unmount } = mount()
    const sheet = screen.getByRole("dialog", { name: "快捷命令" })
    expect(sheet.getAttribute("data-mode")).toBe("library")
    expect(sheet.style.getPropertyValue("--tc-bottom")).toBe("0px")
    fireEvent.click(await screen.findByRole("button", { name: "编辑命令：出口命令" }))
    const command = screen.getByLabelText("命令内容") as HTMLTextAreaElement
    expect(command.rows).toBe(3)
    fireEvent.change(command, { target: { value: "printf draft" } })
    viewport.height = 300
    viewport.offsetTop = 70
    act(() => { viewport.dispatchEvent(new Event("resize")) })
    expect(sheet.getAttribute("data-mode")).toBe("editor")
    expect(sheet.hasAttribute("data-short-viewport")).toBe(true)
    expect(sheet.style.getPropertyValue("--tc-vh")).toBe("300px")
    expect(sheet.style.getPropertyValue("--tc-bottom")).toBe("474px")
    viewport.offsetTop = 100
    act(() => { viewport.dispatchEvent(new Event("scroll")) })
    expect(sheet.style.getPropertyValue("--tc-bottom")).toBe("444px")
    vi.stubGlobal("innerWidth", 1280)
    viewport.height = 844
    viewport.offsetTop = 0
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getByRole("complementary", { name: "快捷命令" }).hasAttribute("data-short-viewport")).toBe(false)
    expect(command.rows).toBe(5)
    expect(command.value).toBe("printf draft")
    unmount()
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function))
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function))
})

test("mobile sheet preserves close and delete-confirmation behavior for long command lists", async () => {
    vi.stubGlobal("innerWidth", 320)
    rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: "命令" + i, command: "printf " + i, version: 1 }))
    const { onClose, onExecute } = mount()
    fireEvent.click(await screen.findByRole("button", { name: "选择命令：命令29" }))
    expect(onExecute).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "删除" }))
    expect(mocks.fetcher.mock.calls.some(call => call[0] === "DELETE")).toBe(false)
    expect(screen.queryByRole("button", { name: "确认删除" })).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "取消删除" }))
    const execute = screen.getByRole("button", { name: "执行" })
    expect(execute.getAttribute("aria-describedby")).toBe("tc-execution-warning")
    expect(screen.getByText("执行会发送命令并回车。").id).toBe("tc-execution-warning")
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
})

test("compact sheet CSS is mobile-only, content-sized, scrollable and retains touch targets", async () => {
    const { readFileSync } = await import("node:fs")
    const css = readFileSync("src/components/terminal-commands.css", "utf8")
    const mobile = css.slice(css.indexOf("@media (max-width: 1023px)"))
    expect(mobile).toContain("height: auto")
    expect(mobile).toContain("var(--tc-vh, 100dvh) * .66")
    expect(mobile).toContain("width: min(520px, calc(100% - 16px))")
    expect(mobile).toContain(".tc-list { flex: 0 1 auto")
    expect(mobile).toContain("min-height: 44px")
    expect(css).toContain(".tc-list { min-height: 0; overflow: auto")
    expect(css).not.toContain("height: var(--tc-vh, 100dvh)")
    expect(css).toContain("flex: 0 0 clamp(270px, 24vw, 320px)")
})
