import { setServerConfig } from "@/api/server"
import { Button, ButtonProps } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { IconButton } from "@/components/xui/icon-button"
import {
    ConfigDraft,
    ConfigField,
    NicRule,
    agentConfigFields,
    buildAgentConfigPatch,
    configGroups,
} from "@/lib/agent-config-fields"
import { cn } from "@/lib/utils"
import { ModelServerTaskResponse } from "@/types"
import { AlertTriangle, Check, Search } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

interface ServerConfigCardBatchProps extends ButtonProps {
    sid: number[]
}

function ConfigValue({
    field,
    value,
    onChange,
}: {
    field: ConfigField
    value: ConfigDraft[string]
    onChange: (value: ConfigDraft[string]) => void
}) {
    const id = "batch-config-" + field.key
    if (field.kind === "boolean")
        return (
            <label className="flex min-h-11 cursor-pointer items-center gap-3" htmlFor={id}>
                <Switch
                    id={id}
                    aria-label={field.label}
                    checked={value === true}
                    onCheckedChange={onChange}
                />
                <span className="text-sm font-medium">{value ? "开启" : "关闭"}</span>
            </label>
        )
    if (field.kind === "number")
        return (
            <div className="flex items-center gap-2">
                <Input
                    id={id}
                    aria-label={field.label}
                    aria-describedby={id + "-help"}
                    type="number"
                    inputMode="numeric"
                    className="h-11 w-36"
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={value as string}
                    onChange={(event) => onChange(event.target.value)}
                />
                <span className="text-sm text-muted-foreground">{field.unit}</span>
            </div>
        )
    if (field.kind === "nics") {
        const rows = value as NicRule[]
        return (
            <div className="space-y-2">
                {rows.map((row, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                        <Input
                            className="h-11 min-w-0 flex-1 basis-28"
                            aria-label={"网卡名称 " + (index + 1)}
                            placeholder="例如 eth0"
                            value={row.name}
                            onChange={(event) =>
                                onChange(
                                    rows.map((item, i) =>
                                        i === index ? { ...item, name: event.target.value } : item,
                                    ),
                                )
                            }
                        />
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                            <Switch
                                aria-label={"监控网卡 " + (index + 1)}
                                checked={row.enabled}
                                onCheckedChange={(enabled) =>
                                    onChange(
                                        rows.map((item, i) =>
                                            i === index ? { ...item, enabled } : item,
                                        ),
                                    )
                                }
                            />
                            {row.enabled ? "监控" : "不监控"}
                        </label>
                        <Button
                            variant="ghost"
                            className="h-11 px-2"
                            aria-label={"移除网卡 " + (index + 1)}
                            onClick={() => onChange(rows.filter((_, i) => i !== index))}
                        >
                            移除
                        </Button>
                    </div>
                ))}
                {!rows.length && (
                    <p className="text-sm text-muted-foreground">将恢复自动识别全部网卡</p>
                )}
                <Button
                    variant="outline"
                    className="h-11"
                    onClick={() => onChange([...rows, { name: "", enabled: true }])}
                >
                    添加网卡
                </Button>
            </div>
        )
    }
    return (
        <Textarea
            id={id}
            aria-label={field.label}
            aria-describedby={id + "-help"}
            rows={3}
            className="min-h-24 resize-y"
            placeholder={field.placeholder}
            value={value as string}
            onChange={(event) => onChange(event.target.value)}
        />
    )
}

export const ServerConfigCardBatch = ({ sid, ...props }: ServerConfigCardBatchProps) => {
    const [open, setOpen] = useState(false)
    const [targets, setTargets] = useState<number[]>([])
    const [draft, setDraft] = useState<ConfigDraft>({})
    const [search, setSearch] = useState("")
    const [review, setReview] = useState(false)
    const [acknowledged, setAcknowledged] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState("")
    const [result, setResult] = useState<ModelServerTaskResponse | null>(null)
    const sending = useRef(false)
    const bodyRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const parsed = buildAgentConfigPatch(draft)
    const count = Object.keys(draft).length
    const valid = count > 0 && Object.keys(parsed.errors).length === 0
    const warnings = parsed.changes.filter((change) => change.warning)
    const query = search.trim().toLowerCase()
    const visible = agentConfigFields.filter((field) =>
        [field.label, field.description, field.key, field.group]
            .join(" ")
            .toLowerCase()
            .includes(query),
    )
    const update = (key: string, value: ConfigDraft[string]) => {
        setDraft((previous) => ({ ...previous, [key]: value }))
        setAcknowledged(false)
        setError("")
    }
    const show = () => {
        if (!sid.length) {
            toast("请先选择服务器", { description: "勾选需要修改的服务器，再打开批量配置。" })
            return
        }
        setTargets([...new Set(sid)])
        setDraft({})
        setSearch("")
        setReview(false)
        setAcknowledged(false)
        setResult(null)
        setError("")
        setOpen(true)
    }
    const goReview = (next: boolean) => {
        setReview(next)
        setAcknowledged(false)
        setError("")
        bodyRef.current?.scrollTo?.({ top: 0 })
    }
    const submit = async () => {
        if (
            sending.current ||
            result ||
            !review ||
            !valid ||
            !targets.length ||
            (warnings.length > 0 && !acknowledged)
        )
            return
        sending.current = true
        setPending(true)
        setError("")
        try {
            const response = await setServerConfig({
                config: JSON.stringify(parsed.patch),
                servers: targets,
            })
            setResult(response)
            bodyRef.current?.scrollTo?.({ top: 0 })
        } catch {
            setError("未能确认下发结果，请先检查节点状态后再重试。本次配置已保留。")
        } finally {
            sending.current = false
            setPending(false)
        }
    }

    return (
        <>
            <IconButton
                {...props}
                ref={triggerRef}
                icon="cog"
                title="批量配置 Agent"
                aria-label="批量配置 Agent"
                onClick={show}
            />
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!sending.current) setOpen(next)
                }}
            >
                <DialogContent
                    className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[calc(100dvh-3rem)]"
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        bodyRef.current?.focus()
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        triggerRef.current?.focus()
                    }}
                >
                    <DialogHeader className="shrink-0 border-b p-4 pr-12 text-left sm:p-6 sm:pr-12">
                        <DialogTitle>
                            {result ? "配置下发结果" : review ? "确认配置改动" : "批量配置 Agent"}
                        </DialogTitle>
                        <DialogDescription className="pt-1 leading-relaxed">
                            已选择 {targets.length} 台服务器 ·{" "}
                            {result
                                ? "下发结果不代表配置已生效"
                                : review
                                  ? "请核对后再下发"
                                  : "只修改勾选项，其余配置保持不变"}
                        </DialogDescription>
                    </DialogHeader>
                    <div
                        ref={bodyRef}
                        tabIndex={-1}
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 outline-none sm:p-6"
                        data-testid="agent-config-scroll"
                    >
                        {result ? (
                            <div className="space-y-4" role="status">
                                {(
                                    [
                                        ["success", "已下发"],
                                        ["failure", "下发失败"],
                                        ["offline", "节点离线"],
                                    ] as const
                                ).map(([key, label]) => (
                                    <div key={key} className="rounded-xl border p-4">
                                        <p className="font-semibold">
                                            {label}：{result[key]?.length || 0} 台
                                        </p>
                                        {!!result[key]?.length && (
                                            <p className="mt-2 break-words text-sm text-muted-foreground">
                                                系统 ID：{result[key]!.join("、")}
                                            </p>
                                        )}
                                    </div>
                                ))}
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                    已下发表示面板已发送任务。节点仍可能因权限、版本或配置校验拒绝应用，请稍后检查节点状态与配置。
                                </p>
                            </div>
                        ) : review ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed">
                                    <p className="font-medium">
                                        仅向以下 {targets.length} 台服务器下发{" "}
                                        {parsed.changes.length} 项配置
                                    </p>
                                    <p className="mt-2 break-words text-muted-foreground">
                                        系统 ID：{targets.join("、")}
                                    </p>
                                </div>
                                <ul className="divide-y rounded-xl border px-4">
                                    {parsed.changes.map((change) => (
                                        <li
                                            key={change.key}
                                            className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-4"
                                        >
                                            <span className="shrink-0 text-sm font-medium">
                                                {change.label}
                                            </span>
                                            <span className="break-words text-sm text-muted-foreground sm:text-right">
                                                {change.value}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                    下发后 Agent 通常会在约 10
                                    秒后应用配置并重载，期间可能短暂断线。离线节点不会在上线后自动补发。
                                </p>
                                {warnings.length > 0 && (
                                    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
                                        <p className="flex items-center gap-2 font-medium">
                                            <AlertTriangle className="h-4 w-4 shrink-0" />
                                            请注意以下影响
                                        </p>
                                        <ul className="mt-2 space-y-2 text-sm leading-relaxed">
                                            {warnings.map((change) => (
                                                <li key={change.key}>{change.warning}</li>
                                            ))}
                                        </ul>
                                        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
                                            <Checkbox
                                                checked={acknowledged}
                                                onCheckedChange={(value) =>
                                                    setAcknowledged(value === true)
                                                }
                                            />
                                            我已了解这些影响，确认修改
                                        </label>
                                    </div>
                                )}
                                <details className="rounded-lg border p-3 text-sm">
                                    <summary className="min-h-8 cursor-pointer">
                                        查看配置参数
                                    </summary>
                                    <pre className="mt-2 overflow-auto text-xs">
                                        {JSON.stringify(parsed.patch, null, 2)}
                                    </pre>
                                </details>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="rounded-xl border bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">
                                    不读取各节点当前值。勾选后显示的是
                                    <strong className="font-medium text-foreground">
                                        本次要设置的值
                                    </strong>
                                    ，请按需调整。
                                </div>
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        className="h-11 pl-9"
                                        aria-label="搜索配置项"
                                        placeholder="搜索配置，例如：更新、网卡、终端"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                    />
                                </div>
                                {configGroups.map((group) => {
                                    const fields = visible.filter((field) => field.group === group)
                                    if (!fields.length) return null
                                    return (
                                        <section
                                            key={group}
                                            className="space-y-3"
                                            aria-label={group}
                                        >
                                            <h3 className="text-sm font-semibold">{group}</h3>
                                            {fields.map((field) => {
                                                const selected =
                                                    Object.prototype.hasOwnProperty.call(
                                                        draft,
                                                        field.key,
                                                    )
                                                const error = parsed.errors[field.key]
                                                return (
                                                    <div
                                                        key={field.key}
                                                        data-config-field={field.key}
                                                        className={cn(
                                                            "rounded-xl border p-3 transition-colors sm:p-4",
                                                            selected &&
                                                                "border-emerald-500/70 bg-emerald-500/5",
                                                        )}
                                                    >
                                                        <label className="flex min-h-11 cursor-pointer items-center gap-3">
                                                            <Checkbox
                                                                aria-label={"修改" + field.label}
                                                                checked={selected}
                                                                onCheckedChange={(checked) => {
                                                                    setDraft((previous) => {
                                                                        const next = { ...previous }
                                                                        if (checked === true)
                                                                            next[field.key] =
                                                                                Array.isArray(
                                                                                    field.initial,
                                                                                )
                                                                                    ? []
                                                                                    : field.initial
                                                                        else delete next[field.key]
                                                                        return next
                                                                    })
                                                                    setError("")
                                                                }}
                                                            />
                                                            <span className="min-w-0 flex-1 text-sm font-medium">
                                                                {field.label}
                                                            </span>
                                                            <span
                                                                className={cn(
                                                                    "shrink-0 text-xs",
                                                                    selected
                                                                        ? "text-emerald-700 dark:text-emerald-400"
                                                                        : "text-muted-foreground",
                                                                )}
                                                            >
                                                                {selected ? "本次修改" : "不修改"}
                                                            </span>
                                                        </label>
                                                        <p
                                                            id={
                                                                "batch-config-" +
                                                                field.key +
                                                                "-help"
                                                            }
                                                            className="mt-1 text-sm leading-relaxed text-muted-foreground"
                                                        >
                                                            {field.description}
                                                        </p>
                                                        {selected && (
                                                            <div className="mt-3">
                                                                <ConfigValue
                                                                    field={field}
                                                                    value={draft[field.key]}
                                                                    onChange={(value) =>
                                                                        update(field.key, value)
                                                                    }
                                                                />
                                                                {error && (
                                                                    <p
                                                                        role="alert"
                                                                        className="mt-2 text-sm text-destructive"
                                                                    >
                                                                        {error}
                                                                    </p>
                                                                )}
                                                                {field.warning &&
                                                                    (field.kind !== "boolean" ||
                                                                        draft[field.key] ===
                                                                            false) && (
                                                                        <p className="mt-2 text-sm leading-relaxed text-amber-800 dark:text-amber-300">
                                                                            {field.warning}
                                                                        </p>
                                                                    )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </section>
                                    )
                                })}
                                {!visible.length && (
                                    <p className="py-8 text-center text-sm text-muted-foreground">
                                        未找到配置项，试试其他关键词
                                    </p>
                                )}
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    为避免节点失联或身份冲突，这里不批量修改面板连接地址、连接密钥、TLS
                                    和 UUID。
                                </p>
                            </div>
                        )}
                        {error && (
                            <p
                                role="alert"
                                className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
                            >
                                {error}
                            </p>
                        )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background p-4 sm:px-6">
                        <span className="text-sm text-muted-foreground">
                            {pending
                                ? "正在下发，请稍候…"
                                : result
                                  ? "请核对节点状态"
                                  : "已选 " + count + " 项"}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="h-11"
                                disabled={pending}
                                onClick={() =>
                                    review && !result ? goReview(false) : setOpen(false)
                                }
                            >
                                {review && !result ? "返回修改" : "关闭"}
                            </Button>
                            {!result &&
                                (review ? (
                                    <Button
                                        className="h-11"
                                        disabled={
                                            pending ||
                                            !valid ||
                                            (warnings.length > 0 && !acknowledged)
                                        }
                                        onClick={submit}
                                    >
                                        {pending ? "正在下发…" : "确认下发"}
                                    </Button>
                                ) : (
                                    <Button
                                        className="h-11"
                                        disabled={!valid}
                                        onClick={() => goReview(true)}
                                    >
                                        <Check className="mr-1 h-4 w-4" />
                                        检查改动
                                    </Button>
                                ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
