import { swrFetcher } from "@/api/api"
import { type CronPreview, createCron, previewCron, updateCron } from "@/api/cron"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useNotification } from "@/hooks/useNotfication"
import {
    type ScheduleMode,
    type ScheduleOptions,
    buildSchedule,
    coverageSummary,
    cronDraft,
    parseSchedule,
    scheduleDefaults,
    scheduleModes,
    scheduleSummary,
    validateCronDraft,
    weekNames,
} from "@/lib/cron-editor"
import type { ModelCron, ModelCronForm } from "@/types"
import { CalendarClock, Pencil, Plus } from "lucide-react"
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import useSWR, { type KeyedMutator } from "swr"

import "./cron-editor.css"

interface CronCardProps {
    data?: ModelCron
    mutate: KeyedMutator<ModelCron[]>
}

export function CronCard({ data, mutate }: CronCardProps) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!saving) setOpen(next)
            }}
        >
            <DialogTrigger asChild>
                <Button
                    variant={data ? "outline" : "default"}
                    aria-label={data ? "编辑任务 " + data.name : "新建任务"}
                >
                    {data ? <Pencil size={15} aria-hidden /> : <Plus size={16} aria-hidden />}
                    {data ? "编辑" : "新建任务"}
                </Button>
            </DialogTrigger>
            <DialogContent
                className="cron-dialog"
                onEscapeKeyDown={(e) => {
                    if (saving) e.preventDefault()
                }}
                onPointerDownOutside={(e) => {
                    if (saving) e.preventDefault()
                }}
            >
                <DialogHeader className="cron-dialog-heading">
                    <DialogTitle>{data ? "编辑任务" : "新建任务"}</DialogTitle>
                    <DialogDescription>
                        设置执行时间、命令和服务器范围。保存会启用对应规则，不会立即手动执行。
                    </DialogDescription>
                </DialogHeader>
                {open && (
                    <CronEditor
                        data={data}
                        mutate={mutate}
                        close={() => setOpen(false)}
                        onSaving={setSaving}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

function Section({
    number,
    title,
    children,
}: {
    number: string
    title: string
    children: ReactNode
}) {
    return (
        <section className="cron-section">
            <h3>
                <span>{number}</span>
                {title}
            </h3>
            {children}
        </section>
    )
}

export function CronEditor({
    data,
    mutate,
    close,
    onSaving = () => {},
}: CronCardProps & { close: () => void; onSaving?: (saving: boolean) => void }) {
    const id = useId()
    const [draft, setDraft] = useState(() => cronDraft(data))
    const [options, setOptions] = useState(() => parseSchedule(draft.scheduler))
    const [scheduleError, setScheduleError] = useState("")
    const [error, setError] = useState("")
    const [search, setSearch] = useState("")
    const [saving, setSaving] = useState(false)
    const pending = useRef(false)
    const [preview, setPreview] = useState<{
        expression: string
        data?: CronPreview
        error?: string
    }>()
    const {
        data: servers,
        error: serverError,
        isLoading: serverLoading,
        mutate: retryServers,
    } = useSWR<{ id: number; name: string }[]>("/api/v1/server", swrFetcher)
    const { notifierGroup } = useNotification()
    const groups = notifierGroup?.map((item) => item.group) ?? []
    const patch = (values: Partial<ModelCronForm>) => setDraft((prev) => ({ ...prev, ...values }))
    const updateSchedule = (next: ScheduleOptions) => {
        setOptions(next)
        if (next.mode === "advanced") {
            setScheduleError("")
            return
        }
        const result = buildSchedule(next)
        setScheduleError(result.error)
        patch({ scheduler: result.value })
    }
    useEffect(() => {
        if (draft.task_type !== 0 || !draft.scheduler.trim() || scheduleError) return
        let alive = true
        const expression = draft.scheduler
        const timer = window.setTimeout(() => {
            previewCron(expression)
                .then((data) => {
                    if (alive) setPreview({ expression, data })
                })
                .catch((e) => {
                    if (alive)
                        setPreview({
                            expression,
                            error: e instanceof Error ? e.message : "时间预览失败，请重试。",
                        })
                })
        }, 400)
        return () => {
            alive = false
            window.clearTimeout(timer)
        }
    }, [draft.scheduler, draft.task_type, scheduleError])
    const currentPreview = preview?.expression === draft.scheduler ? preview : undefined
    const allServers = [
        ...(servers ?? []),
        ...draft.servers
            .filter((s) => !servers?.some((row) => row.id === s))
            .map((id) => ({ id, name: "未加载或已移除的服务器" })),
    ]
    const filtered = allServers.filter((s) =>
        (s.name + " #" + s.id).toLowerCase().includes(search.toLowerCase()),
    )
    const toggle = (id: number, checked: boolean) =>
        patch({ servers: checked ? [...draft.servers, id] : draft.servers.filter((s) => s !== id) })

    async function save(event: FormEvent) {
        event.preventDefault()
        if (pending.current) return
        const validation = validateCronDraft(draft) || (draft.task_type === 0 ? scheduleError : "")
        if (validation) {
            setError(validation)
            return
        }
        pending.current = true
        setSaving(true)
        onSaving(true)
        setError("")
        try {
            if (draft.task_type === 0) {
                const result = await previewCron(draft.scheduler)
                if (!result.next.length)
                    throw new Error("此表达式在调度器可计算范围内没有执行时间，请检查日期。")
            }
            const payload = { ...draft, name: draft.name.trim() }
            if (data?.id) await updateCron(data.id, payload)
            else await createCron(payload)
            toast.success("任务已保存")
            close()
            void mutate().catch(() => toast.error("任务已保存，但列表刷新失败，请刷新页面。"))
        } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败，请重试。")
        } finally {
            pending.current = false
            setSaving(false)
            onSaving(false)
        }
    }

    return (
        <form className="cron-form" onSubmit={save}>
            <div className="cron-form-scroll">
                <fieldset disabled={saving} className="cron-form-grid">
                    <div className="cron-main-fields">
                        <Section number="01" title="任务与命令">
                            <label className="cron-field" htmlFor={id + "-name"}>
                                任务名称
                                <Input
                                    id={id + "-name"}
                                    value={draft.name}
                                    onChange={(e) => patch({ name: e.target.value })}
                                    placeholder="例如：每日磁盘巡检"
                                    required
                                />
                            </label>
                            <div className="cron-type-choice" role="group" aria-label="任务类型">
                                <button
                                    type="button"
                                    aria-pressed={draft.task_type === 0}
                                    onClick={() => patch({ task_type: 0 })}
                                >
                                    <strong>定时执行</strong>
                                    <small>按指定时间自动运行</small>
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={draft.task_type === 1}
                                    onClick={() => patch({ task_type: 1 })}
                                >
                                    <strong>事件触发</strong>
                                    <small>由告警等事件调用</small>
                                </button>
                            </div>
                            <label className="cron-field" htmlFor={id + "-command"}>
                                执行命令
                                <Textarea
                                    id={id + "-command"}
                                    className="cron-command-input"
                                    rows={4}
                                    value={draft.command}
                                    onChange={(e) => patch({ command: e.target.value })}
                                    placeholder="填写需要在服务器上执行的命令"
                                    required
                                    spellCheck={false}
                                />
                            </label>
                            <p className="cron-help">
                                命令会交给目标服务器的 Agent
                                执行，请确认权限与影响；不会因为打开或预览此表单而运行。
                            </p>
                        </Section>
                        <Section number="02" title="执行时间">
                            {draft.task_type === 1 ? (
                                <p className="cron-note">
                                    不按时间自动执行。保存后可在警报规则中关联此任务；原有 Cron
                                    表达式会保留。
                                </p>
                            ) : (
                                <>
                                    <label className="cron-field" htmlFor={id + "-mode"}>
                                        执行周期
                                        <select
                                            id={id + "-mode"}
                                            value={options.mode}
                                            onChange={(e) => {
                                                const mode = e.target.value as ScheduleMode
                                                updateSchedule({
                                                    ...(options.mode === "advanced"
                                                        ? scheduleDefaults
                                                        : options),
                                                    mode,
                                                })
                                            }}
                                        >
                                            {Object.entries(scheduleModes).map(([key, label]) => (
                                                <option key={key} value={key}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    {options.mode === "advanced" ? (
                                        <label className="cron-field" htmlFor={id + "-raw"}>
                                            Cron 表达式
                                            <Input
                                                id={id + "-raw"}
                                                className="cron-code"
                                                value={draft.scheduler}
                                                onChange={(e) =>
                                                    patch({ scheduler: e.target.value })
                                                }
                                                placeholder="0 0 3 * * *"
                                                required
                                            />
                                        </label>
                                    ) : (
                                        <div className="cron-schedule-fields">
                                            {options.mode === "interval" ? (
                                                <>
                                                    <label
                                                        className="cron-field"
                                                        htmlFor={id + "-every"}
                                                    >
                                                        间隔
                                                        <Input
                                                            id={id + "-every"}
                                                            type="number"
                                                            min={1}
                                                            max={100000}
                                                            value={options.every}
                                                            onChange={(e) =>
                                                                updateSchedule({
                                                                    ...options,
                                                                    every: e.target.value,
                                                                })
                                                            }
                                                            required
                                                        />
                                                    </label>
                                                    <label
                                                        className="cron-field"
                                                        htmlFor={id + "-unit"}
                                                    >
                                                        单位
                                                        <select
                                                            id={id + "-unit"}
                                                            value={options.unit}
                                                            onChange={(e) =>
                                                                updateSchedule({
                                                                    ...options,
                                                                    unit: e.target
                                                                        .value as ScheduleOptions["unit"],
                                                                })
                                                            }
                                                        >
                                                            <option value="s">秒</option>
                                                            <option value="m">分钟</option>
                                                            <option value="h">小时</option>
                                                        </select>
                                                    </label>
                                                </>
                                            ) : options.mode === "hourly" ? (
                                                <label
                                                    className="cron-field"
                                                    htmlFor={id + "-minute"}
                                                >
                                                    每小时第几分钟
                                                    <Input
                                                        id={id + "-minute"}
                                                        type="number"
                                                        min={0}
                                                        max={59}
                                                        value={options.minute}
                                                        onChange={(e) =>
                                                            updateSchedule({
                                                                ...options,
                                                                minute: e.target.value,
                                                            })
                                                        }
                                                        required
                                                    />
                                                </label>
                                            ) : (
                                                <>
                                                    <label
                                                        className="cron-field"
                                                        htmlFor={id + "-time"}
                                                    >
                                                        执行时刻
                                                        <Input
                                                            id={id + "-time"}
                                                            type="time"
                                                            value={options.time}
                                                            onChange={(e) =>
                                                                updateSchedule({
                                                                    ...options,
                                                                    time: e.target.value,
                                                                })
                                                            }
                                                            required
                                                        />
                                                    </label>
                                                    {options.mode === "monthly" && (
                                                        <label
                                                            className="cron-field"
                                                            htmlFor={id + "-day"}
                                                        >
                                                            每月几号
                                                            <Input
                                                                id={id + "-day"}
                                                                type="number"
                                                                min={1}
                                                                max={31}
                                                                value={options.day}
                                                                onChange={(e) =>
                                                                    updateSchedule({
                                                                        ...options,
                                                                        day: e.target.value,
                                                                    })
                                                                }
                                                                required
                                                            />
                                                        </label>
                                                    )}
                                                </>
                                            )}
                                            {options.mode === "weekly" && (
                                                <div
                                                    className="cron-week"
                                                    role="group"
                                                    aria-label="执行星期"
                                                >
                                                    {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                                                        <button
                                                            key={day}
                                                            type="button"
                                                            aria-pressed={options.days.includes(
                                                                day,
                                                            )}
                                                            onClick={() =>
                                                                updateSchedule({
                                                                    ...options,
                                                                    days: options.days.includes(day)
                                                                        ? options.days.filter(
                                                                              (d) => d !== day,
                                                                          )
                                                                        : [...options.days, day],
                                                                })
                                                            }
                                                        >
                                                            {weekNames[day]}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {options.mode === "advanced" && (
                                        <p className="cron-help">
                                            六个字段依次为：秒、分、时、日、月、星期。支持 @every 和
                                            CRON_TZ。切换为其他周期会重新生成表达式。
                                        </p>
                                    )}
                                    {options.mode === "monthly" && Number(options.day) > 28 && (
                                        <p className="cron-note">
                                            没有该日期的月份会跳过执行，不会自动改为月末。
                                        </p>
                                    )}
                                    {options.mode === "interval" && (
                                        <p className="cron-note">
                                            固定间隔从任务注册时开始计算；保存修改或面板重启会重新计时。下方为从当前时刻起的估算。
                                        </p>
                                    )}
                                    {options.mode !== "advanced" && (
                                        <p className="cron-generated">
                                            自动生成{" "}
                                            <code>{draft.scheduler || "请完善时间设置"}</code>
                                        </p>
                                    )}
                                    {scheduleError && (
                                        <p className="cron-error" role="alert">
                                            {scheduleError}
                                        </p>
                                    )}
                                    <div className="cron-preview" aria-live="polite">
                                        <h4>
                                            <CalendarClock size={16} aria-hidden />
                                            接下来 5 次执行
                                            {currentPreview?.data && (
                                                <small> · {currentPreview.data.timezone}</small>
                                            )}
                                        </h4>
                                        {scheduleError || !draft.scheduler.trim() ? (
                                            <p>完善时间设置后显示预览。</p>
                                        ) : currentPreview?.error ? (
                                            <p className="cron-error">{currentPreview.error}</p>
                                        ) : currentPreview?.data ? (
                                            currentPreview.data.next.length ? (
                                                <ol>
                                                    {currentPreview.data.next.map((time) => (
                                                        <li key={time}>
                                                            <time dateTime={time}>
                                                                {time
                                                                    .replace("T", " ")
                                                                    .replace(
                                                                        /(Z|[+-]\d\d:\d\d)$/,
                                                                        "",
                                                                    )}
                                                            </time>
                                                        </li>
                                                    ))}
                                                </ol>
                                            ) : (
                                                <p className="cron-error">
                                                    此规则没有可计算的执行时间，请检查日期。
                                                </p>
                                            )
                                        ) : (
                                            <p>正在校验时间…</p>
                                        )}
                                    </div>
                                </>
                            )}
                        </Section>
                    </div>
                    <div className="cron-side-fields">
                        <Section number="03" title="执行服务器">
                            <label className="cron-field" htmlFor={id + "-cover"}>
                                覆盖范围
                                <select
                                    id={id + "-cover"}
                                    value={draft.cover}
                                    onChange={(e) => patch({ cover: Number(e.target.value) })}
                                >
                                    <option value={0}>仅在选中的服务器执行</option>
                                    <option value={1}>全部服务器，排除选中的</option>
                                    <option value={2} disabled={draft.task_type === 0}>
                                        仅触发事件的服务器
                                    </option>
                                </select>
                            </label>
                            <p className={draft.cover === 1 ? "cron-note" : "cron-help"}>
                                {coverageSummary(draft.cover, draft.servers.length)}
                                。权限仍由后端校验。
                            </p>
                            {draft.task_type === 0 && draft.cover === 2 && (
                                <p role="alert" className="cron-error">
                                    定时任务不能使用此范围，请重新选择。
                                </p>
                            )}
                            {draft.cover !== 2 ? (
                                <>
                                    <label className="cron-field" htmlFor={id + "-server-search"}>
                                        {draft.cover === 1 ? "排除服务器" : "选择服务器"} · 已选{" "}
                                        {draft.servers.length}
                                        <Input
                                            id={id + "-server-search"}
                                            placeholder="搜索名称或 ID"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                        />
                                    </label>
                                    {serverLoading && (
                                        <p role="status" className="cron-help">
                                            正在加载服务器…
                                        </p>
                                    )}
                                    {serverError && (
                                        <p className="cron-error" role="alert">
                                            服务器加载失败，原选择已保留。
                                            <button
                                                type="button"
                                                onClick={() => void retryServers()}
                                            >
                                                重试
                                            </button>
                                        </p>
                                    )}
                                    <div className="cron-server-list">
                                        {filtered.map((server) => (
                                            <label key={server.id}>
                                                <input
                                                    type="checkbox"
                                                    checked={draft.servers.includes(server.id)}
                                                    onChange={(e) =>
                                                        toggle(server.id, e.target.checked)
                                                    }
                                                />
                                                <span>
                                                    {server.name}
                                                    <small>#{server.id}</small>
                                                </span>
                                            </label>
                                        ))}
                                        {!filtered.length && !serverLoading && (
                                            <p className="cron-help">没有匹配的服务器</p>
                                        )}
                                    </div>
                                    <p className="cron-help">
                                        已选：
                                        {draft.servers.length
                                            ? allServers
                                                  .filter((s) => draft.servers.includes(s.id))
                                                  .map((s) => s.name + " #" + s.id)
                                                  .join("、")
                                            : "无"}
                                    </p>
                                </>
                            ) : (
                                <p className="cron-help">
                                    无需手动选择服务器；原有服务器列表保留，但此范围不使用该列表。此类任务不能从列表手动执行。
                                </p>
                            )}
                        </Section>
                        <Section number="04" title="执行通知">
                            <label className="cron-field" htmlFor={id + "-notification"}>
                                通知组
                                <select
                                    id={id + "-notification"}
                                    value={draft.notification_group_id}
                                    onChange={(e) =>
                                        patch({ notification_group_id: Number(e.target.value) })
                                    }
                                >
                                    <option value={0}>不发送通知</option>
                                    {groups.map((group) => (
                                        <option key={group.id} value={group.id}>
                                            {group.name}
                                        </option>
                                    ))}
                                    {draft.notification_group_id !== 0 &&
                                        !groups.some(
                                            (g) => g.id === draft.notification_group_id,
                                        ) && (
                                            <option value={draft.notification_group_id}>
                                                未加载的通知组 #{draft.notification_group_id}
                                                （保留）
                                            </option>
                                        )}
                                </select>
                            </label>
                            <label className="cron-check">
                                <input
                                    type="checkbox"
                                    checked={!!draft.push_successful}
                                    onChange={(e) => patch({ push_successful: e.target.checked })}
                                />
                                执行成功时也发送通知
                            </label>
                            <p className="cron-help">
                                {draft.notification_group_id === 0
                                    ? "未选择通知组，不会发送任务结果通知。"
                                    : "失败会通知；成功通知由上方开关控制。实际发送受通知组设置影响。"}
                            </p>
                        </Section>
                        <div className="cron-summary">
                            <strong>保存前确认</strong>
                            <p>
                                {draft.task_type === 0
                                    ? scheduleSummary(draft.scheduler)
                                    : "由事件触发"}
                            </p>
                            <p>{coverageSummary(draft.cover, draft.servers.length)}</p>
                            <small>保存定时任务后，将从下一次匹配时间开始自动执行。</small>
                        </div>
                    </div>
                </fieldset>
            </div>
            <div className="cron-save-bar">
                {error && (
                    <p role="alert" className="cron-error">
                        {error}
                    </p>
                )}
                <div>
                    <span>仅保存配置，不立即执行</span>
                    <Button type="button" variant="outline" disabled={saving} onClick={close}>
                        取消
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {saving ? "正在校验并保存…" : "保存任务"}
                    </Button>
                </div>
            </div>
        </form>
    )
}
