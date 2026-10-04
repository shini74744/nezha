import { FetcherMethod, fetcher } from "@/api/api"
import { GlobalDisplaySettings } from "@/components/global-display-settings"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

vi.mock("@/api/api", () => ({ fetcher: vi.fn(), FetcherMethod: { GET: "GET", PATCH: "PATCH" } }))
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))
beforeEach(() => vi.mocked(fetcher).mockReset())
afterEach(cleanup)
const switchButton = () => screen.getByRole("switch", { name: "统计显示拆分" })
test("reads existing state and saves only the explicit display option", async () => {
    vi.mocked(fetcher).mockResolvedValueOnce({
        statistics_split: true,
        detail_network_split: false,
    })
    render(<GlobalDisplaySettings />)
    await waitFor(() => expect(switchButton().getAttribute("aria-checked")).toBe("true"))
    expect((switchButton() as HTMLButtonElement).disabled).toBe(false)
    for (const value of [false, true]) {
        vi.mocked(fetcher).mockResolvedValueOnce({
            statistics_split: value,
            detail_network_split: false,
        })
        fireEvent.click(switchButton())
        await waitFor(() => expect(switchButton().getAttribute("aria-checked")).toBe(String(value)))
        expect(fetcher).toHaveBeenLastCalledWith(FetcherMethod.PATCH, "/api/v1/setting/display", {
            statistics_split: value,
        })
    }
})
test("read and save failures preserve state and can be retried", async () => {
    vi.mocked(fetcher).mockRejectedValueOnce(new Error("offline"))
    render(<GlobalDisplaySettings />)
    await screen.findByRole("alert")
    expect((switchButton() as HTMLButtonElement).disabled).toBe(true)
    vi.mocked(fetcher).mockResolvedValueOnce({
        statistics_split: true,
        detail_network_split: false,
    })
    fireEvent.click(screen.getByRole("button", { name: "重新读取全站设置" }))
    await waitFor(() => expect(switchButton().getAttribute("aria-checked")).toBe("true"))
    vi.mocked(fetcher).mockRejectedValueOnce(new Error("failed"))
    fireEvent.click(switchButton())
    await screen.findByText("保存失败，开关状态未更改，请重试。")
    expect(switchButton().getAttribute("aria-checked")).toBe("true")
    expect((switchButton() as HTMLButtonElement).disabled).toBe(false)
})
test("blocks interaction until loading or saving has completed", async () => {
    let complete!: (value: any) => void
    vi.mocked(fetcher).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                complete = resolve
            }),
    )
    render(<GlobalDisplaySettings />)
    expect((switchButton() as HTMLButtonElement).disabled).toBe(true)
    await act(async () => complete({ statistics_split: false, detail_network_split: false }))
    vi.mocked(fetcher).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                complete = resolve
            }),
    )
    fireEvent.click(switchButton())
    expect((switchButton() as HTMLButtonElement).disabled).toBe(true)
    expect(switchButton().getAttribute("aria-checked")).toBe("false")
    await act(async () => complete({ statistics_split: true, detail_network_split: false }))
    expect(switchButton().getAttribute("aria-checked")).toBe("true")
})
