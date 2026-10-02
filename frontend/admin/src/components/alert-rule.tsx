import { createAlertRule, updateAlertRule } from "@/api/alert-rule"
import { swrFetcher } from "@/api/api"
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
import { IconButton } from "@/components/xui/icon-button"
import { useNotification } from "@/hooks/useNotfication"
import {
    newAlertCondition,
    parseAlertRules,
    ruleSummary,
    validateAlertRules,
} from "@/lib/alert-rule-editor"
import type { ModelAlertRule, ModelAlertRuleForm, ModelCron, ModelRule } from "@/types"
import { type FormEvent, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR, { type KeyedMutator } from "swr"

import {
    AlertCondition,
    AlertField,
    AlertHelp,
    AlertSelection,
    alertSelectClass,
} from "./alert-condition-editor"

interface AlertRuleCardProps {
    data?: ModelAlertRule
    mutate: KeyedMutator<ModelAlertRule[]>
}
const templates = [
    ["offline", "服务器离线"],
    ["cpu", "CPU 使用率"],
    ["memory", "内存使用率"],
    ["disk", "磁盘使用率"],
    ["tcp_conn_count", "TCP 连接数"],
    ["udp_conn_count", "UDP 连接数"],
    ["transfer_all_cycle", "周期流量"],
] as const

export const AlertRuleCard = ({ data, mutate }: AlertRuleCardProps) => {
    const [open, setOpen] = useState(false)
    const { t } = useTranslation()
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {data ? (
                    <IconButton
                        variant="outline"
                        icon="edit"
                        aria-label={"编辑警报规则 " + data.name}
                    />
                ) : (
                    <IconButton variant="outline" icon="plus" aria-label="创建警报规则" />
                )}
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] sm:max-w-5xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6">
                <DialogHeader>
                    <DialogTitle>{data ? t("EditAlertRule") : t("CreateAlertRule")}</DialogTitle>
                    <DialogDescription>
                        选择监控条件、服务器和通知方式。规则预览不会发送消息或执行任务。
                    </DialogDescription>
                </DialogHeader>
                {open && (
                    <AlertRuleEditor data={data} mutate={mutate} close={() => setOpen(false)} />
                )}
            </DialogContent>
        </Dialog>
    )
}

function AlertRuleEditor({ data, mutate, close }: AlertRuleCardProps & { close: () => void }) {
    const [draft, setDraft] = useState<ModelAlertRuleForm>(() => ({
        name: data?.name || "",
        enable: data?.enable ?? false,
        rules: data?.rules || [],
        notification_group_id: data?.notification_group_id || 0,
        trigger_mode: data?.trigger_mode ?? 0,
        fail_trigger_tasks: data?.fail_trigger_tasks || [],
        recover_trigger_tasks: data?.recover_trigger_tasks || [],
    }))
    // One source of truth. Invalid JSON remains visible and can never silently save older rules.
    const [raw, setRaw] = useState(() =>
        JSON.stringify(data?.rules || [newAlertCondition("offline")], null, 2),
    )
    const [mode, setMode] = useState<"visual" | "json">("visual")
    const [error, setError] = useState("")
    const [saving, setSaving] = useState(false)
    const [template, setTemplate] = useState("cpu")
    const [conditionVersion, setConditionVersion] = useState(0)
    const { rules, error: parseError } = parseAlertRules(raw)
    const validation = parseError || validateAlertRules(rules)
    const { notifierGroup } = useNotification()
    const groups =
        notifierGroup?.map((item) => ({ id: item.group.id, name: item.group.name })) || []
    const { data: servers, error: serverError } = useSWR<{ id: number; name: string }[]>(
        "/api/v1/server",
        swrFetcher,
    )
    const { data: tasks, error: taskError } = useSWR<ModelCron[]>("/api/v1/cron", swrFetcher)
    const triggerTasks = tasks?.filter((task) => task.task_type === 1) || []
    const patch = (change: Partial<ModelAlertRuleForm>) =>
        setDraft((prev) => ({ ...prev, ...change }))
    const updateRules = (next: ModelRule[]) => {
        setRaw(JSON.stringify(next, null, 2))
        setError("")
    }
    const save = async (event: FormEvent) => {
        event.preventDefault()
        if (saving) return
        if (!draft.name.trim()) {
            setError("请填写规则名称。")
            return
        }
        if (validation) {
            setError(validation)
            return
        }
        setSaving(true)
        setError("")
        const payload = { ...draft, rules }
        try {
            if (data?.id) await updateAlertRule(data.id, payload)
            else await createAlertRule(payload)
        } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败，请稍后重试。")
            setSaving(false)
            return
        }
        toast.success("警报规则已保存")
        close()
        void mutate().catch(() => toast.error("规则已保存，但列表刷新失败，请刷新页面。"))
    }
    const selectedGroup = groups.find((g) => g.id === draft.notification_group_id)
    const eventType =
        rules.length && rules.every((r) => r.type === "offline")
            ? "服务器状态（离线 / 上线）"
            : "资源告警（告警 / 恢复）"
    return (
        <form onSubmit={save} className="min-w-0" noValidate>
            <fieldset
                disabled={saving}
                className="min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5"
            >
                <div className="min-w-0 space-y-5">
                    <section className="space-y-4">
                        <h3 className="font-semibold">基本设置</h3>
                        <AlertField title="规则名称">
                            <Input
                                value={draft.name}
                                onChange={(e) => patch({ name: e.target.value })}
                            />
                        </AlertField>
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={!!draft.enable}
                                onChange={(e) => patch({ enable: e.target.checked })}
                            />
                            启用此警报规则
                        </label>
                    </section>
                    <section className="space-y-3 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant={mode === "visual" ? "default" : "outline"}
                                aria-pressed={mode === "visual"}
                                onClick={() => {
                                    if (parseError) setError(parseError)
                                    else setMode("visual")
                                }}
                            >
                                可视化编辑
                            </Button>
                            <Button
                                type="button"
                                variant={mode === "json" ? "default" : "outline"}
                                aria-pressed={mode === "json"}
                                onClick={() => setMode("json")}
                            >
                                高级 JSON
                            </Button>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            同一规则中的所有条件都满足时才报警（AND）。需要任一条件触发，请分别新建警报规则。
                        </p>
                        {parseError && (
                            <p role="alert" className="text-sm text-destructive">
                                {parseError}
                            </p>
                        )}
                        {mode === "json" && (
                            <p className="text-sm text-muted-foreground">
                                兼容说明：高级 JSON 的 duration 仍是采样次数，1 次约 3
                                秒；可视化表单会自动换算为秒，旧数据无需修改。
                            </p>
                        )}
                        {mode === "json" ? (
                            <AlertField title="规则 JSON">
                                <Textarea
                                    className="min-h-72 font-mono text-xs resize-y"
                                    spellCheck={false}
                                    value={raw}
                                    onChange={(e) => {
                                        setRaw(e.target.value)
                                        setError("")
                                    }}
                                />
                            </AlertField>
                        ) : (
                            !parseError && (
                                <>
                                    {rules.map((rule, index) => (
                                        <AlertCondition
                                            key={`${conditionVersion}-${index}`}
                                            rule={rule}
                                            index={index}
                                            servers={servers || []}
                                            serverError={!!serverError}
                                            onRemove={() => {
                                                setConditionVersion((v) => v + 1)
                                                updateRules(rules.filter((_, i) => i !== index))
                                            }}
                                            onChange={(next) =>
                                                updateRules(
                                                    rules.map((r, i) => (i === index ? next : r)),
                                                )
                                            }
                                        />
                                    ))}
                                    <div className="flex flex-wrap gap-2 items-end">
                                        <div className="min-w-0 flex-1">
                                            <AlertField title="快速添加条件">
                                                <select
                                                    className={alertSelectClass}
                                                    value={template}
                                                    onChange={(e) => setTemplate(e.target.value)}
                                                >
                                                    {templates.map(([key, title]) => (
                                                        <option key={key} value={key}>
                                                            {title}
                                                        </option>
                                                    ))}
                                                </select>
                                            </AlertField>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                updateRules([...rules, newAlertCondition(template)])
                                            }
                                        >
                                            添加条件
                                        </Button>
                                    </div>
                                </>
                            )
                        )}
                    </section>
                    <section className="rounded-lg border p-4 space-y-4">
                        <h3 className="font-semibold">通知与触发</h3>
                        <AlertField title="通知组">
                            <select
                                className={alertSelectClass}
                                value={draft.notification_group_id}
                                onChange={(e) =>
                                    patch({ notification_group_id: Number(e.target.value) })
                                }
                            >
                                <option value={0}>不发送通知（只执行已选任务）</option>
                                {draft.notification_group_id > 0 && !selectedGroup && (
                                    <option value={draft.notification_group_id}>
                                        未加载的通知组 #{draft.notification_group_id}（保留）
                                    </option>
                                )}
                                {groups.map((g) => (
                                    <option key={g.id} value={g.id}>
                                        {g.name} #{g.id}
                                    </option>
                                ))}
                            </select>
                        </AlertField>
                        <AlertField title="触发方式">
                            <select
                                className={alertSelectClass}
                                value={draft.trigger_mode}
                                onChange={(e) => patch({ trigger_mode: Number(e.target.value) })}
                            >
                                <option value={0}>持续触发（受通知去重限制）</option>
                                <option value={1}>单次触发（恢复后可再次报警）</option>
                            </select>
                        </AlertField>
                        <AlertHelp title="触发、恢复与去重说明">
                            持续触发：异常期间会反复尝试通知及触发任务；通知仍受后台去重限制，并不是每秒发送。
                            单次触发：进入异常时触发一次，恢复后下一次异常可以再次触发。两种模式均会在恢复时尝试通知并执行恢复任务。
                            周期流量在新周期统计恢复正常后可重新触发。本次不修改后端的判断、去重或任务执行逻辑。
                        </AlertHelp>
                        <AlertSelection
                            title="报警时触发的任务"
                            options={triggerTasks}
                            value={draft.fail_trigger_tasks.map(String)}
                            onChange={(ids) => patch({ fail_trigger_tasks: ids.map(Number) })}
                            error={!!taskError}
                        />
                        <AlertSelection
                            title="恢复后触发的任务"
                            options={triggerTasks}
                            value={draft.recover_trigger_tasks.map(String)}
                            onChange={(ids) => patch({ recover_trigger_tasks: ids.map(Number) })}
                            error={!!taskError}
                        />
                        <p className="text-xs text-muted-foreground">
                            只列出触发任务；保持空选不会执行任务。保存启用规则后，满足条件即可实际触发。
                        </p>
                    </section>
                </div>
                <aside
                    className="min-w-0 rounded-lg border bg-muted/20 p-4 space-y-4 self-start lg:sticky lg:top-0"
                    aria-label="规则实时预览"
                >
                    <div className="flex flex-wrap justify-between gap-2">
                        <h3 className="font-semibold">规则实时预览</h3>
                        <span className="text-xs text-muted-foreground">不发送 · 不执行</span>
                    </div>
                    <p className="font-medium break-words">{draft.name || "未命名规则"}</p>
                    <p className="text-sm">
                        {draft.enable ? "启用" : "停用"} ·{" "}
                        {draft.trigger_mode === 1 ? "单次触发" : "持续触发"}
                    </p>
                    {validation ? (
                        <p className="text-sm text-destructive">{validation}</p>
                    ) : (
                        <ol className="list-decimal pl-5 space-y-3 text-sm">
                            {rules.map((rule, index) => (
                                <li key={index} className="break-words">
                                    {ruleSummary(rule)}
                                </li>
                            ))}
                        </ol>
                    )}
                    <div className="border-t pt-3 space-y-2 text-sm break-words">
                        <p>
                            满足全部条件 →{" "}
                            {draft.notification_group_id
                                ? selectedGroup?.name || "通知组 #" + draft.notification_group_id
                                : "不发送通知"}
                        </p>
                        <p>通知内容分类：{eventType}</p>
                        <p>
                            报警任务：{draft.fail_trigger_tasks.length} 项 · 恢复任务：
                            {draft.recover_trigger_tasks.length} 项
                        </p>
                        <p className="text-muted-foreground">
                            通知的“按事件分别设置内容”决定消息内容，本页决定何时触发。
                        </p>
                    </div>
                </aside>
                <div className="lg:col-span-2 min-w-0 space-y-3 border-t pt-4">
                    {error && (
                        <p role="alert" className="text-sm text-destructive break-words">
                            {error}
                        </p>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={close}>
                            取消
                        </Button>
                        <Button type="submit">{saving ? "保存中…" : "保存警报规则"}</Button>
                    </div>
                </div>
            </fieldset>
        </form>
    )
}
