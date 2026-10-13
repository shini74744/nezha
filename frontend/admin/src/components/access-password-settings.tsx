import { fetcher, FetcherMethod } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDown, ShieldCheck } from "lucide-react"
import { FormEvent, useId, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"

interface Schedule { enabled: boolean; start: string; end: string }
const defaultSchedule: Schedule = { enabled: false, start: "08:00", end: "23:00" }
const sameSchedule = (a: Schedule, b: Schedule) => a.enabled === b.enabled && a.start === b.start && a.end === b.end
const scheduleText = (enabled: boolean, schedule: Schedule) => !enabled ? "未启用" : !schedule.enabled ? "全天验证" : schedule.start + "–" + schedule.end + (schedule.end < schedule.start ? "（次日）" : "")

interface AccessSettings {
    frontend_password_schedule?: Schedule
    backend_password_schedule?: Schedule
    frontend_password_required: boolean
    backend_password_required: boolean
    backend_password_failures: number
    backend_password_ban_minutes: number
}
const endpoint = "/api/v1/setting/access-passwords"

export function AccessPasswordSettings() {
    const id = useId()
    const { data, error, mutate, isLoading } = useSWR<AccessSettings>(
        endpoint, (url: string) => fetcher(FetcherMethod.GET, url),
        { revalidateOnFocus: false },
    )
    const [expanded, setExpanded] = useState(false)
    const [frontSchedule, setFrontSchedule] = useState<Schedule | null>(null)
    const [backSchedule, setBackSchedule] = useState<Schedule | null>(null)
    const savedFrontSchedule = data?.frontend_password_schedule ?? defaultSchedule
    const savedBackSchedule = data?.backend_password_schedule ?? defaultSchedule
    const activeFrontSchedule = frontSchedule ?? savedFrontSchedule
    const activeBackSchedule = backSchedule ?? savedBackSchedule
    const [front, setFront] = useState("")
    const [frontConfirm, setFrontConfirm] = useState("")
    const [back, setBack] = useState("")
    const [backConfirm, setBackConfirm] = useState("")
    const [clearFront, setClearFront] = useState(false)
    const [clearBack, setClearBack] = useState(false)
    const [failures, setFailures] = useState<string | null>(null)
    const [minutes, setMinutes] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")
    const dirty = Boolean(front || back || frontConfirm || backConfirm || clearFront || clearBack ||
        !sameSchedule(activeFrontSchedule, savedFrontSchedule) || !sameSchedule(activeBackSchedule, savedBackSchedule) ||
        (failures !== null && failures !== String(data?.backend_password_failures)) ||
        (minutes !== null && minutes !== String(data?.backend_password_ban_minutes)))

    function resetDraft() {
        setFront(""); setFrontConfirm(""); setBack(""); setBackConfirm("")
        setClearFront(false); setClearBack(false); setFailures(null); setMinutes(null)
        setFrontSchedule(null); setBackSchedule(null); setMessage("")
    }
    function toggleExpanded() {
        if (expanded) resetDraft()
        setExpanded(value => !value)
    }
    async function save(event: FormEvent) {
        event.preventDefault()
        if (!data || busy || !dirty) return
        setMessage("")
        if (front !== frontConfirm || back !== backConfirm) {
            setMessage("两次输入的密码不一致，请检查后再保存。")
            return
        }
        if ([front, back].some(value => new TextEncoder().encode(value).length > 72)) {
            setMessage("密码最多 72 字节，请缩短后重试。")
            return
        }
        const count = Number(failures ?? data.backend_password_failures)
        const duration = Number(minutes ?? data.backend_password_ban_minutes)
        if (!Number.isInteger(count) || count < 1 || count > 100 ||
            !Number.isInteger(duration) || duration < 1 || duration > 10080) {
            setMessage("错误次数需为 1–100 次，封禁时长需为 1–10080 分钟。")
            return
        }
        if ([activeFrontSchedule, activeBackSchedule].some(s => !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) || s.start === s.end)) {
            setMessage("请选择不同的开始、结束时间；全天验证请关闭定时选项。")
            return
        }
        const patch: Record<string, string | number | boolean | Schedule> = {}
        if (!sameSchedule(activeFrontSchedule, savedFrontSchedule)) patch.frontend_password_schedule = activeFrontSchedule
        if (!sameSchedule(activeBackSchedule, savedBackSchedule)) patch.backend_password_schedule = activeBackSchedule
        if (front) patch.frontend_password = front
        if (back) patch.backend_password = back
        if (clearFront) patch.clear_frontend_password = true
        if (clearBack) patch.clear_backend_password = true
        if (count !== data.backend_password_failures) patch.backend_password_failures = count
        if (duration !== data.backend_password_ban_minutes) patch.backend_password_ban_minutes = duration
        setBusy(true)
        try {
            const saved = await fetcher<AccessSettings>(FetcherMethod.PATCH, endpoint, patch)
            await mutate(saved, false)
            resetDraft()
            toast.success("访问密码设置已保存")
        } catch (err) {
            setMessage(err instanceof Error ? err.message : "保存失败，请重试")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card className="w-full min-w-0" data-testid="access-password-settings">
            <CardHeader className="p-4 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-1">
                    <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 shrink-0" />访问密码</CardTitle>
                    <Button type="button" variant="ghost" size="sm" className="h-9 gap-1 px-2 text-xs" disabled={busy || !data}
                        aria-expanded={expanded} aria-controls={id + "-settings"} onClick={toggleExpanded}>
                        {expanded ? (dirty ? "取消修改" : "收起设置") : "展开设置"}
                        <ChevronDown className={"size-4 transition-transform " + (expanded ? "rotate-180" : "")} />
                    </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">全站设置 · 仅管理员可修改</p>
            </CardHeader>
            <CardContent className="p-4 pt-0">
                {isLoading && <p role="status" className="text-sm">正在读取设置…</p>}
                {error && !data && <div role="alert" className="space-y-2 text-sm"><p>读取失败，请重试。</p><Button type="button" variant="outline" onClick={() => mutate()}>重新读取</Button></div>}
                {data && !expanded && <div className="space-y-2 text-xs" aria-label="访问密码状态">
                    <div className="flex flex-wrap justify-between gap-1"><span>前台</span><span className="text-muted-foreground">{scheduleText(data.frontend_password_required, savedFrontSchedule)}</span></div>
                    <div className="flex flex-wrap justify-between gap-1"><span>后台</span><span className="text-muted-foreground">{scheduleText(data.backend_password_required, savedBackSchedule)}</span></div>
                    {(data.frontend_password_required && savedFrontSchedule.enabled || data.backend_password_required && savedBackSchedule.enabled) && <p className="text-muted-foreground">每天 · 北京时间（UTC+8）</p>}
                </div>}
                {data && expanded && <form id={id + "-settings"} onSubmit={save} className="space-y-4">
                    <fieldset disabled={busy} className="min-w-0 space-y-4">
                        <section className="space-y-2" aria-labelledby={id + "-front-title"}>
                            <div className="flex flex-wrap items-center justify-between gap-1">
                                <h3 id={id + "-front-title"} className="text-sm font-medium">前台访问密码</h3>
                                <span className="text-xs text-muted-foreground">{data.frontend_password_required ? "已启用" : "未启用"}</span>
                            </div>
                            <label className="sr-only" htmlFor={id + "-front"}>新前台访问密码</label>
                            <Input id={id + "-front"} type="password" autoComplete="new-password" maxLength={72}
                                placeholder="留空保持不变" value={front} disabled={clearFront}
                                onChange={e => setFront(e.target.value)} className="text-base md:text-sm" />
                            {front && <div className="space-y-1"><label htmlFor={id + "-front-confirm"} className="text-xs">确认前台访问密码</label>
                                <Input id={id + "-front-confirm"} type="password" autoComplete="new-password" value={frontConfirm}
                                    onChange={e => setFrontConfirm(e.target.value)} className="text-base md:text-sm" /></div>}
                            <p className="text-xs leading-relaxed text-muted-foreground">访问监控前台时验证，不是账号登录密码。</p>
                            {data.frontend_password_required && <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs">
                                <Checkbox checked={clearFront} onCheckedChange={value => { setClearFront(value === true); setFront(""); setFrontConfirm("") }} />
                                清除并关闭前台访问密码
                            </label>}
                            <ScheduleFields id={id + "-front-time"} label="前台" value={activeFrontSchedule} onChange={setFrontSchedule} />
                        </section>
                        <section className="space-y-2 border-t pt-4" aria-labelledby={id + "-back-title"}>
                            <div className="flex flex-wrap items-center justify-between gap-1">
                                <h3 id={id + "-back-title"} className="text-sm font-medium">后台访问密码</h3>
                                <span className="text-xs text-muted-foreground">{data.backend_password_required ? "已启用" : "未启用"}</span>
                            </div>
                            <label className="sr-only" htmlFor={id + "-back"}>新后台访问密码</label>
                            <Input id={id + "-back"} type="password" autoComplete="new-password" maxLength={72}
                                placeholder="留空保持不变" value={back} disabled={clearBack}
                                onChange={e => setBack(e.target.value)} className="text-base md:text-sm" />
                            {back && <div className="space-y-1"><label htmlFor={id + "-back-confirm"} className="text-xs">确认后台访问密码</label>
                                <Input id={id + "-back-confirm"} type="password" autoComplete="new-password" value={backConfirm}
                                    onChange={e => setBackConfirm(e.target.value)} className="text-base md:text-sm" /></div>}
                            <p className="text-xs leading-relaxed text-muted-foreground">先验证独立访问密码，再使用原账号登录后台。</p>
                            {data.backend_password_required && <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs">
                                <Checkbox checked={clearBack} onCheckedChange={value => { setClearBack(value === true); setBack(""); setBackConfirm("") }} />
                                清除并关闭后台访问密码
                            </label>}
                            <ScheduleFields id={id + "-back-time"} label="后台" value={activeBackSchedule} onChange={setBackSchedule} />
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <div className="min-w-0 space-y-1"><label htmlFor={id + "-failures"} className="text-xs">输错次数（次）</label>
                                    <Input id={id + "-failures"} type="number" inputMode="numeric" min={1} max={100} step={1} required
                                        value={failures ?? data.backend_password_failures} onChange={e => setFailures(e.target.value)} className="text-base md:text-sm" /></div>
                                <div className="min-w-0 space-y-1"><label htmlFor={id + "-minutes"} className="text-xs">封禁时长（分钟）</label>
                                    <Input id={id + "-minutes"} type="number" inputMode="numeric" min={1} max={10080} step={1} required
                                        value={minutes ?? data.backend_password_ban_minutes} onChange={e => setMinutes(e.target.value)} className="text-base md:text-sm" /></div>
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">连续输错达到次数即封禁该 IP 的后台访问；15 分钟无尝试会重置未达阈值的计数。共享公网 IP 的用户会一同受限，前台和 Agent 上报不受此封禁影响。时段结束不会提前解除封禁。</p>
                        </section>
                    </fieldset>
                    {message && <p role="alert" className="break-words text-sm text-destructive">{message}</p>}
                    <Button type="submit" disabled={!dirty || busy} className="w-full">{busy ? "保存中…" : "保存访问设置"}</Button>
                </form>}
            </CardContent>
        </Card>
    )
}

function ScheduleFields({ id, label, value, onChange }: { id: string; label: string; value: Schedule; onChange: (value: Schedule) => void }) {
    return <div className="space-y-2 rounded-md border p-2.5">
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs">
            <Checkbox checked={value.enabled} onCheckedChange={checked => onChange({ ...value, enabled: checked === true })} />
            {label}仅在指定时间段验证
        </label>
        {value.enabled ? <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
                <div className="min-w-0 space-y-1"><label htmlFor={id + "-start"} className="text-xs">开始时间</label>
                    <Input id={id + "-start"} aria-label={label + "开始时间"} type="time" step={60} required value={value.start}
                        onChange={e => onChange({ ...value, start: e.target.value })} className="min-w-0 max-w-full px-2 text-base md:text-sm" /></div>
                <div className="min-w-0 space-y-1"><label htmlFor={id + "-end"} className="text-xs">结束时间{value.end < value.start ? "（次日）" : ""}</label>
                    <Input id={id + "-end"} aria-label={label + "结束时间"} type="time" step={60} required value={value.end}
                        onChange={e => onChange({ ...value, end: e.target.value })} className="min-w-0 max-w-full px-2 text-base md:text-sm" /></div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">每天按北京时间（UTC+8）生效，支持跨午夜。仅此时段需访问密码，其他时间免验证{label === "后台" ? "，账号登录仍保留" : ""}。需先设置密码。</p>
        </> : <p className="text-xs leading-relaxed text-muted-foreground">设置密码后全天验证；勾选可限定每天的验证时段。</p>}
    </div>
}
