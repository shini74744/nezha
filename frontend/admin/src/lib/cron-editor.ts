import type { ModelCron, ModelCronForm } from "@/types"

export type ScheduleMode = "interval" | "hourly" | "daily" | "weekly" | "monthly" | "advanced"
export interface ScheduleOptions {
    mode: ScheduleMode
    time: string
    minute: string
    days: number[]
    day: string
    every: string
    unit: "s" | "m" | "h"
}
export const scheduleDefaults: ScheduleOptions = {
    mode: "daily",
    time: "03:00",
    minute: "0",
    days: [1],
    day: "1",
    every: "30",
    unit: "m",
}
export const weekNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
export const scheduleModes: Record<ScheduleMode, string> = {
    interval: "固定间隔",
    hourly: "每小时",
    daily: "每天",
    weekly: "每周",
    monthly: "每月",
    advanced: "高级 Cron",
}

// Only decode exact supported shapes. Complex expressions/timezone prefixes
// remain untouched in advanced mode; opening a task never normalizes its data.
export function parseSchedule(value: string): ScheduleOptions {
    const options = { ...scheduleDefaults, days: [1] }
    const interval = /^@every ([1-9]\d*)([smh])$/.exec(value.trim())
    if (interval)
        return {
            ...options,
            mode: "interval",
            every: interval[1],
            unit: interval[2] as ScheduleOptions["unit"],
        }
    const parts = value.trim().split(/\s+/)
    const [second, minute, hour, dom, month, dow] = parts
    const integer = (v: string, min: number, max: number) =>
        /^\d+$/.test(v) && +v >= min && +v <= max
    if (parts.length === 6 && second === "0" && month === "*" && integer(minute, 0, 59)) {
        if (hour === "*" && dom === "*" && dow === "*")
            return { ...options, mode: "hourly", minute }
        if (integer(hour, 0, 23)) {
            options.time = hour.padStart(2, "0") + ":" + minute.padStart(2, "0")
            if (dom === "*" && dow === "*") return options
            if (
                dom === "*" &&
                /^\d(,\d)*$/.test(dow) &&
                dow.split(",").every((d) => integer(d, 0, 6))
            )
                return {
                    ...options,
                    mode: "weekly",
                    days: [...new Set(dow.split(",").map(Number))],
                }
            if (integer(dom, 1, 31) && dow === "*") return { ...options, mode: "monthly", day: dom }
        }
    }
    return { ...options, mode: "advanced" }
}

export function buildSchedule(options: ScheduleOptions): { value: string; error: string } {
    const { mode, time, minute, days, day, every, unit } = options
    const invalid = (error: string) => ({ value: "", error })
    if (mode === "interval") {
        if (!/^[1-9]\d*$/.test(every) || +every > 100000 || !["s", "m", "h"].includes(unit))
            return invalid("间隔请输入 1–100000 的整数。")
        return { value: "@every " + every + unit, error: "" }
    }
    if (mode === "hourly") {
        if (!/^\d+$/.test(minute) || +minute > 59) return invalid("分钟请输入 0–59。")
        return { value: "0 " + Number(minute) + " * * * *", error: "" }
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return invalid("请选择有效的执行时间。")
    const [hour, min] = time.split(":").map(Number)
    if (
        mode === "weekly" &&
        (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    )
        return invalid("请至少选择一个星期。")
    if (mode === "monthly" && (!/^\d+$/.test(day) || +day < 1 || +day > 31))
        return invalid("日期请输入 1–31。")
    if (mode === "advanced") return invalid("请填写高级 Cron 表达式。")
    return {
        value: `0 ${min} ${hour} ${mode === "monthly" ? Number(day) : "*"} * ${mode === "weekly" ? [...new Set(days)].sort().join(",") : "*"}`,
        error: "",
    }
}

export function scheduleSummary(value: string): string {
    const s = parseSchedule(value)
    switch (s.mode) {
        case "interval":
            return `每隔 ${s.every} ${{ s: "秒", m: "分钟", h: "小时" }[s.unit]}`
        case "hourly":
            return `每小时的第 ${Number(s.minute)} 分钟`
        case "daily":
            return `每天 ${s.time}`
        case "weekly":
            return `${s.days.map((d) => weekNames[d]).join("、")} ${s.time}`
        case "monthly":
            return `每月 ${Number(s.day)} 日 ${s.time}`
        default:
            return value.trim() ? "自定义 Cron 规则" : "未设置执行时间"
    }
}
export function cronDraft(data?: ModelCron): ModelCronForm {
    return {
        name: data?.name ?? "",
        task_type: data?.task_type ?? 0,
        scheduler: data?.scheduler ?? "0 0 3 * * *",
        command: data?.command ?? "",
        cover: data?.cover ?? 0,
        servers: [...(data?.servers ?? [])],
        notification_group_id: data?.notification_group_id ?? 0,
        push_successful: data?.push_successful ?? false,
    }
}
export function validateCronDraft(draft: ModelCronForm) {
    if (!draft.name.trim()) return "请填写任务名称。"
    if (![0, 1].includes(draft.task_type)) return "请选择有效的任务类型。"
    if (!draft.command?.trim()) return "请填写要执行的命令。"
    if (![0, 1, 2].includes(draft.cover)) return "请选择有效的执行范围。"
    if (draft.task_type === 0 && draft.cover === 2)
        return "定时任务不能使用触发服务器范围，请重新选择。"
    if (draft.cover === 0 && !draft.servers.length) return "请至少选择一台执行服务器。"
    if (draft.task_type === 0 && !draft.scheduler.trim()) return "请填写执行时间或 Cron 表达式。"
    return ""
}
export function coverageSummary(cover: number, count: number) {
    if (cover === 0) return `仅选中的 ${count} 台服务器`
    if (cover === 1)
        return count ? `可授权服务器，排除选中的 ${count} 台` : "全部可授权服务器（含以后新增的）"
    if (cover === 2) return "仅触发事件的服务器"
    return "未知执行范围"
}
export function cronLastResult(task: ModelCron) {
    if (!task.last_executed_at || task.last_executed_at.startsWith("0001-")) return "尚未执行"
    return task.last_result ? "最近成功" : "最近失败"
}
