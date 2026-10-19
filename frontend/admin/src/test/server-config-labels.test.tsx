import { ServerConfigCard } from "@/components/server-config"
import { singleAgentConfigLabels } from "@/lib/agent-config-fields"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    get: vi.fn(), set: vi.fn(), t: (key: string) => key,
}))
vi.mock("@/api/server", () => ({ getServerConfig: mocks.get, setServerConfig: mocks.set }))
vi.mock("react-i18next", async (importOriginal) => ({
    ...await importOriginal<typeof import("react-i18next")>(),
    useTranslation: () => ({ t: mocks.t }),
}))
vi.mock("sonner", () => ({ toast: vi.fn() }))
const baseline = {
    ip_report_period: 1800, report_delay: 3,
    hard_drive_partition_allowlist: [], nic_allowlist: {},
    disable_auto_update: false, disable_force_update: true,
    disable_command_execute: false, disable_nat: false, disable_send_query: false,
    gpu: false, temperature: false, skip_connection_count: true,
    skip_procs_count: false, debug: false,
}
beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(JSON.stringify(baseline))
    mocks.set.mockReset().mockResolvedValue({ success: [96] })
})
afterEach(cleanup)
async function open() {
    render(<ServerConfigCard sid={96} menuItem />)
    fireEvent.click(screen.getByRole("button", { name: "Config" }))
    await screen.findByLabelText("IP 更新间隔（秒）")
}
test("all single-node labels are Chinese with their original raw key as hover title", async () => {
    await open()
    for (const [key, label] of Object.entries(singleAgentConfigLabels)) {
        expect(screen.getByTitle(key).textContent).toBe(label)
        expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.getByRole("checkbox", { name: "禁用面板强制更新" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("checkbox", { name: "跳过网络连接数统计" }).getAttribute("aria-checked")).toBe("true")
    expect(mocks.set).not.toHaveBeenCalled()
})
test("clicking Chinese labels submits GPU and temperature true without inverting other flags", async () => {
    await open()
    fireEvent.click(screen.getByTitle("gpu"))
    fireEvent.click(screen.getByTitle("temperature"))
    expect(screen.getByRole("checkbox", { name: "GPU 监控" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("checkbox", { name: "温度监控" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(mocks.set).toHaveBeenCalledOnce())
    expect(mocks.set.mock.calls[0][0].servers).toEqual([96])
    expect(JSON.parse(mocks.set.mock.calls[0][0].config)).toMatchObject({
        ...baseline, gpu: true, temperature: true,
    })
})
test("closing without submission never writes settings", async () => {
    await open()
    fireEvent.click(screen.getByTitle("gpu"))
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    expect(mocks.set).not.toHaveBeenCalled()
})
