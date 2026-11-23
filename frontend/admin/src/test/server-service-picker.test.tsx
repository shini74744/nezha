import { ServerServicePicker, reorderServerServices } from "@/components/server-service-picker"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock("@/api/server-services", () => ({ getServerServices: api.get, setServerServices: api.set }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const available = [
    { id: 1, name: "重庆电信", chart_color: "#123456", default_included: true },
    { id: 2, name: "上海移动", chart_color: "#abcdef", default_included: false },
]
beforeEach(() => {
    api.get.mockReset().mockResolvedValue({ services: [], available })
    api.set
        .mockReset()
        .mockImplementation((_id, services) => Promise.resolve({ services, available }))
})
afterEach(cleanup)
async function open(sid = 19) {
    const view = render(<ServerServicePicker sid={sid} />)
    fireEvent.click(screen.getByText(/服务选择/))
    await waitFor(() => expect(screen.getByLabelText("选择服务 重庆电信")).not.toBeNull())
    return view
}
it("inherits global colors, stores only explicit overrides and restores defaults", async () => {
    await open()
    fireEvent.click(screen.getByLabelText("选择服务 重庆电信"))
    expect((screen.getByLabelText("单机颜色 重庆电信") as HTMLInputElement).value).toBe("#123456")
    expect((screen.getByLabelText("单机颜色值 重庆电信") as HTMLInputElement).value).toBe("")
    fireEvent.click(screen.getByLabelText("选择服务 上海移动"))
    fireEvent.change(screen.getByLabelText("单机颜色 重庆电信"), { target: { value: "#778899" } })
    fireEvent.click(screen.getByLabelText("上移 上海移动"))
    fireEvent.click(screen.getByRole("button", { name: "保存服务设置" }))
    await waitFor(() =>
        expect(api.set).toHaveBeenCalledWith(19, [
            { service_id: 2 },
            { service_id: 1, color: "#778899" },
        ]),
    )
    await waitFor(() =>
        expect(
            (screen.getByRole("button", { name: "保存服务设置" }) as HTMLButtonElement).disabled,
        ).toBe(true),
    )
    fireEvent.click(screen.getByRole("button", { name: "恢复默认颜色" }))
    fireEvent.click(screen.getByRole("button", { name: "保存服务设置" }))
    await waitFor(() =>
        expect(api.set).toHaveBeenLastCalledWith(19, [{ service_id: 2 }, { service_id: 1 }]),
    )
    await waitFor(() =>
        expect(
            (screen.getByRole("button", { name: "保存服务设置" }) as HTMLButtonElement).disabled,
        ).toBe(true),
    )
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }))
    fireEvent.click(screen.getByRole("button", { name: "保存服务设置" }))
    await waitFor(() => expect(api.set).toHaveBeenLastCalledWith(19, []))
})
it("loads only on expansion and does not replace failed reads with writable defaults", async () => {
    api.get.mockRejectedValueOnce(new Error("offline"))
    render(<ServerServicePicker sid={19} />)
    expect(api.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/服务选择/))
    await screen.findByRole("button", { name: /暂时无法读取/ })
    expect(screen.queryByRole("button", { name: "保存服务设置" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /重试/ }))
    await screen.findByLabelText("选择服务 重庆电信")
})
it("rejects bad color without saving and keeps selection after search and failed save", async () => {
    api.set.mockRejectedValue(new Error("failed"))
    await open()
    fireEvent.click(screen.getByLabelText("选择服务 重庆电信"))
    fireEvent.change(screen.getByLabelText("单机颜色值 重庆电信"), { target: { value: "red" } })
    expect(
        (screen.getByRole("button", { name: "保存服务设置" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByLabelText("单机颜色值 重庆电信"), { target: { value: "#445566" } })
    fireEvent.change(screen.getByLabelText("搜索服务名称或 ID"), { target: { value: "上海" } })
    expect((screen.getByLabelText("单机颜色 重庆电信") as HTMLInputElement).value).toBe("#445566")
    fireEvent.click(screen.getByRole("button", { name: "保存服务设置" }))
    await waitFor(() => expect(api.set).toHaveBeenCalledOnce())
    await waitFor(() =>
        expect(
            (screen.getByRole("button", { name: "保存服务设置" }) as HTMLButtonElement).disabled,
        ).toBe(false),
    )
    expect((screen.getByLabelText("单机颜色 重庆电信") as HTMLInputElement).value).toBe("#445566")
})
it("ignores a delayed read from the previous server", async () => {
    let resolveOld!: (value: unknown) => void
    api.get.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
    const view = render(<ServerServicePicker sid={19} />)
    fireEvent.click(screen.getByText(/服务选择/))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(19))
    view.rerender(<ServerServicePicker sid={20} />)
    await screen.findByLabelText("选择服务 重庆电信")
    resolveOld({ services: [{ service_id: 1, color: "#ff0000" }], available })
    await waitFor(() =>
        expect(screen.getByLabelText("选择服务 重庆电信").getAttribute("aria-checked")).toBe(
            "false",
        ),
    )
})
it("reorders by ID without losing inherited and overridden colors", () => {
    const rows = [{ service_id: 1 }, { service_id: 2, color: "#123456" }, { service_id: 3 }]
    expect(reorderServerServices(rows, 3, 1, false)).toEqual([rows[2], rows[0], rows[1]])
    expect(reorderServerServices(rows, 1, 3, true)).toEqual([rows[1], rows[2], rows[0]])
    expect(reorderServerServices(rows, 4, 1, false)).toBe(rows)
})
