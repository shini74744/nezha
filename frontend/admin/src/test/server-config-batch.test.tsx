import { ServerConfigCardBatch } from "@/components/server-config-batch"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const setServerConfig = vi.fn()
vi.mock("@/api/server", () => ({
    setServerConfig: (...args: unknown[]) => setServerConfig(...args),
}))
vi.mock("sonner", () => ({ toast: vi.fn() }))
beforeEach(() => {
    setServerConfig.mockReset()
})
afterEach(cleanup)

const open = () => fireEvent.click(screen.getByRole("button", { name: "批量配置 Agent" }))
const choose = (label: string) =>
    fireEvent.click(screen.getByRole("checkbox", { name: "修改" + label }))
const review = () => fireEvent.click(screen.getByRole("button", { name: "检查改动" }))

test("empty selection never opens a form or sends a request", () => {
    render(<ServerConfigCardBatch sid={[]} />)
    open()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(setServerConfig).not.toHaveBeenCalled()
})

test("default is no changes; removing a choice removes it from the payload", async () => {
    setServerConfig.mockResolvedValue({ success: [7], failure: [], offline: [] })
    render(<ServerConfigCardBatch sid={[7]} />)
    open()
    expect((screen.getByRole("button", { name: "检查改动" }) as HTMLButtonElement).disabled).toBe(
        true,
    )
    choose("GPU 监控")
    choose("GPU 监控")
    choose("自动更新 Agent")
    review()
    fireEvent.click(screen.getByRole("button", { name: "确认下发" }))
    await waitFor(() => expect(setServerConfig).toHaveBeenCalledOnce())
    expect(setServerConfig.mock.calls[0][0]).toEqual({
        servers: [7],
        config: '{"disable_auto_update":false}',
    })
    await screen.findByText("已下发：1 台")
    expect(screen.getByText(/不代表配置已生效/)).toBeTruthy()
})

test("risky change requires acknowledgement and preserves selected targets", async () => {
    setServerConfig.mockResolvedValue({ success: [7], offline: [8] })
    const view = render(<ServerConfigCardBatch sid={[7, 8]} />)
    open()
    choose("允许远程终端与文件管理")
    fireEvent.click(screen.getByRole("switch", { name: "允许远程终端与文件管理" }))
    review()
    view.rerender(<ServerConfigCardBatch sid={[9]} />)
    const submit = screen.getByRole("button", { name: "确认下发" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(setServerConfig).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("checkbox", { name: "我已了解这些影响，确认修改" }))
    fireEvent.click(submit)
    await waitFor(() => expect(setServerConfig).toHaveBeenCalledOnce())
    expect(setServerConfig.mock.calls[0][0]).toEqual({
        servers: [7, 8],
        config: '{"disable_command_execute":true}',
    })
    await screen.findByText("节点离线：1 台")
})

test("invalid numeric input blocks review and displays help", () => {
    render(<ServerConfigCardBatch sid={[7]} />)
    open()
    choose("状态上报间隔")
    fireEvent.change(screen.getByRole("spinbutton", { name: "状态上报间隔" }), {
        target: { value: "9" },
    })
    expect(screen.getByRole("alert").textContent).toContain("1–4")
    expect((screen.getByRole("button", { name: "检查改动" }) as HTMLButtonElement).disabled).toBe(
        true,
    )
    choose("状态上报间隔")
    expect(screen.queryByRole("alert")).toBeNull()
})

test("search preserves choices and closing resets the draft", () => {
    render(<ServerConfigCardBatch sid={[7]} />)
    open()
    choose("GPU 监控")
    fireEvent.change(screen.getByRole("textbox", { name: "搜索配置项" }), {
        target: { value: "上报" },
    })
    expect(screen.queryByRole("checkbox", { name: "修改GPU 监控" })).toBeNull()
    review()
    expect(screen.getByText("GPU 监控")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    open()
    expect(screen.getByText("已选 0 项")).toBeTruthy()
})

test("double submit is guarded; pending close is prevented; failures preserve edits", async () => {
    let reject!: (error: Error) => void
    setServerConfig.mockImplementation(
        () =>
            new Promise((_, fail) => {
                reject = fail
            }),
    )
    render(<ServerConfigCardBatch sid={[7]} />)
    open()
    choose("温度监控")
    review()
    const button = screen.getByRole("button", { name: "确认下发" })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(setServerConfig).toHaveBeenCalledOnce()
    expect(screen.getByRole("dialog")).toBeTruthy()
    await act(async () => reject(new Error("network error")))
    expect(screen.getByRole("alert").textContent).toContain("本次配置已保留")
    expect(screen.getByText("温度监控")).toBeTruthy()
    expect((screen.getByRole("button", { name: "确认下发" }) as HTMLButtonElement).disabled).toBe(
        false,
    )
})
