import {
    buildSchedule,
    coverageSummary,
    cronDraft,
    cronLastResult,
    parseSchedule,
    scheduleDefaults,
    scheduleSummary,
    validateCronDraft,
} from "@/lib/cron-editor"
import type { ModelCron } from "@/types"
import { expect, test } from "vitest"

test("all visual periods generate six-field cron or a genuine fixed interval", () => {
    for (const [change, expected] of [
        [{ mode: "daily", time: "04:25" }, "0 25 4 * * *"],
        [{ mode: "hourly", minute: "12" }, "0 12 * * * *"],
        [{ mode: "weekly", time: "03:00", days: [5, 1] }, "0 0 3 * * 1,5"],
        [{ mode: "monthly", day: "31" }, "0 0 3 31 * *"],
        [{ mode: "interval", every: "90", unit: "m" }, "@every 90m"],
    ] as const) {
        const result = buildSchedule({ ...scheduleDefaults, ...change } as any)
        expect(result).toEqual({ value: expected, error: "" })
        expect(buildSchedule(parseSchedule(expected)).value).toBe(expected)
    }
})
test("unsupported expressions are never silently converted", () => {
    for (const spec of [
        "CRON_TZ=UTC 0 0 3 * * *",
        "TZ=America/New_York 0 1 * * * *",
        "@weekly",
        "@every 1h30m",
        "30 0 3 * * *",
        "0 */7 * * * *",
        "0 0 3 1 * 1",
        "bad",
    ]) {
        expect(parseSchedule(spec).mode).toBe("advanced")
        expect(cronDraft({ scheduler: spec } as ModelCron).scheduler).toBe(spec)
    }
})
test("invalid partial schedule cannot fall back to previously valid schedule", () => {
    for (const change of [
        { time: "" },
        { time: "24:00" },
        { mode: "hourly", minute: "-1" },
        { mode: "hourly", minute: "60" },
        { mode: "weekly", days: [] },
        { mode: "monthly", day: "0" },
        { mode: "monthly", day: "32" },
        { mode: "interval", every: "0" },
    ]) {
        const result = buildSchedule({ ...scheduleDefaults, ...change } as any)
        expect(result.error).toBeTruthy()
        expect(result.value).toBe("")
    }
})
test("scope semantics, input validation and old data remain stable", () => {
    const original = {
        name: "旧任务",
        scheduler: " 0 00 03 * * * ",
        task_type: 1,
        command: "echo ok\necho done",
        cover: 1,
        servers: [2, 99],
        notification_group_id: 99,
        push_successful: true,
    } as ModelCron
    const draft = cronDraft(original)
    expect(draft).toEqual(original)
    draft.servers.push(3)
    expect(original.servers).toEqual([2, 99])
    expect(validateCronDraft({ ...draft, cover: 0, servers: [] })).toContain("至少")
    expect(validateCronDraft({ ...draft, task_type: 0, cover: 2 })).toContain("不能")
    expect(validateCronDraft({ ...draft, cover: 1, servers: [] })).toBe("")
    expect(validateCronDraft({ ...draft, cover: 2 })).toBe("")
    expect(coverageSummary(1, 2)).toContain("排除")
    expect(scheduleSummary("0 30 8 * * *")).toBe("每天 08:30")
    expect(
        cronLastResult({
            last_executed_at: "0001-01-01T00:00:00Z",
            last_result: false,
        } as ModelCron),
    ).toBe("尚未执行")
})
