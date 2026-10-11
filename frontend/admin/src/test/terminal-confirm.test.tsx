import { act, fireEvent, render, screen } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import { useTerminalConfirm } from "@/components/terminal-confirm"

test("duplicate requests cancel, route changes cancel, unmount never approves", async () => {
    let api: ReturnType<typeof useTerminalConfirm>
    function Harness({ scope }: { scope: string }) { api = useTerminalConfirm(scope); return api.dialog }
    const { rerender, unmount } = render(<Harness scope="server-1"/>)
    const options = { title: "结束会话？", description: "任务会结束", confirmLabel: "结束", kind: "end" as const }
    let first!: Promise<boolean>
    act(() => { first = api.confirm(options) })
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    await expect(api!.confirm(options)).resolves.toBe(false)
    rerender(<Harness scope="server-2"/>)
    await expect(first).resolves.toBe(false)
    expect(screen.queryByRole("alertdialog")).toBeNull()
    act(() => { first = api.confirm(options) })
    unmount()
    await expect(first).resolves.toBe(false)
})
test("only explicit acceptance resolves true once", async () => {
    const result = vi.fn()
    function Harness() {
        const { confirm, dialog } = useTerminalConfirm("same")
        return <><button onClick={() => void confirm({ title: "关闭保持？", description: "断开后结束", confirmLabel: "关闭保持", kind: "keep" }).then(result)}>打开</button>{dialog}</>
    }
    render(<Harness/>)
    fireEvent.click(screen.getByRole("button", { name: "打开" }))
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    await act(async () => {})
    expect(result).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole("button", { name: "打开" }))
    fireEvent.click(screen.getByRole("button", { name: "关闭保持" }))
    await act(async () => {})
    expect(result).toHaveBeenLastCalledWith(true)
    expect(result).toHaveBeenCalledTimes(2)
})
