import { type TelegramBotSettings, saveTelegramBot } from "@/api/notification"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { TelegramMenuConfig } from "@/lib/telegram-menu"
import { useEffect, useId, useState } from "react"
import { toast } from "sonner"

const items = [
    ["home", "服务器概览"],
    ["online", "在线服务器"],
    ["offline", "离线服务器"],
    ["expiry", "即将到期服务器"],
    ["traffic", "今日流量统计"],
] as const

export function TelegramMenuSettings({
    value,
    onSaved,
}: {
    value: TelegramBotSettings
    onSaved: () => Promise<unknown>
}) {
    const control = useId()
    const [menu, setMenu] = useState(value.config)
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    useEffect(() => {
        if (!dirty) setMenu(value.config)
    }, [value.config, dirty])
    const change = (patch: Partial<TelegramMenuConfig>) => {
        setMenu((current) => ({ ...current, ...patch }))
        setDirty(true)
        setError("")
    }
    const validation =
        menu.enabled &&
        (!Number.isInteger(menu.expiry_days) || menu.expiry_days < 1 || menu.expiry_days > 365)
            ? "即将到期范围为 1–365 天"
            : ""
    const statusLabel =
        {
            ready: "已连接",
            disabled: "已关闭",
            starting: "连接中…",
            blocked: "已暂停，请检查机器人配置",
            error: "连接异常，请检查机器人配置",
        }[value.status.state] ?? "状态暂不可用"
    const save = async () => {
        if (saving || validation) return
        setSaving(true)
        setError("")
        try {
            const saved = await saveTelegramBot(value.id, menu)
            setMenu(saved.config)
            // Revalidate before clearing dirty, so polling cannot restore the old draft.
            await onSaved()
            setDirty(false)
            toast.success("TG 机器人设置已保存")
        } catch {
            setError("保存失败，请检查 TG 私聊配置、机器人是否重复绑定及当前权限后重试。")
        } finally {
            setSaving(false)
        }
    }
    return (
        <section
            aria-label="TG 机器人配置"
            className="space-y-4 rounded-xl border bg-card/80 p-4 sm:p-5"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">机器人配置</h2>
                <span role="status" className="text-xs text-muted-foreground">
                    {dirty ? "有未保存的修改" : statusLabel}
                </span>
            </div>
            {!value.eligible && (
                <p role="alert" className="text-sm text-destructive">
                    {value.reason}
                </p>
            )}
            <fieldset disabled={saving} className="min-w-0 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <label htmlFor={control} className="text-sm font-medium">
                        启用 TG 机器人
                    </label>
                    <Switch
                        id={control}
                        checked={menu.enabled}
                        disabled={!value.eligible && !menu.enabled}
                        onCheckedChange={(enabled) => change({ enabled })}
                    />
                </div>
                <fieldset
                    disabled={!menu.enabled || !value.eligible}
                    className="min-w-0 space-y-3 disabled:opacity-50"
                >
                    <details open className="rounded-lg border p-3">
                        <summary className="cursor-pointer text-sm font-medium">菜单功能</summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {items.map(([key, label]) => (
                                <div
                                    key={key}
                                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                                >
                                    <label htmlFor={control + key}>{label}</label>
                                    <Switch
                                        id={control + key}
                                        checked={menu.items?.[key] !== false}
                                        onCheckedChange={(checked) =>
                                            change({ items: { ...menu.items, [key]: checked } })
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                        {menu.items?.expiry !== false && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                                <label htmlFor={control + "-days"}>即将到期：未来</label>
                                <Input
                                    id={control + "-days"}
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={menu.expiry_days || ""}
                                    className="h-8 w-20"
                                    onChange={(event) =>
                                        change({ expiry_days: Number(event.target.value) })
                                    }
                                />
                                <span>天</span>
                            </div>
                        )}
                    </details>
                    <details className="rounded-lg border p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                            登录提醒与流量推送
                        </summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {(
                                [
                                    ["login_success", "登录成功提醒"],
                                    ["login_failure", "登录失败提醒"],
                                    ["daily_traffic", "每日流量推送"],
                                ] as const
                            ).map(([key, label]) => (
                                <div
                                    key={key}
                                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                                >
                                    <label htmlFor={control + key}>{label}</label>
                                    <Switch
                                        id={control + key}
                                        checked={!!menu[key]}
                                        onCheckedChange={(checked) => change({ [key]: checked })}
                                    />
                                </div>
                            ))}
                        </div>
                        {menu.daily_traffic && (
                            <p className="mt-2 text-xs text-muted-foreground">
                                每天 00:00（北京时间）推送昨日流量
                            </p>
                        )}
                        {menu.login_failure && (
                            <div className="mt-3 space-y-2 rounded-md border p-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                    <label htmlFor={control + "-password"}>失败提醒附带密码</label>
                                    <Switch
                                        id={control + "-password"}
                                        checked={!!menu.login_failure_password}
                                        onCheckedChange={(checked) =>
                                            change({ login_failure_password: checked })
                                        }
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    明文密码会保存在 TG 聊天记录中。
                                </p>
                            </div>
                        )}
                    </details>
                </fieldset>
                {(validation || error) && (
                    <p role="alert" className="text-sm text-destructive">
                        {validation || error}
                    </p>
                )}
                <div className="flex items-center gap-3">
                    <Button
                        type="button"
                        disabled={!dirty || !!validation || (!value.eligible && menu.enabled)}
                        onClick={save}
                    >
                        {saving ? "保存中…" : "保存设置"}
                    </Button>
                    <span className="text-xs text-muted-foreground">保存后生效</span>
                </div>
            </fieldset>
        </section>
    )
}
