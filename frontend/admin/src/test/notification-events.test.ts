import {
    availableEventFields,
    defaultEventConfig,
    defaultEventModule,
    eventGroups,
    eventKinds,
    eventPreview,
} from "@/lib/notification-events"
import { describe, expect, it } from "vitest"

describe("event notification modules", () => {
    it("groups every event exactly once with its corresponding state", () => {
        expect(eventGroups).toHaveLength(8)
        const kinds = eventGroups.flatMap((group) => group.kinds)
        expect(kinds.sort()).toEqual(eventKinds.map(([kind]) => kind).sort())
        expect(new Set(kinds).size).toBe(13)
        expect(eventGroups.find((group) => group.id === "server")?.kinds).toEqual([
            "offline",
            "online",
        ])
        expect(eventGroups.find((group) => group.id === "resource")?.kinds).toEqual([
            "alert",
            "alert_recovery",
        ])
        expect(eventGroups.find((group) => group.id === "ddns")?.kinds).toEqual([
            "ddns_success",
            "ddns_failure",
        ])
    })
    it("has independent configs and unambiguous online wording", () => {
        const cfg = defaultEventConfig()
        expect(Object.keys(cfg.modules)).toHaveLength(13)
        cfg.modules.online.title = "自定义上线"
        expect(cfg.modules.offline.title).toBe("🔴 服务器离线")
        const preview = eventPreview("online", defaultEventModule("online"), true)
        expect(preview).toContain("🟢 服务器上线")
        expect(preview).not.toContain("离线")
    })
    it("includes old and new IP only for IP change", () => {
        const preview = eventPreview("ip_change", defaultEventModule("ip_change"), true)
        expect(preview).toContain("旧 IP：192.0.2.**")
        expect(preview).toContain("新 IP：198.51.100.**")
        expect(availableEventFields("online").map(([key]) => key)).not.toContain("old_ip")
    })
    it("renders only selected contents without interpreting HTML", () => {
        const module = { ...defaultEventModule("online"), title: "<b>上线</b>", fields: ["time"] }
        const text = eventPreview("online", module, true)
        expect(text).toContain("<b>上线</b>")
        expect(text).not.toContain("服务器：")
        expect(text).not.toContain("IP：")
    })
    it("provides presets for every routed event", () => {
        for (const [kind] of eventKinds) {
            const text = eventPreview(kind, defaultEventModule(kind), true)
            expect(text).not.toContain("undefined")
            expect(text).not.toContain("#SERVER.")
        }
    })
})

it("IP history is selectable only for IP changes and defaults to newest IP first", () => {
    const module = defaultEventModule("ip_change")
    expect(module.fields).toEqual(["time", "server", "details", "new_ip", "old_ip", "ip_history"])
    expect(availableEventFields("offline").map(([key]) => key)).not.toContain("ip_history")
    const text = eventPreview("ip_change", module, true)
    expect(text).toContain("7. 192.0.2.")
    expect(text).not.toContain("8. 192.0.2.")
    expect(text.indexOf("新 IP：")).toBeLessThan(text.indexOf("旧 IP："))
    expect(text.indexOf("旧 IP：")).toBeLessThan(text.indexOf("历史 IP"))
})

it("offers TCP and UDP counts and displays rates in Mbps", () => {
    for (const kind of ["offline", "online", "ip_change", "alert"]) {
        expect(availableEventFields(kind).map(([key]) => key)).toEqual(
            expect.arrayContaining(["tcp", "udp"]),
        )
    }
    const text = eventPreview(
        "online",
        { ...defaultEventModule("online"), fields: ["network", "tcp", "udp"] },
        true,
    )
    expect(text).toContain("8.39 Mbps")
    expect(text).toContain("TCP 连接数：16")
    expect(text).toContain("UDP 连接数：4")
})
