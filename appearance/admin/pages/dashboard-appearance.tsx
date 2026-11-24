import { FetcherMethod, fetcher } from "@/api/api"
import AppearancePreview from "@appearance/admin/components/AppearancePreview"
import SettingsFilter, { matchesSetting } from "@/components/SettingsFilter"
import SettingsSaveBar from "@/components/SettingsSaveBar"
import UnsavedChanges from "@/components/UnsavedChanges"
import { AppearanceSection } from "@appearance/admin/components/appearance-section"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/useAuth"
import useSetting from "@/hooks/useSetting"
import {
    type DashboardAppearance,
    dashboardDefinitions,
    importDashboardCode,
    normalizeDashboard,
    validateDashboard,
} from "@appearance/admin/settings/dashboard-appearance"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import { toast } from "sonner"

type State = {
    config: DashboardAppearance
    revision: string
    custom_code: string
    archived_code: string
}
const choices: Record<string, [string, string][]> = {
    size: [
        ["cover", "铺满背景"],
        ["contain", "完整显示"],
        ["auto", "原始大小"],
    ],
    repeat: [
        ["no-repeat", "不重复"],
        ["repeat", "平铺"],
        ["repeat-x", "横向重复"],
        ["repeat-y", "纵向重复"],
        ["space", "等距平铺"],
        ["round", "缩放平铺"],
    ],
    attachment: [
        ["fixed", "固定背景"],
        ["scroll", "随页面滚动"],
        ["local", "随内容滚动"],
    ],
    position: [
        ["center center", "居中"],
        ["center top", "顶部居中"],
        ["center bottom", "底部居中"],
        ["left center", "左侧居中"],
        ["right center", "右侧居中"],
    ],
}
const descriptions: Record<string, string> = {
    appearance: "分别调整浅色和深色界面。",
    animatedMan: "控制后台动画小人的显示。",
    utilities: "设置 IP 检测入口和时间显示。",
}
export default function DashboardAppearancePage() {
    const { mutate } = useSetting(),
        { profile, loading } = useAuth()
    const [saved, setSaved] = useState<State>(),
        [config, setConfig] = useState(() => normalizeDashboard())
    const [source, setSource] = useState(""),
        [imported, setImported] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [reading, setReading] = useState(true)
    const [query, setQuery] = useState(""),
        [group, setGroup] = useState("all"),
        request = useRef(0)
    const adopt = useCallback((s: State) => {
        setSaved(s)
        setConfig(normalizeDashboard(s.config))
        setSource(s.custom_code || s.archived_code || "")
        setImported("")
        setError("")
    }, [])
    const load = useCallback(async () => {
        const id = ++request.current
        setReading(true)
        try {
            const s = await fetcher<State>(
                FetcherMethod.GET,
                "/api/v1/setting/dashboard-appearance",
            )
            if (id === request.current) adopt(s)
        } catch (e) {
            if (id === request.current) setError(String(e))
        } finally {
            if (id === request.current) setReading(false)
        }
    }, [adopt])
    useEffect(() => {
        if (profile?.role === 0) void load()
        return () => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request generation, not a DOM ref.
            request.current++
        }
    }, [profile?.role, load])
    const savedConfig = useMemo(() => normalizeDashboard(saved?.config), [saved?.config])
    const sourceDirty = !!saved && source !== (saved.custom_code || saved.archived_code || "")
    const dirty =
            !!saved &&
            (sourceDirty || !!imported || JSON.stringify(config) !== JSON.stringify(savedConfig)),
        validation = validateDashboard(config)
    if (loading) return null
    if (profile?.role !== 0) return <Navigate to="/dashboard/settings/api-tokens" replace />
    const patch = (key: string, value: DashboardAppearance["features"][string]) =>
        setConfig((c) => ({ ...c, features: { ...c.features, [key]: value } }))
    const update = (group: string, key: string, value: unknown) =>
        setConfig((c) => ({
            ...c,
            features: { ...c.features, [group]: { ...c.features[group], [key]: value } },
        }))
    const readSource = () => {
        try {
            if (saved?.custom_code && source !== saved.custom_code)
                throw Error("当前仍有仪表板自定义代码，请先读取现有代码，避免覆盖")
            setConfig(importDashboardCode(source))
            setImported(source)
            toast.info("配置已读取，保存后生效。")
        } catch (e) {
            toast.error(String(e))
        }
    }
    const exportSource = () => {
        const value = saved?.archived_code || saved?.custom_code || source
        if (!value) return
        const url = URL.createObjectURL(new Blob([value], { type: "text/plain;charset=utf-8" }))
        const a = document.createElement("a")
        a.href = url
        a.download = "nezha-dashboard-custom-code-backup.html"
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    const save = async () => {
        if (!saved || validation || busy || reading) return
        if (sourceDirty && source !== imported) {
            toast.error("请先读取旧代码配置，或撤销文本修改后再保存。")
            return
        }
        if (
            config.enabled &&
            saved.custom_code &&
            !imported &&
            !confirm("原仪表板自定义代码仍在运行，可能重复生效。建议先读取迁移。继续保存？")
        )
            return
        setBusy(true)
        try {
            const next = await fetcher<State>(
                FetcherMethod.PATCH,
                "/api/v1/setting/dashboard-appearance",
                {
                    revision: saved.revision,
                    config,
                    ...(imported
                        ? {
                              expected_custom_code: saved.custom_code,
                              remaining_custom_code: "",
                              source_code: imported,
                          }
                        : {}),
                },
            )
            adopt(next)
            await mutate()
            toast.success("后台美化设置已保存")
        } catch (e) {
            toast.error(
                String(e).includes("changed")
                    ? "配置已变化，请重新读取后再保存。"
                    : "保存失败：" + String(e),
            )
        } finally {
            setBusy(false)
        }
    }
    const visible = dashboardDefinitions.filter((d) => matchesSetting(d, query, group))
    return (
        <div className="space-y-6" data-settings-editor>
            <UnsavedChanges dirty={dirty} busy={busy} />
            <h1 className="text-2xl font-semibold">后台美化设置</h1>
            {saved && (
                <AppearancePreview scope="dashboard" config={config} validation={validation} />
            )}
            <fieldset disabled={busy || reading || !saved} className="space-y-6">
                <div className="rounded-lg border bg-card p-4 space-y-3">
                    <p>仅调整后台外观，保存后生效。</p>
                    <label className="flex items-center gap-3">
                        <Switch
                            aria-label="启用后台美化"
                            checked={config.enabled}
                            onCheckedChange={(enabled) => setConfig((c) => ({ ...c, enabled }))}
                        />
                        启用后台美化
                    </label>
                    <details>
                        <summary className="cursor-pointer">导入以前的外观设置</summary>
                        <div className="space-y-3 pt-3">
                            <p className="text-sm text-muted-foreground">
                                读取原有外观设置，不执行粘贴的脚本。保存后会备份并停用旧代码。
                            </p>
                            <Textarea
                                aria-label="原仪表板自定义代码"
                                rows={8}
                                value={source}
                                onChange={(e) => setSource(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={!source.trim()}
                                    onClick={readSource}
                                >
                                    读取旧代码配置
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={!source && !saved?.archived_code}
                                    onClick={exportSource}
                                >
                                    导出旧代码备份
                                </Button>
                            </div>
                        </div>
                    </details>
                    {imported && (
                        <p className="text-amber-600">
                            待保存：已读取原参数，旧代码将备份并停止执行。
                        </p>
                    )}
                </div>
                <SettingsFilter
                    query={query}
                    onQuery={setQuery}
                    group={group}
                    onGroup={setGroup}
                    count={visible.length}
                />
                {dashboardDefinitions.map((d) => (
                    <div key={d.key} hidden={!matchesSetting(d, query, group)}>
                        <AppearanceSection
                            title={d.title}
                            description={descriptions[d.key]}
                            changed={
                                JSON.stringify(config.features[d.key]) !==
                                JSON.stringify(savedConfig.features[d.key])
                            }
                            onReset={() => patch(d.key, normalizeDashboard().features[d.key])}
                            enabled={
                                d.key === "animatedMan"
                                    ? !config.features.animatedMan.enabled ||
                                      !config.features.animatedMan.disabled
                                    : config.features[d.key].enabled
                            }
                            onEnabledChange={(v) =>
                                d.key === "animatedMan"
                                    ? patch(d.key, { enabled: true, disabled: !v })
                                    : update(d.key, "enabled", v)
                            }
                        >
                            {d.key === "animatedMan" ? (
                                <p className="text-sm text-muted-foreground">
                                    打开开关显示动画小人，关闭后隐藏。
                                </p>
                            ) : (
                                <div className="grid gap-4 sm:grid-cols-2">
                                    {Object.entries(d.defaults)
                                        .filter(([key]) => key !== "enabled" && key !== "oldTitle")
                                        .map(([key, sample]) => {
                                            const label = (
                                                    d.labels as unknown as Record<string, string>
                                                )[key],
                                                value = config.features[d.key][key]
                                            if (typeof sample === "boolean")
                                                return (
                                                    <label
                                                        key={key}
                                                        className="flex items-center justify-between gap-3"
                                                    >
                                                        <span>{label}</span>
                                                        <Switch
                                                            aria-label={label}
                                                            checked={value}
                                                            onCheckedChange={(v) =>
                                                                update(d.key, key, v)
                                                            }
                                                        />
                                                    </label>
                                                )
                                            if (key.endsWith("Opacity"))
                                                return (
                                                    <label key={key} className="block space-y-2">
                                                        <span className="flex justify-between gap-2">
                                                            {label}
                                                            <output>
                                                                {Math.round(value * 100)}%
                                                            </output>
                                                        </span>
                                                        <input
                                                            className="w-full accent-primary"
                                                            aria-label={label}
                                                            type="range"
                                                            min={0}
                                                            max={100}
                                                            step={1}
                                                            value={Math.round(value * 100)}
                                                            onChange={(e) =>
                                                                update(
                                                                    d.key,
                                                                    key,
                                                                    Number(e.target.value) / 100,
                                                                )
                                                            }
                                                        />
                                                    </label>
                                                )
                                            if (key === "color")
                                                return (
                                                    <div key={key} className="space-y-1">
                                                        <label htmlFor="dashboard-font-color">
                                                            {label}
                                                        </label>
                                                        <div className="flex gap-2">
                                                            <input
                                                                aria-label="选择文字颜色"
                                                                type="color"
                                                                value={
                                                                    /^#[0-9a-f]{6}$/i.test(value)
                                                                        ? value
                                                                        : "#111111"
                                                                }
                                                                onChange={(e) =>
                                                                    update(
                                                                        d.key,
                                                                        key,
                                                                        e.target.value,
                                                                    )
                                                                }
                                                            />
                                                            <Input
                                                                id="dashboard-font-color"
                                                                value={value}
                                                                placeholder="跟随主题"
                                                                onChange={(e) =>
                                                                    update(
                                                                        d.key,
                                                                        key,
                                                                        e.target.value,
                                                                    )
                                                                }
                                                            />
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                onClick={() =>
                                                                    update(d.key, key, "")
                                                                }
                                                            >
                                                                重置
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )
                                            const options =
                                                d.key === "background" ? choices[key] : undefined
                                            return (
                                                <label
                                                    key={key}
                                                    className="block min-w-0 space-y-1"
                                                >
                                                    <span>{label}</span>
                                                    {options ? (
                                                        <select
                                                            aria-label={label}
                                                            className="w-full rounded border bg-background p-2"
                                                            value={value}
                                                            onChange={(e) =>
                                                                update(d.key, key, e.target.value)
                                                            }
                                                        >
                                                            {!options.some(
                                                                ([v]) => v === value,
                                                            ) && (
                                                                <option value={value}>
                                                                    {value}
                                                                </option>
                                                            )}
                                                            {options.map(([v, text]) => (
                                                                <option key={v} value={v}>
                                                                    {text}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <Input
                                                            aria-label={label}
                                                            type={
                                                                typeof sample === "number"
                                                                    ? "number"
                                                                    : "text"
                                                            }
                                                            min={
                                                                key === "shatterCount"
                                                                    ? 1
                                                                    : undefined
                                                            }
                                                            max={
                                                                key === "shatterCount"
                                                                    ? 100
                                                                    : undefined
                                                            }
                                                            step={1}
                                                            value={value}
                                                            onChange={(e) =>
                                                                update(
                                                                    d.key,
                                                                    key,
                                                                    typeof sample === "number"
                                                                        ? Number(e.target.value)
                                                                        : e.target.value,
                                                                )
                                                            }
                                                        />
                                                    )}
                                                </label>
                                            )
                                        })}
                                </div>
                            )}
                        </AppearanceSection>
                    </div>
                ))}
                {!visible.length && (
                    <p className="py-6 text-center text-muted-foreground">
                        没有匹配的设置，请尝试其他关键词。
                    </p>
                )}
            </fieldset>
            {error && (
                <p role="alert" className="text-red-500">
                    {error}
                </p>
            )}
            <SettingsSaveBar
                label="保存后台美化设置"
                ready={!!saved}
                dirty={dirty}
                busy={busy}
                reading={reading}
                validation={validation}
                onSave={() => void save()}
                onUndo={() => {
                    if (saved) adopt(saved)
                }}
                onReload={() => {
                    if (!dirty || confirm("放弃未保存修改并重新读取？")) void load()
                }}
            />
        </div>
    )
}
