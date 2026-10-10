import {
    alertMetrics,
    alertSampleIntervalSeconds,
    alertWindowSamples,
    alertWindowSeconds,
    changeAlertMetric,
    cycleInputISO,
    cycleInputValue,
    defaultUnit,
    newAlertCondition,
    parseAlertRules,
    ruleSummary,
    selectedServerIDs,
    setSelectedServers,
    validateAlertRules,
} from "@/lib/alert-rule-editor"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("visual alert rules", () => {
    const originals = [
        {
            type: "offline",
            duration: 30,
            cover: 0,
            ignore: { "24": true, "25": true, "26": true, "48": true, "8": true },
        },
        {
            type: "tcp_conn_count",
            max: 2000,
            duration: 60,
            cover: 0,
            ignore: {
                "1": true,
                "24": true,
                "25": true,
                "26": true,
                "54": true,
                "73": true,
                "8": true,
            },
        },
        {
            type: "udp_conn_count",
            max: 300,
            duration: 60,
            cover: 0,
            ignore: { "1": true, "24": true, "25": true, "26": true, "8": true },
        },
        {
            type: "tcp_conn_count",
            max: 3000,
            duration: 60,
            cover: 0,
            ignore: {
                "1": true,
                "24": true,
                "25": true,
                "26": true,
                "54": true,
                "73": true,
                "8": true,
            },
        },
        {
            type: "transfer_all_cycle",
            max: 1099511627776,
            cycle_start: "2025-06-01T00:00:00+08:00",
            cycle_interval: 1,
            cycle_unit: "month",
            cover: 0,
        },
    ]
    it.each(originals)("preserves existing $type rule without migration", (original) => {
        const parsed = parseAlertRules(JSON.stringify([original]))
        expect(parsed.error).toBeUndefined()
        expect(parsed.rules).toEqual([original])
        expect(validateAlertRules(parsed.rules)).toBeUndefined()
        expect(ruleSummary(parsed.rules[0])).not.toContain("NaN")
    })
    it.each([
        "{",
        "{}",
        "[null]",
        '[{"type":"cpu","cover":0,"min":"x"}]',
        '[{"type":"cpu","cover":0,"ignore":{"1":1}}]',
    ])("rejects malformed raw rules: %s", (raw) => expect(parseAlertRules(raw).error).toBeTruthy())
    it("preserves extra JSON fields and explicit false server IDs", () => {
        const original = {
            type: "cpu",
            cover: 0,
            duration: 10,
            max: 80,
            ignore: { "1": false, "2": true },
            custom: { label: "keep" },
        }
        const parsed = parseAlertRules(JSON.stringify([original]))
        expect(parsed.rules[0]).toEqual(original)
        expect(selectedServerIDs(parsed.rules[0])).toEqual(["2"])
        const edited = setSelectedServers(parsed.rules[0], ["3"])
        expect(edited).toEqual({ ...original, ignore: { "1": false, "3": true } })
        expect(original.ignore).toEqual({ "1": false, "2": true })
    })
    it("validates backend duration and cycle boundaries", () => {
        for (const duration of [undefined, 0, 2, 3.1, 2147483648])
            expect(validateAlertRules([{ type: "offline", cover: 0, duration }])).toMatch(
                /检测窗口/,
            )
        expect(validateAlertRules([{ type: "offline", cover: 0, duration: 3 }])).toBeUndefined()
        expect(validateAlertRules([{ type: "unknown", cover: 0, duration: 10 }])).toBe("条件 1：不支持此监控指标，请重新选择或检查高级 JSON。")
        expect(validateAlertRules([])).toMatch(/至少/)
        expect(validateAlertRules([{ type: "cpu", cover: 2, duration: 10 }])).toMatch(/范围/)
        const cycle = newAlertCondition("transfer_all_cycle")
        expect(validateAlertRules([cycle])).toBeUndefined()
        expect(validateAlertRules([{ ...cycle, cycle_interval: 0 }])).toMatch(/周期数/)
        expect(validateAlertRules([{ ...cycle, cycle_start: "not a date" }])).toMatch(/有效/)
        expect(
            validateAlertRules([{ ...cycle, cycle_start: "2999-01-01T00:00:00+08:00" }]),
        ).toMatch(/晚于/)
    })
    it("uses exact binary units without rounding", () => {
        expect(defaultUnit({ type: "transfer_all_cycle", cover: 0, max: 1099511627776 })).toBe(
            1024 ** 4,
        )
        expect(defaultUnit({ type: "transfer_all", cover: 0, max: 1099511627777 })).toBe(1)
        expect(defaultUnit({ type: "net_in_speed", cover: 0, max: 12500000 })).toBe(125000)
    })
    it("shows strict thresholds, OR between bounds and 70 percent sampling", () => {
        expect(ruleSummary({ type: "cpu", cover: 0, min: 10, max: 80, duration: 60 })).toContain(
            "高于 80 % 或 低于 10 %",
        )
        expect(ruleSummary({ type: "cpu", cover: 0, max: 0, duration: 60 })).toContain(
            "未设置有效阈值",
        )
        expect(ruleSummary({ type: "cpu", cover: 1, duration: 60 })).toContain("异常采样 >70%")
        expect(ruleSummary({ type: "cpu", cover: 1, duration: 60 })).toContain("仅选中 0 台")
    })
    it("keeps Beijing calendar values regardless of browser timezone", () => {
        expect(cycleInputValue("2025-05-31T16:00:00Z")).toBe("2025-06-01T00:00:00")
        expect(cycleInputISO("2025-06-01T16:25")).toBe("2025-06-01T16:25:00+08:00")
        expect(cycleInputISO("2025-06-01T16:25:30")).toBe("2025-06-01T16:25:30+08:00")
        expect(cycleInputISO("")).toBeUndefined()
    })
    it("provides every supported backend metric", () => {
        expect(alertMetrics).toHaveLength(23)
        expect(newAlertCondition("offline")).not.toHaveProperty("max")
    })
})

describe("alert logic correction regressions", () => {
    it("locks UI conversion to the backend sampling cadence", () => {
        const backend = readFileSync("../../model/rule.go", "utf8")
        expect(backend).toContain(
            "const AlertSampleIntervalSeconds = " + alertSampleIntervalSeconds,
        )
        const old = { type: "offline", cover: 0, duration: 30 }
        expect(alertWindowSeconds(old)).toBe(90)
        expect(alertWindowSamples(90)).toBe(30)
        expect(alertWindowSamples(60)).toBe(20)
        expect(ruleSummary(old)).toContain("90 秒")
        expect(validateAlertRules([{ ...old, duration: alertWindowSamples(31) }])).toMatch(
            /3 秒的整数倍/,
        )
    })
    it("keeps same-unit thresholds, duration, scope and unknown fields when switching", () => {
        const old = {
            type: "tcp_conn_count",
            min: 100,
            max: 3000,
            duration: 60,
            cover: 1,
            ignore: { "7": true },
            extra: "keep",
        }
        expect(changeAlertMetric(old, "udp_conn_count")).toEqual({ ...old, type: "udp_conn_count" })
        expect(changeAlertMetric(old, old.type)).toBe(old)
        const changed = changeAlertMetric(old, "memory")
        expect(changed).toEqual({
            type: "memory",
            duration: 60,
            cover: 1,
            ignore: { "7": true },
            extra: "keep",
        })
        expect(old.max).toBe(3000)
    })
    it("preserves cycle settings between cycle directions", () => {
        const old = newAlertCondition("transfer_all_cycle")
        expect(changeAlertMetric(old, "transfer_in_cycle")).toMatchObject({
            ...old,
            type: "transfer_in_cycle",
        })
        const plain = changeAlertMetric(old, "transfer_all")
        expect(plain.max).toBe(old.max)
        expect(plain).not.toHaveProperty("cycle_start")
        const next = changeAlertMetric(
            { type: "cpu", cover: 0, duration: 60, max: 80 },
            "transfer_all_cycle",
        )
        expect(next.duration).toBe(60)
        expect(next).not.toHaveProperty("max")
        expect(next.cycle_interval).toBe(1)
    })
    it.each([
        [5000, 3000],
        [3000, 3000],
    ])("rejects active contradictory bounds %s/%s", (min, max) => {
        expect(
            validateAlertRules([{ type: "tcp_conn_count", cover: 0, duration: 60, min, max }]),
        ).toMatch(/下限必须小于/)
    })
    it.each([
        [100, 3000],
        [0, 3000],
        [100, 0],
        [0, 0],
    ])("allows compatible disabled and one-sided bounds %s/%s", (min, max) => {
        expect(
            validateAlertRules([{ type: "tcp_conn_count", cover: 0, duration: 60, min, max }]),
        ).toBeUndefined()
    })
})
