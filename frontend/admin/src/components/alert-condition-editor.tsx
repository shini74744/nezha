import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    alertMetrics,
    alertSampleIntervalSeconds,
    alertWindowSamples,
    alertWindowSeconds,
    changeAlertMetric,
    cycleInputISO,
    cycleInputValue,
    cycleUnits,
    defaultUnit,
    isCycleRule,
    metricInfo,
    ruleSummary,
    selectedServerIDs,
    setSelectedServers,
    unitsFor,
} from "@/lib/alert-rule-editor"
import type { ModelRule } from "@/types"
import { type ReactElement, type ReactNode, cloneElement, useId, useState } from "react"

export const alertSelectClass =
    "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
export function AlertField({
    title,
    children,
}: {
    title: string
    children: ReactElement<{ id?: string }>
}) {
    const id = useId()
    return (
        <div className="min-w-0 space-y-2 text-sm font-medium">
            <label htmlFor={id} className="block">
                {title}
            </label>
            {cloneElement(children, { id })}
        </div>
    )
}
export function AlertHelp({ title, children }: { title: string; children: ReactNode }) {
    return (
        <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{title} ⓘ</summary>
            <div className="mt-2 rounded border p-3 text-muted-foreground leading-relaxed">
                {children}
            </div>
        </details>
    )
}
export function AlertSelection({
    title,
    options,
    value,
    onChange,
    error,
}: {
    title: string
    options: { id: number; name: string }[]
    value: string[]
    onChange: (value: string[]) => void
    error?: boolean
}) {
    const [search, setSearch] = useState("")
    const all = [
        ...options,
        ...value
            .filter((id) => !options.some((o) => String(o.id) === id))
            .map((id) => ({ id: Number(id), name: "未加载或已移除的条目" })),
    ]
    const visible = all.filter((o) =>
        (o.name + " #" + o.id).toLowerCase().includes(search.toLowerCase()),
    )
    return (
        <details className="min-w-0 rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium break-words">
                <span>{title}</span>
                {/* Isolate the count from adjacent text-node merging and refresh its paint. */}
                <span key={value.length} translate="no" aria-live="polite" aria-atomic="true">
                    {` · 已选 ${value.length} 项`}
                </span>
            </summary>
            <p className="my-2 text-xs text-muted-foreground break-words">
                {value.length
                    ? value
                          .map(
                              (id) =>
                                  (all.find((o) => String(o.id) === id)?.name || "") + " #" + id,
                          )
                          .join("、")
                    : "未选择"}
            </p>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    列表加载失败，已有选择保留。请关闭后重开重试。
                </p>
            )}
            <Input
                aria-label={title + "搜索"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索名称或 ID"
            />
            <div className="mt-2 max-h-48 overflow-y-auto space-y-2">
                {visible.map((o) => (
                    <label key={o.id} className="flex items-start gap-2 text-sm break-words">
                        <input
                            type="checkbox"
                            className="mt-1 shrink-0"
                            checked={value.includes(String(o.id))}
                            onChange={(e) =>
                                onChange(
                                    e.target.checked
                                        ? [...value, String(o.id)]
                                        : value.filter((id) => id !== String(o.id)),
                                )
                            }
                        />
                        <span className="min-w-0">
                            {o.name} #{o.id}
                        </span>
                    </label>
                ))}
                {!visible.length && <p className="text-xs text-muted-foreground">没有匹配条目</p>}
            </div>
        </details>
    )
}
export function AlertCondition({
    rule,
    index,
    onChange,
    onRemove,
    servers,
    serverError,
}: {
    rule: ModelRule
    index: number
    onChange: (rule: ModelRule) => void
    onRemove: () => void
    servers: { id: number; name: string }[]
    serverError?: boolean
}) {
    const [factor, setFactor] = useState(() => defaultUnit(rule))
    const [pendingType, setPendingType] = useState("")
    const cycle = isCycleRule(rule)
    const offline = rule.type === "offline"
    const patch = (value: Partial<ModelRule>) => onChange({ ...rule, ...value })
    const units = unitsFor(rule.type)
    const unit = units.some(([, n]) => n === factor) ? factor : 1
    return (
        <fieldset className="min-w-0 rounded-lg border p-4 space-y-4" data-testid="alert-condition">
            <legend className="px-1 text-sm font-semibold">条件 {index + 1}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AlertField title="监控指标">
                    <select
                        className={alertSelectClass}
                        value={rule.type}
                        onChange={(e) => {
                            if (e.target.value !== rule.type) setPendingType(e.target.value)
                        }}
                    >
                        {!alertMetrics.some(([type]) => type === rule.type) && (
                            <option value={rule.type}>{rule.type}（不支持）</option>
                        )}
                        {alertMetrics.map(([type, name]) => (
                            <option key={type} value={type}>
                                {name}
                            </option>
                        ))}
                    </select>
                </AlertField>
                {!cycle && (
                    <AlertField title={offline ? "连续离线检测窗口（秒）" : "检测窗口（秒）"}>
                        <Input
                            type="number"
                            min={9}
                            max={2147483647 * alertSampleIntervalSeconds}
                            step={alertSampleIntervalSeconds}
                            value={alertWindowSeconds(rule) ?? ""}
                            onChange={(e) =>
                                patch({
                                    duration:
                                        e.target.value === ""
                                            ? undefined
                                            : alertWindowSamples(Number(e.target.value)),
                                })
                            }
                        />
                    </AlertField>
                )}
            </div>
            {!cycle && (
                <p className="text-xs text-muted-foreground">
                    每 3 秒采样一次，窗口按秒填写，须为 3 秒的整数倍；现有规则的实际时长保持不变。
                </p>
            )}
            {pendingType && (
                <div role="alert" className="rounded border border-amber-500 p-3 space-y-3 text-sm">
                    <p>
                        确认切换为“{metricInfo(pendingType)?.[1] || pendingType}
                        ”？检测窗口和服务器范围保留；相同单位保留阈值，不同单位会清空阈值，需重新填写。切出周期类型会移除周期设置。
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                const next = changeAlertMetric(rule, pendingType)
                                onChange(next)
                                setFactor(defaultUnit(next))
                                setPendingType("")
                            }}
                        >
                            确认切换指标
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setPendingType("")}
                        >
                            取消切换
                        </Button>
                    </div>
                </div>
            )}
            {!offline && !(rule.min && rule.min > 0) && !(rule.max && rule.max > 0) && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                    尚未设置有效阈值，请填写报警上限或下限；当前不会因数值超限报警。
                </p>
            )}
            {!offline && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <AlertField title="报警上限（高于时）">
                        <Input
                            type="number"
                            step="any"
                            value={rule.max === undefined ? "" : rule.max / unit}
                            onChange={(e) =>
                                patch({
                                    max:
                                        e.target.value === ""
                                            ? undefined
                                            : Number(e.target.value) * unit,
                                })
                            }
                        />
                    </AlertField>
                    <AlertField title="报警下限（低于时）">
                        <Input
                            type="number"
                            step="any"
                            value={rule.min === undefined ? "" : rule.min / unit}
                            onChange={(e) =>
                                patch({
                                    min:
                                        e.target.value === ""
                                            ? undefined
                                            : Number(e.target.value) * unit,
                                })
                            }
                        />
                    </AlertField>
                    <AlertField title="阈值单位">
                        <select
                            className={alertSelectClass}
                            value={unit}
                            onChange={(e) => setFactor(Number(e.target.value))}
                        >
                            {units.map(([name, n]) => (
                                <option key={name} value={n}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </AlertField>
                </div>
            )}
            {cycle && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 min-w-0">
                        <AlertField title="周期开始时间（北京时间 UTC+8）">
                            <Input
                                className="min-w-0 max-w-full"
                                type="datetime-local"
                                step="1"
                                value={cycleInputValue(rule.cycle_start)}
                                onChange={(e) =>
                                    patch({ cycle_start: cycleInputISO(e.target.value) })
                                }
                            />
                        </AlertField>
                    </div>
                    <AlertField title="每隔">
                        <Input
                            type="number"
                            min={1}
                            step={1}
                            value={rule.cycle_interval ?? ""}
                            onChange={(e) =>
                                patch({
                                    cycle_interval:
                                        e.target.value === "" ? undefined : Number(e.target.value),
                                })
                            }
                        />
                    </AlertField>
                    <AlertField title="周期单位">
                        <select
                            className={alertSelectClass}
                            value={rule.cycle_unit?.toLowerCase() || "hour"}
                            onChange={(e) =>
                                patch({ cycle_unit: e.target.value as ModelRule["cycle_unit"] })
                            }
                        >
                            {rule.cycle_unit && !(rule.cycle_unit.toLowerCase() in cycleUnits) && (
                                <option value={rule.cycle_unit}>
                                    {rule.cycle_unit}（后端按小时）
                                </option>
                            )}
                            {Object.entries(cycleUnits).map(([key, name]) => (
                                <option key={key} value={key}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </AlertField>
                </div>
            )}
            <AlertField title="适用服务器">
                <select
                    className={alertSelectClass}
                    value={rule.cover}
                    onChange={(e) => patch({ cover: Number(e.target.value) })}
                >
                    <option value={0}>全部服务器（可排除部分）</option>
                    <option value={1}>仅指定服务器</option>
                </select>
            </AlertField>
            <AlertSelection
                title={rule.cover === 1 ? "选择监控服务器" : "选择排除服务器"}
                options={servers}
                value={selectedServerIDs(rule)}
                onChange={(ids) => onChange(setSelectedServers(rule, ids))}
                error={serverError}
            />
            {rule.cover === 1 && !selectedServerIDs(rule).length && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                    当前没有选择服务器，这个条件不会触发报警。
                </p>
            )}
            <p className="text-sm text-muted-foreground break-words">{ruleSummary(rule)}</p>
            <AlertHelp title="这个条件如何判断">
                {offline
                    ? "超过约 6 秒未收到心跳开始视为离线；检测窗口内的采样全部离线才触发。"
                    : cycle
                      ? "检查最近一次周期流量统计；后台按现有间隔刷新，并非实时更新。周期按后端日历规则滚动，月底行为保持原样。"
                      : "检测窗口内超过 70% 的采样异常才触发，不要求每一秒都超限。"}
                {!offline &&
                    " 上下限留空或不大于 0 时不启用该边界；两项都设置时，高于上限或低于下限均算异常。"}
                {rule.type === "net_all_speed" &&
                    " 总网速为上传速度与下载速度之和。Mbps / Gbps 按十进制比特换算，MiB/s 按二进制字节换算。"}
                {(rule.type === "gpu" ||
                    rule.type === "gpu_max" ||
                    rule.type === "temperature_max") &&
                    " 没有上报对应传感器数据时会跳过此项。"}
            </AlertHelp>
            <Button type="button" variant="outline" size="sm" onClick={onRemove}>
                删除条件 {index + 1}
            </Button>
        </fieldset>
    )
}
