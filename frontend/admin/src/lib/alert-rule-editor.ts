import type { ModelRule } from "@/types"

import { formatBillingTime, parseBillingTime } from "../../../shared/billing-time"

export const alertMetrics = [
    ["offline", "服务器离线", ""],
    ["cpu", "CPU 使用率", "%"],
    ["gpu", "GPU 最高使用率", "%"],
    ["gpu_max", "GPU 最高使用率（旧版）", "%"],
    ["memory", "内存使用率", "%"],
    ["swap", "Swap 使用率", "%"],
    ["disk", "磁盘使用率", "%"],
    ["net_in_speed", "下载速度", "speed"],
    ["net_out_speed", "上传速度", "speed"],
    ["net_all_speed", "总网速（上传 + 下载）", "speed"],
    ["transfer_in", "累计下载流量", "bytes"],
    ["transfer_out", "累计上传流量", "bytes"],
    ["transfer_all", "累计双向流量", "bytes"],
    ["transfer_in_cycle", "周期下载流量", "bytes"],
    ["transfer_out_cycle", "周期上传流量", "bytes"],
    ["transfer_all_cycle", "周期双向流量", "bytes"],
    ["tcp_conn_count", "TCP 连接数", "个"],
    ["udp_conn_count", "UDP 连接数", "个"],
    ["process_count", "进程数", "个"],
    ["load1", "1 分钟负载", ""],
    ["load5", "5 分钟负载", ""],
    ["load15", "15 分钟负载", ""],
    ["temperature_max", "最高温度", "°C"],
] as const
// Must match model.AlertSampleIntervalSeconds; raw duration stays legacy sample count.
export const alertSampleIntervalSeconds = 3
export const alertWindowSeconds = (rule: ModelRule) =>
    rule.duration === undefined ? undefined : rule.duration * alertSampleIntervalSeconds
export const alertWindowSamples = (seconds: number) => seconds / alertSampleIntervalSeconds
export const cycleUnits = { hour: "小时", day: "天", week: "周", month: "月", year: "年" }
export const isCycleRule = (rule: ModelRule) => rule.type.endsWith("_cycle")
export const metricInfo = (type: string) => alertMetrics.find(([key]) => key === type)
export const selectedServerIDs = (rule: ModelRule) =>
    Object.keys(rule.ignore || {}).filter((id) => rule.ignore?.[id])
export function setSelectedServers(rule: ModelRule, ids: string[]): ModelRule {
    // Preserve explicit false entries, which are valid in existing rules.
    const ignore = { ...rule.ignore }
    for (const id of Object.keys(ignore)) if (ignore[id]) delete ignore[id]
    for (const id of ids) ignore[id] = true
    return { ...rule, ignore }
}
export function unitsFor(type: string): [string, number][] {
    const kind = metricInfo(type)?.[2]
    if (kind === "speed")
        return [
            ["B/s", 1],
            ["KiB/s", 1024],
            ["MiB/s", 1024 ** 2],
            ["Mbps", 125000],
            ["Gbps", 125000000],
        ]
    if (kind === "bytes")
        return [
            ["B", 1],
            ["KiB", 1024],
            ["MiB", 1024 ** 2],
            ["GiB", 1024 ** 3],
            ["TiB", 1024 ** 4],
        ]
    return [[kind || "数值", 1]]
}
export function defaultUnit(rule: ModelRule): number {
    const values = [rule.min, rule.max].filter((x): x is number => typeof x === "number" && x > 0)
    if (!values.length) return 1
    return (
        [...unitsFor(rule.type)]
            .reverse()
            .find(([, factor]) => values.every((x) => x >= factor && x % factor === 0))?.[1] || 1
    )
}
export function formatThreshold(value: number, type: string): string {
    const factor = defaultUnit({ type, cover: 0, max: value })
    const unit = unitsFor(type).find(([, n]) => n === factor)?.[0] || ""
    return `${value / factor} ${unit}`
}
export function ruleSummary(rule: ModelRule): string {
    const scope =
        rule.cover === 1
            ? `仅选中 ${selectedServerIDs(rule).length} 台服务器`
            : selectedServerIDs(rule).length
              ? `全部服务器，排除 ${selectedServerIDs(rule).length} 台`
              : "全部服务器"
    if (rule.type === "offline")
        return `连续离线采样 ${alertWindowSeconds(rule) ?? 0} 秒 · ${scope}`
    const thresholds =
        [
            rule.max && rule.max > 0 ? `高于 ${formatThreshold(rule.max, rule.type)}` : "",
            rule.min && rule.min > 0 ? `低于 ${formatThreshold(rule.min, rule.type)}` : "",
        ]
            .filter(Boolean)
            .join(" 或 ") || "未设置有效阈值"
    const timing = isCycleRule(rule)
        ? `每 ${rule.cycle_interval ?? 0} ${cycleUnits[(rule.cycle_unit?.toLowerCase() || "hour") as keyof typeof cycleUnits] || rule.cycle_unit}`
        : `${alertWindowSeconds(rule) ?? 0} 秒窗口，异常采样 >70%`
    return `${metricInfo(rule.type)?.[1] || rule.type} ${thresholds} · ${timing} · ${scope}`
}
export function parseAlertRules(raw: string): { rules: ModelRule[]; error?: string } {
    try {
        const rules = JSON.parse(raw)
        if (!Array.isArray(rules)) return { rules: [], error: "规则必须是 JSON 数组。" }
        if (
            rules.some(
                (r) =>
                    !r ||
                    typeof r !== "object" ||
                    Array.isArray(r) ||
                    typeof r.type !== "string" ||
                    typeof r.cover !== "number" ||
                    ["min", "max", "duration", "cycle_interval"].some(
                        (k) =>
                            r[k] !== undefined &&
                            (typeof r[k] !== "number" || !Number.isFinite(r[k])),
                    ) ||
                    (r.cycle_start !== undefined && typeof r.cycle_start !== "string") ||
                    (r.cycle_unit !== undefined && typeof r.cycle_unit !== "string") ||
                    (r.ignore !== undefined &&
                        (!r.ignore ||
                            Array.isArray(r.ignore) ||
                            typeof r.ignore !== "object" ||
                            Object.entries(r.ignore).some(
                                ([id, v]) => !/^[1-9]\d*$/.test(id) || typeof v !== "boolean",
                            ))),
            )
        )
            return { rules: [], error: "规则字段格式有误，请检查指标、数值和服务器范围。" }
        return { rules }
    } catch {
        return { rules: [], error: "JSON 格式有误，请修正后再保存或切换可视化编辑。" }
    }
}
export function validateAlertRules(rules: ModelRule[], now = Date.now()): string | undefined {
    if (!rules.length) return "请至少添加一个条件。"
    for (const [i, rule] of rules.entries()) {
        const prefix = `条件 ${i + 1}：`
        if (!metricInfo(rule.type)) return prefix + "不支持此监控指标，请重新选择或检查高级 JSON。"
        if (rule.cover !== 0 && rule.cover !== 1)
            return prefix + "服务器范围必须为全部或指定服务器。"
        if ((rule.min ?? 0) > 0 && (rule.max ?? 0) > 0 && rule.min! >= rule.max!)
            return prefix + "报警下限必须小于报警上限，避免任意数值都触发。"
        if (isCycleRule(rule)) {
            if (
                !Number.isInteger(rule.cycle_interval) ||
                rule.cycle_interval! < 1 ||
                rule.cycle_interval! > 306783378
            )
                return prefix + "周期数必须是 1～306783378 的整数。"
            if (
                !rule.cycle_start ||
                !/(Z|[+-]\d{2}:\d{2})$/i.test(rule.cycle_start) ||
                !Number.isFinite(parseBillingTime(rule.cycle_start)?.getTime())
            )
                return prefix + "请选择有效的周期开始时间。"
            if (parseBillingTime(rule.cycle_start)!.getTime() > now)
                return prefix + "周期开始时间不能晚于当前时间。"
        } else if (
            !Number.isInteger(rule.duration) ||
            rule.duration! < 3 ||
            rule.duration! > 2147483647
        )
            return prefix + "检测窗口须为 9～6442450941 秒，且是 3 秒的整数倍（每 3 秒采样一次）。"
    }
}
export const cycleInputValue = (value?: string) =>
    value ? formatBillingTime(value).replace(" ", "T") : ""
export function cycleInputISO(value: string): string | undefined {
    if (!value) return undefined
    return value.length === 16 ? value + ":00+08:00" : value + "+08:00"
}
export function newAlertCondition(type = "cpu"): ModelRule {
    const rule: ModelRule = { type, cover: 0, duration: 10 }
    if (type !== "offline")
        rule.max = type.includes("conn_count") ? 1000 : type.includes("transfer") ? 1024 ** 4 : 80
    if (isCycleRule(rule)) {
        delete rule.duration
        rule.cycle_interval = 1
        rule.cycle_unit = "month"
        const today = formatBillingTime(new Date().toISOString()).slice(0, 10)
        rule.cycle_start = today + "T00:00:00+08:00"
    }
    return rule
}

export function changeAlertMetric(rule: ModelRule, type: string): ModelRule {
    if (type === rule.type) return rule
    const sameUnit =
        rule.type !== "offline" &&
        type !== "offline" &&
        !!metricInfo(rule.type) &&
        metricInfo(rule.type)?.[2] === metricInfo(type)?.[2]
    const next: ModelRule = { ...rule, type, duration: rule.duration ?? 10 }
    if (!sameUnit) {
        delete next.min
        delete next.max
    }
    if (isCycleRule(next) && !isCycleRule(rule)) {
        const defaults = newAlertCondition(type)
        next.cycle_start = defaults.cycle_start
        next.cycle_interval = defaults.cycle_interval
        next.cycle_unit = defaults.cycle_unit
    } else if (!isCycleRule(next)) {
        delete next.cycle_start
        delete next.cycle_interval
        delete next.cycle_unit
    }
    return next
}
