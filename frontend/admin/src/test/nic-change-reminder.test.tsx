import { NICReminderProvider } from "@/components/nic-change-reminder"
import { ServerConfigCard } from "@/components/server-config"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    notices: vi.fn(),
    read: vi.fn(),
    t: (key: string) => key,
}))
vi.mock("@/api/server", () => ({
    getServerConfig: mocks.get,
    setServerConfig: mocks.set,
    getNICChangeReminders: mocks.notices,
    acknowledgeNICChange: mocks.read,
}))
vi.mock("react-i18next", async (original) => ({
    ...(await original<typeof import("react-i18next")>()),
    useTranslation: () => ({ t: mocks.t }),
}))
vi.mock("sonner", () => ({ toast: vi.fn() }))
let visible: (value: boolean) => void
let pending: Record<string, string>
beforeEach(() => {
    pending = { 96: "event-a" }
    mocks.get.mockReset().mockResolvedValue(
        JSON.stringify({
            nic_allowlist: null,
            report_delay: 3,
            ip_report_period: 1800,
            network_interfaces: {
                available: true,
                interfaces: [
                    {
                        name: "eth0",
                        kind: "physical",
                        state: "up",
                        monitored: true,
                        default_monitored: true,
                    },
                ],
            },
        }),
    )
    mocks.notices.mockReset().mockImplementation(async () => ({ ...pending }))
    mocks.read.mockReset().mockImplementation(async (_sid, id) => {
        if (pending[96] === id) delete pending[96]
        return true
    })
    mocks.set.mockReset()
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            constructor(callback: IntersectionObserverCallback) {
                visible = (value: boolean) =>
                    callback(
                        [
                            {
                                isIntersecting: value,
                                intersectionRatio: value ? 1 : 0,
                            } as IntersectionObserverEntry,
                        ],
                        this as any,
                    )
            }
            observe() {}
            disconnect() {}
        },
    )
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})
function mount(menuItem = false) {
    return render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <NICReminderProvider>
                <ServerConfigCard sid={96} menuItem={menuItem} />
            </NICReminderProvider>
        </SWRConfig>,
    )
}
async function open(menuItem = false) {
    mount(menuItem)
    const button = await screen.findByRole("button", {
        name: menuItem ? /Config/ : /网口变化待查看/,
    })
    fireEvent.click(button)
    await screen.findByText("原来选择的网口已变化，已恢复默认统计。")
}
test("reminder is acknowledged only when seen and disappears on next open", async () => {
    await open()
    expect(mocks.read).not.toHaveBeenCalled()
    await act(async () => visible(false))
    expect(mocks.read).not.toHaveBeenCalled()
    await act(async () => visible(true))
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(96, "event-a"))
    expect(screen.getByText("原来选择的网口已变化，已恢复默认统计。")).toBeTruthy()
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(document.querySelector("[data-nic-unread]")).toBeNull()
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Config" }))
    await screen.findByRole("group", { name: "监控网卡" })
    expect(screen.queryByText("原来选择的网口已变化，已恢复默认统计。")).toBeNull()
    expect(mocks.set).not.toHaveBeenCalled()
})
test("menu gear has the same one-time reminder", async () => {
    await open(true)
    expect(screen.getByLabelText("网口变化待查看")).toBeTruthy()
    await act(async () => visible(true))
    await waitFor(() => expect(screen.queryByLabelText("网口变化待查看")).toBeNull())
})
test("failed loading does not clear red dot", async () => {
    mocks.get.mockRejectedValue(new Error("offline"))
    mount()
    fireEvent.click(await screen.findByRole("button", { name: /网口变化待查看/ }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(mocks.read).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /网口变化待查看/ })).toBeTruthy()
})
test("failed acknowledgement keeps red dot for next viewing", async () => {
    mocks.read.mockRejectedValue(new Error("network unavailable"))
    await open()
    await act(async () => visible(true))
    expect(document.querySelector("[data-nic-unread]")).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    expect(mocks.read).toHaveBeenCalledTimes(1)
})
test("late acknowledgement cannot clear a newer event", async () => {
    await open()
    mocks.read.mockImplementation(async () => {
        pending = { 96: "event-b" }
        return false
    })
    await act(async () => visible(true))
    await waitFor(() => expect(document.querySelector("[data-nic-unread]")).toBeTruthy())
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    fireEvent.click(screen.getByRole("button", { name: /网口变化待查看/ }))
    await screen.findByText("原来选择的网口已变化，已恢复默认统计。")
    await act(async () => visible(true))
    expect(mocks.read).toHaveBeenLastCalledWith(96, "event-b")
})
test("closing before configuration arrives does not acknowledge", async () => {
    let resolve!: (value: string) => void
    mocks.get.mockReturnValue(
        new Promise<string>((r) => {
            resolve = r
        }),
    )
    mount()
    fireEvent.click(await screen.findByRole("button", { name: /网口变化待查看/ }))
    await screen.findByRole("dialog")
    fireEvent.keyDown(document, { key: "Escape" })
    await act(async () => resolve("{}"))
    expect(mocks.read).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
})
