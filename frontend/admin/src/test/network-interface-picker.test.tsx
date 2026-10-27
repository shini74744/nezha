import { ServerConfigCard } from "@/components/server-config"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), t: (key: string) => key }))
vi.mock("@/api/server", () => ({ getServerConfig: mocks.get, setServerConfig: mocks.set }))
vi.mock("react-i18next", async (original) => ({
    ...(await original<typeof import("react-i18next")>()),
    useTranslation: () => ({ t: mocks.t }),
}))
vi.mock("sonner", () => ({ toast: vi.fn() }))
const interfaces = [
    {
        name: "enp2s0f0",
        kind: "physical",
        state: "up",
        master: "br1204",
        speed_mbps: 1000,
        default_monitored: true,
        monitored: true,
    },
    { name: "enp2s0f1", kind: "physical", state: "up", default_monitored: true, monitored: true },
    { name: "br1204", kind: "bridge", state: "up", default_monitored: true, monitored: true },
    { name: "ppp0", kind: "ppp", state: "up", default_monitored: true, monitored: true },
    { name: "lo", kind: "loopback", state: "up", default_monitored: false, monitored: false },
]
const baseline = {
    ip_report_period: 1800,
    report_delay: 3,
    hard_drive_partition_allowlist: [],
    nic_allowlist: {},
    gpu: false,
    temperature: false,
    disable_force_update: true,
    network_interfaces: { available: true, interfaces },
}
beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(JSON.stringify(baseline))
    mocks.set.mockReset().mockResolvedValue({ success: [96] })
})
afterEach(cleanup)
async function open(config = baseline as any) {
    mocks.get.mockResolvedValue(JSON.stringify(config))
    render(<ServerConfigCard sid={96} menuItem />)
    fireEvent.click(screen.getByRole("button", { name: "Config" }))
    await screen.findByRole("group", { name: "监控网卡" })
}
async function submit() {
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    })
    await waitFor(() => expect(mocks.set).toHaveBeenCalledOnce())
    return JSON.parse(mocks.set.mock.calls[0][0].config)
}
function checkbox(name: string) {
    return screen.getByRole("checkbox", { name: "统计 " + name })
}

test("discovery shows existing default selection and opening never changes it", async () => {
    await open()
    expect(checkbox("enp2s0f0").getAttribute("aria-checked")).toBe("true")
    expect(checkbox("br1204").getAttribute("aria-checked")).toBe("true")
    expect(checkbox("lo").getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText("沿用默认统计规则")).toBeTruthy()
    expect(screen.getAllByText("物理网口")).toHaveLength(2)
    expect(screen.getByText(/可能重复计数/)).toBeTruthy()
    expect(mocks.set).not.toHaveBeenCalled()
    const payload = await submit()
    expect(payload.nic_allowlist).toEqual({})
    expect(payload.network_interfaces).toBeUndefined()
    expect(payload.nic_allowlist_raw).toBeUndefined()
})
test("two physical ports selected; deselected bridges are explicitly false for merge", async () => {
    await open({
        ...baseline,
        nic_allowlist: { enp2s0f0: true, enp2s0f1: true, br1204: true, ppp0: true, oldNic: true },
    })
    expect(screen.getByText("当前未检测到")).toBeTruthy()
    for (const name of ["br1204", "ppp0", "oldNic"]) fireEvent.click(checkbox(name))
    expect(screen.queryByText(/可能重复计数/)).toBeNull()
    const payload = await submit()
    expect(payload.nic_allowlist).toEqual({
        enp2s0f0: true,
        enp2s0f1: true,
        br1204: false,
        ppp0: false,
        lo: false,
        oldNic: false,
    })
    expect(payload.gpu).toBe(false)
    expect(payload.disable_force_update).toBe(true)
    expect(payload.report_delay).toBe(3)
    expect(mocks.set.mock.calls[0][0].servers).toEqual([96])
})
test("deselecting every item never silently restores automatic collection", async () => {
    await open()
    for (const row of interfaces.filter((row) => row.default_monitored))
        fireEvent.click(checkbox(row.name))
    expect(screen.getByText("已选择 0 个网卡")).toBeTruthy()
    const payload = await submit()
    expect(Object.keys(payload.nic_allowlist)).toHaveLength(5)
    expect(Object.values(payload.nic_allowlist).every((value) => value === false)).toBe(true)
})
test("restore defaults sends null to clear an existing Agent map", async () => {
    await open({ ...baseline, nic_allowlist: { enp2s0f0: true } })
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(checkbox("br1204").getAttribute("aria-checked")).toBe("true")
    const payload = await submit()
    expect(payload.nic_allowlist).toBeNull()
})
test("legacy Agent supports named checkbox entries without JSON and preserves other settings", async () => {
    await open({ ...baseline, network_interfaces: undefined, nic_allowlist: { eth0: true } })
    expect(screen.getByText(/当前 Agent 暂不支持/)).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "网卡名称" }), {
        target: { value: "Ethernet 2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "添加" }))
    const payload = await submit()
    expect(payload.nic_allowlist).toEqual({ eth0: true, "Ethernet 2": true })
})
test("failed enumeration retains explicit names and state", async () => {
    await open({
        ...baseline,
        network_interfaces: { available: false, interfaces: [] },
        nic_allowlist: { eth0: true, eth1: false },
    })
    expect(screen.getByText(/暂时无法读取网卡列表/)).toBeTruthy()
    expect(checkbox("eth0").getAttribute("aria-checked")).toBe("true")
    expect(checkbox("eth1").getAttribute("aria-checked")).toBe("false")
    const payload = await submit()
    expect(payload.nic_allowlist).toEqual({ eth0: true, eth1: false })
})
test("close discards changes and re-opening requests a fresh inventory", async () => {
    await open()
    fireEvent.click(checkbox("enp2s0f0"))
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    expect(mocks.set).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Config" }))
    await waitFor(() => expect(checkbox("enp2s0f0").getAttribute("aria-checked")).toBe("true"))
    expect(mocks.get).toHaveBeenCalledTimes(2)
})
test("late config response after close cannot overwrite the next open", async () => {
    let resolveOld!: (value: string) => void
    mocks.get.mockImplementationOnce(
        () =>
            new Promise<string>((resolve) => {
                resolveOld = resolve
            }),
    )
    render(<ServerConfigCard sid={96} menuItem />)
    fireEvent.click(screen.getByRole("button", { name: "Config" }))
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    mocks.get.mockResolvedValue(JSON.stringify({ ...baseline, nic_allowlist: { enp2s0f1: true } }))
    fireEvent.click(screen.getByRole("button", { name: "Config" }))
    await screen.findByRole("checkbox", { name: "统计 enp2s0f1" })
    await act(async () => {
        resolveOld(JSON.stringify({ ...baseline, nic_allowlist: { enp2s0f0: true } }))
    })
    await waitFor(() => expect(checkbox("enp2s0f1").getAttribute("aria-checked")).toBe("true"))
    expect(checkbox("enp2s0f0").getAttribute("aria-checked")).toBe("false")
})
