import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    type EventConfig,
    type EventModule,
    availableEventFields,
    defaultEventConfig,
    defaultEventModule,
    eventGroups,
    eventPreview,
    eventStateLabels,
} from "@/lib/notification-events"

export function NotificationEventModules({
    value,
    onChange,
    formatUnits,
    kind,
    onKindChange: setKind,
}: {
    kind: string
    onKindChange: (kind: string) => void
    value?: EventConfig
    onChange: (config: EventConfig) => void
    formatUnits: boolean
}) {
    const config = value ?? { enabled: false, modules: {} }
    const group = eventGroups.find((item) => item.kinds.includes(kind))!
    const module = config.modules[kind] ?? { ...defaultEventModule(kind), mode: "inherit" as const }
    const patch = (next: Partial<EventModule>) =>
        onChange({
            ...config,
            modules: { ...config.modules, [kind]: { ...module, ...next } },
        })
    return (
        <section aria-label="事件通知模块" className="rounded-lg border p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 font-medium">
                    <input
                        type="checkbox"
                        checked={config.enabled}
                        aria-label="按事件分别设置通知内容"
                        onChange={(e) =>
                            onChange(
                                e.target.checked && !Object.keys(config.modules).length
                                    ? defaultEventConfig()
                                    : { ...config, enabled: e.target.checked },
                            )
                        }
                    />
                    按事件分别设置通知内容
                </label>
                <details className="text-xs">
                    <summary className="cursor-pointer" aria-label="事件模块说明">
                        ？
                    </summary>
                    <p className="mt-2 text-muted-foreground">
                        这里只设置通知内容，告警和 IP 变更监控需另行开启。关闭后使用通用模板；选择“不发送”仅停用当前渠道的对应通知。IP 按系统设置脱敏。
                    </p>
                </details>
            </div>
            {config.enabled ? (
                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                        <label className="block text-sm space-y-1">
                            <span>事件类型</span>
                            <select
                                aria-label="事件类型"
                                className="w-full rounded border bg-background p-2"
                                value={group.id}
                                onChange={(e) =>
                                    setKind(
                                        eventGroups.find((item) => item.id === e.target.value)!
                                            .kinds[0],
                                    )
                                }
                            >
                                {eventGroups.map(({ id, label }) => (
                                    <option value={id} key={id}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {group.kinds.length > 1 && (
                            <div className="space-y-2">
                                <div
                                    role="group"
                                    aria-label="通知状态"
                                    className="flex flex-wrap gap-2"
                                >
                                    {group.kinds.map((state) => (
                                        <Button
                                            key={state}
                                            type="button"
                                            size="sm"
                                            aria-pressed={kind === state}
                                            variant={kind === state ? "default" : "outline"}
                                            onClick={() => setKind(state)}
                                        >
                                            {eventStateLabels[state]}
                                        </Button>
                                    ))}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    同类事件放在一起；切换状态可分别设置标题、提示内容和发送开关，已有配置保留。
                                </p>
                            </div>
                        )}
                        <label className="block text-sm space-y-1">
                            <span>
                                处理方式
                                {eventStateLabels[kind] ? " · " + eventStateLabels[kind] : ""}
                            </span>
                            <select
                                aria-label="事件处理方式"
                                className="w-full rounded border bg-background p-2"
                                value={module.mode}
                                onChange={(e) =>
                                    patch({ mode: e.target.value as EventModule["mode"] })
                                }
                            >
                                <option value="fields">自选提示内容</option>
                                <option value="inherit">沿用通用模板</option>
                                <option value="disabled">不发送此类通知</option>
                            </select>
                        </label>
                        {module.mode === "fields" && (
                            <>
                                <label className="block text-sm space-y-1">
                                    <span>通知标题</span>
                                    <Input
                                        aria-label="事件通知标题"
                                        maxLength={120}
                                        value={module.title}
                                        placeholder={defaultEventModule(kind).title}
                                        onChange={(e) => patch({ title: e.target.value })}
                                    />
                                </label>
                                <fieldset className="space-y-2">
                                    <legend className="text-sm font-medium mb-2">
                                        选择要提示的内容
                                    </legend>
                                    <div className="grid grid-cols-2 gap-2">
                                        {availableEventFields(kind).map(([key, label]) => (
                                            <label
                                                key={key}
                                                className="flex items-center gap-2 text-sm"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={module.fields.includes(key)}
                                                    onChange={(e) =>
                                                        patch({
                                                            fields: e.target.checked
                                                                ? [...module.fields, key]
                                                                : module.fields.filter(
                                                                      (field) => field !== key,
                                                                  ),
                                                        })
                                                    }
                                                />
                                                {label}
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        if (
                                            window.confirm(
                                                "恢复当前事件模块的默认标题和内容？其他事件不变。",
                                            )
                                        )
                                            patch(defaultEventModule(kind))
                                    }}
                                >
                                    恢复此模块默认内容
                                </Button>
                            </>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {kind.startsWith("ddns_")
                                ? "请在 DDNS 配置中选择包含此 TG 通知的通知组；更新完成后发送最终结果。"
                                : kind === "online"
                                  ? "仅在离线告警后恢复在线时通知；首次连接或未触发离线告警时不会额外发送上线消息。"
                                  : kind === "ip_change"
                                    ? "请先开启 IP 变更通知并选择通知组。显示最近 7 次旧 IP，按新到旧排列。"
                                    : kind === "offline"
                                      ? "离线时的性能数据可能是最后一次上报值，并非断线后的实时数据。"
                                      : "满足对应事件的通知条件时发送。"}
                        </p>
                    </div>
                    <div
                        aria-label="事件模块预览"
                        className="min-w-0 rounded-lg bg-muted/30 border p-3 space-y-2"
                    >
                        <div className="flex justify-between gap-2 text-sm">
                            <span>
                                当前事件预览
                                {eventStateLabels[kind] ? " · " + eventStateLabels[kind] : ""}
                            </span>
                            <span className="text-xs text-muted-foreground">模拟数据 · 不发送</span>
                        </div>
                        <div
                            data-event-preview
                            className="whitespace-pre-wrap break-words rounded border bg-background p-3 text-sm"
                        >
                            {module.mode === "disabled"
                                ? "此事件发生时，当前 TG 通知不发送消息。"
                                : module.mode === "inherit"
                                  ? `${defaultEventModule(kind).title}\n此状态沿用下面的通用模板；事件正文会自动区分当前状态。`
                                  : eventPreview(kind, module, formatUnits)}
                        </div>
                    </div>
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">
                    目前所有事件沿用下方通用模板。开启后可分别配置离线、上线、IP
                    变更等提示内容；保存后生效。
                </p>
            )}
        </section>
    )
}
