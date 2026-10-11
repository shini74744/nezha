import { agentConfigFields, buildAgentConfigPatch } from "@/lib/agent-config-fields"
import { describe, expect, it } from "vitest"

describe("visual Agent configuration payload", () => {
    it("does not send unselected or unknown fields", () => {
        expect(buildAgentConfigPatch({}).patch).toEqual({})
        expect(
            buildAgentConfigPatch({ server: "bad", client_secret: "bad", uuid: "bad", tls: false })
                .patch,
        ).toEqual({})
        expect(buildAgentConfigPatch({ temperature: true }).patch).toEqual({ temperature: true })
    })
    for (const field of agentConfigFields.filter((field) => field.kind === "boolean")) {
        it("maps both states correctly: " + field.key, () => {
            expect(buildAgentConfigPatch({ [field.key]: true }).patch[field.key]).toBe(
                !field.inverse,
            )
            expect(buildAgentConfigPatch({ [field.key]: false }).patch[field.key]).toBe(
                !!field.inverse,
            )
        })
    }
    it("validates bounds and rejects blank, fraction, NaN and overflow", () => {
        for (const raw of ["", " ", "0", "5", "1.2", "no", "Infinity"])
            expect(buildAgentConfigPatch({ report_delay: raw }).errors.report_delay).toBeTruthy()
        expect(
            buildAgentConfigPatch({
                report_delay: "1",
                ip_report_period: "30",
                self_update_period: "0",
            }).patch,
        ).toEqual({ report_delay: 1, ip_report_period: 30, self_update_period: 0 })
        expect(
            buildAgentConfigPatch({ ip_report_period: "29", self_update_period: "4294967296" })
                .errors,
        ).toHaveProperty("ip_report_period")
        expect(
            buildAgentConfigPatch({ self_update_period: "4294967296" }).errors.self_update_period,
        ).toBeTruthy()
    })
    it("turns multiline paths into arrays and permits explicit reset", () => {
        expect(
            buildAgentConfigPatch({ hard_drive_partition_allowlist: "/\r\n/data\n/data\n" }).patch,
        ).toEqual({ hard_drive_partition_allowlist: ["/", "/data"] })
        expect(buildAgentConfigPatch({ hard_drive_partition_allowlist: "" }).patch).toEqual({
            hard_drive_partition_allowlist: [],
        })
    })
    it("merges named NIC choices and uses null for an explicit map reset", () => {
        expect(
            buildAgentConfigPatch({
                nic_allowlist: [
                    { name: " eth0 ", enabled: true },
                    { name: "lo", enabled: false },
                ],
            }).patch,
        ).toEqual({ nic_allowlist: { eth0: true, lo: false } })
        expect(buildAgentConfigPatch({ nic_allowlist: [] }).patch).toEqual({ nic_allowlist: null })
        expect(
            buildAgentConfigPatch({
                nic_allowlist: [
                    { name: "eth0", enabled: true },
                    { name: "eth0", enabled: false },
                ],
            }).errors.nic_allowlist,
        ).toBeTruthy()
        expect(
            buildAgentConfigPatch({ nic_allowlist: [{ name: "", enabled: true }] }).errors
                .nic_allowlist,
        ).toBeTruthy()
    })
    it("rejects non-web IP lookup URLs and credential-bearing URLs", () => {
        for (const raw of ["bad", "ftp://example.com", "https://user:secret@example.com"])
            expect(buildAgentConfigPatch({ custom_ip_api: raw }).errors.custom_ip_api).toBeTruthy()
        expect(buildAgentConfigPatch({ custom_ip_api: "https://example.com/ip" }).patch).toEqual({
            custom_ip_api: ["https://example.com/ip"],
        })
    })
    it("shows a lockout warning only when remote command access is turned off", () => {
        expect(
            buildAgentConfigPatch({ disable_command_execute: false }).changes[0].warning,
        ).toContain("其他 SSH")
        expect(
            buildAgentConfigPatch({ disable_command_execute: true }).changes[0].warning,
        ).toBeUndefined()
    })
    it("warns about DNS changes and rejects a URL as DNS", () => {
        expect(buildAgentConfigPatch({ dns: "https://dns.example" }).errors.dns).toBeTruthy()
        expect(buildAgentConfigPatch({ dns: "" }).changes[0].warning).toBeTruthy()
    })
})
