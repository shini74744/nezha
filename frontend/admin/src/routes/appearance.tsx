import { FontSettings } from "@/components/font-settings"
import { AppearanceOptionsSettings } from "@/components/appearance-options-settings"
import { FetcherMethod, fetcher } from "@/api/api"
import AppearancePreview from "@/components/AppearancePreview"
import SettingHelp from "@/components/SettingHelp"
import SettingsFilter, { appearanceGroups, matchesSetting } from "@/components/SettingsFilter"
import SettingsSaveBar from "@/components/SettingsSaveBar"
import UnsavedChanges from "@/components/UnsavedChanges"
import { AppearanceSection } from "@/components/appearance-section"
import { BackgroundSettings } from "@/components/background-settings"
import { GlobalDisplaySettings } from "@/components/global-display-settings"
import { ClockSettings, GreetingSettings } from "@/components/greeting-clock-settings"
import { SakanaCharacters } from "@/components/sakana-characters"
import { SpeedSettings } from "@/components/speed-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { VisitorIPSettings } from "@/components/visitor-ip-settings"
import { useAuth } from "@/hooks/useAuth"
import { readAppearance } from "@/lib/appearance"
import {
    AppearanceConfig,
    Feature,
    FeatureDefinition,
    definitions,
    normalize,
} from "@/lib/appearance-config"
import { legacyFingerprint } from "@/lib/appearance-migration"
import {
    type AppearanceTheme,
    appearanceEndpoint,
    appearancePayload,
    appearanceThemeNames,
    doraDefinitions,
    normalizeThemeAppearance,
    validateThemeConfig,
} from "@/lib/theme-appearance"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import { toast } from "sonner"

const effectKeys = new Set(["network", "snow", "fragments", "heart", "sakura", "stars"])
type State = {
    config: AppearanceConfig
    custom_code: string
    revision: string
    current_template: string
}
export default function AppearancePage() {
    const { profile, loading } = useAuth()
    const [theme, setTheme] = useState<AppearanceTheme>("user-dist")
    const [dirty, setDirty] = useState(false),
        [busy, setBusy] = useState(false)
    if (loading) return null
    if (profile?.role !== 0) return <Navigate to="/dashboard/settings/api-tokens" replace />
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">美化设置</h1>
                <label className="flex items-center gap-2 text-sm">
                    设置主题
                    <select
                        aria-label="设置主题"
                        className="rounded border bg-background px-3 py-2"
                        value={theme}
                        disabled={busy}
                        onChange={(e) => {
                            const next = e.target.value as AppearanceTheme
                            if (next === theme) return
                            if (
                                dirty &&
                                !window.confirm("当前主题有未保存修改，放弃修改并切换设置主题？")
                            )
                                return
                            setDirty(false)
                            setBusy(true)
                            setTheme(next)
                        }}
                    >
                        <option value="user-dist">默认主题</option>
                        <option value="paper-dist">纸间 · Paper</option>
                        <option value="doraemon-dist">哆啦 A 梦</option>
                    </select>
                </label>
            </div>
            <GlobalDisplaySettings />
            <ThemeAppearanceEditor
                key={theme}
                theme={theme}
                onDirtyChange={setDirty}
                onBusyChange={setBusy}
            />
        </div>
    )
}
function ThemeAppearanceEditor({
    theme,
    onDirtyChange,
    onBusyChange,
}: {
    theme: AppearanceTheme
    onDirtyChange: (value: boolean) => void
    onBusyChange: (value: boolean) => void
}) {
    const { profile, loading } = useAuth()
    const isDefault = theme === "user-dist"
    const endpoint = appearanceEndpoint(theme)
    const themeName = appearanceThemeNames[theme]
    const [saved, setSaved] = useState<State>()
    const [config, setConfig] = useState<AppearanceConfig>(() => normalizeThemeAppearance(theme))
    const [migrate, setMigrate] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [reading, setReading] = useState(true)
    const [query, setQuery] = useState(""),
        [group, setGroup] = useState("all")
    const requestId = useRef(0)
    const adopt = useCallback(
        (value: State) => {
            setSaved(value)
            setConfig(normalizeThemeAppearance(theme, value.config))
            setMigrate(false)
            setError("")
        },
        [theme],
    )
    const load = useCallback(async () => {
        const id = ++requestId.current
        setReading(true)
        try {
            const value = await fetcher<State>(FetcherMethod.GET, endpoint)
            if (id === requestId.current) adopt(value)
        } catch (e) {
            if (id === requestId.current) setError(String(e))
        } finally {
            if (id === requestId.current) setReading(false)
        }
    }, [endpoint, adopt])
    useEffect(() => {
        if (profile?.role === 0) void load()
        return () => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the latest request generation; this ref is not a DOM node.
            requestId.current++
        }
    }, [profile?.role, load])
    const savedConfig = useMemo(
        () => normalizeThemeAppearance(theme, saved?.config),
        [theme, saved?.config],
    )
    const dirty =
        !!saved &&
        (migrate ||
            JSON.stringify(appearancePayload(theme, config)) !==
                JSON.stringify(appearancePayload(theme, savedConfig)))
    const validation = validateThemeConfig(theme, config)
    const activeDefinitions = theme !== "doraemon-dist" ? definitions : doraDefinitions
    useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
    useEffect(() => onBusyChange(busy || reading), [busy, reading, onBusyChange])

    if (loading) return null
    if (profile?.role !== 0) return <Navigate to="/dashboard/settings/api-tokens" replace />
    const patch = (key: string, value: Feature) =>
        setConfig((c) => ({ ...c, features: { ...c.features, [key]: value } }))
    const update = (group: string, key: string, value: unknown) =>
        patch(group, { ...config.features[group], [key]: value })
    const exportCode = () => {
        if (!saved) return
        const u = URL.createObjectURL(
            new Blob([saved.custom_code], { type: "text/plain;charset=utf-8" }),
        )
        const a = document.createElement("a")
        a.href = u
        a.download = "nezha-original-custom-code.html"
        a.click()
        setTimeout(() => URL.revokeObjectURL(u), 1000)
    }
    const importLegacy = async () => {
        if (!saved) return
        const hash = Array.from(
            new Uint8Array(
                await crypto.subtle.digest("SHA-256", new TextEncoder().encode(saved.custom_code)),
            ),
            (b) => b.toString(16).padStart(2, "0"),
        ).join("")
        if (hash !== legacyFingerprint) {
            toast.error("当前自定义代码与已核对版本不同，不能安全自动替换。原代码保持不变。")
            return
        }
        const old = readAppearance(saved.custom_code).config
        const next = normalize(config)
        next.enabled = true
        if (old) {
            for (const k of ["sponsor", "video", "analytics"])
                if (old[k]) next.features[k] = { ...next.features[k], ...old[k] }
            for (const k of ["heart", "sakura", "live2d", "stars"])
                next.features[k].enabled = !!old.effects?.[k]
        }
        setConfig(next)
        setMigrate(true)
        toast.info("已读入原有配置。保存时会归档原始代码并启用内置功能，避免重复加载。")
    }
    const save = async () => {
        if (!saved || validation || busy || reading) return
        if (
            isDefault &&
            config.enabled &&
            saved.custom_code &&
            !migrate &&
            !window.confirm("现有自定义代码仍会执行，可能与内置功能重复。确认继续保存？")
        )
            return
        const submitted = structuredClone(appearancePayload(theme, config))
        setBusy(true)
        try {
            const value = await fetcher<State>(FetcherMethod.PATCH, endpoint, {
                revision: saved.revision,
                config: submitted,
                ...(migrate
                    ? { expected_custom_code: saved.custom_code, remaining_custom_code: "" }
                    : {}),
            })
            setSaved(value)
            setConfig((current) =>
                JSON.stringify(appearancePayload(theme, current)) === JSON.stringify(submitted)
                    ? normalizeThemeAppearance(theme, value.config)
                    : current,
            )
            setMigrate(false)
            setError("")
            toast.success(themeName + "美化设置已保存，仅影响该主题")
        } catch (e) {
            toast.error(
                String(e).includes("changed")
                    ? "配置已被其他页面修改，请重新读取后再保存。"
                    : "保存失败：" + String(e),
            )
        } finally {
            setBusy(false)
        }
    }
    const renderField = (group: string, key: string, value: any) => {
        const d = activeDefinitions.find((d) => d.key === group)!,
            label = d.labels[key] || key
        if (group === "dark" && key === "mode")
            return (
                <label key={key} className="block space-y-2">
                    <span>{label}</span>
                    <select
                        aria-label={label}
                        className="w-full rounded border bg-background p-2"
                        value={value}
                        onChange={(e) => update(group, key, e.target.value)}
                    >
                        <option value="system">自动（跟随设备系统）</option>
                        <option value="light">白天（浅色）</option>
                        <option value="dark">黑夜（深色）</option>
                    </select>
                    <span className="block text-sm text-muted-foreground">
                        自动模式随设备的明暗设置实时切换。关闭此功能后不干预前台原有主题选择。
                    </span>
                </label>
            )
        if (group === "live2d" && key === "customCharacters")
            return (
                <SakanaCharacters
                    key={key}
                    value={config.features.live2d}
                    onChange={(v) => patch("live2d", v)}
                />
            )
        if (group === "live2d" && (key === "provider" || key === "character"))
            return (
                <label key={key} className="block space-y-1">
                    <span>{label}</span>
                    <select
                        aria-label={label}
                        className="w-full rounded border bg-background p-2"
                        value={value}
                        onChange={(e) => update(group, key, e.target.value)}
                    >
                        {(key === "provider"
                            ? [
                                  ["live2d", "原 Live2D"],
                                  ["sakana", "Sakana Widget（石蒜模拟器）"],
                              ]
                            : [
                                  ["chisato", "千束 Chisato"],
                                  ["takina", "泷奈 Takina"],
                                  ...config.features.live2d.customCharacters.map((r: any) => [
                                      r.id,
                                      r.name || "未命名角色",
                                  ]),
                              ]
                        ).map(([v, text]) => (
                            <option key={v} value={v}>
                                {text}
                            </option>
                        ))}
                    </select>
                </label>
            )
        if (typeof value === "boolean")
            return (
                <label key={key} className="flex items-center justify-between gap-3">
                    <span>{label}</span>
                    <Switch checked={value} onCheckedChange={(v) => update(group, key, v)} />
                </label>
            )
        if (Array.isArray(value)) {
            const sample = (d.defaults[key] as any[])[0]
            if (typeof sample === "string")
                return (
                    <label key={key} className="block space-y-1 sm:col-span-2">
                        <span>{label}（每行一项）</span>
                        <Textarea
                            value={value.join("\n")}
                            onChange={(e) =>
                                update(group, key, e.target.value.split("\n").filter(Boolean))
                            }
                        />
                    </label>
                )
            const columns = Object.keys(sample || {})
            return (
                <div key={key} className="sm:col-span-2 space-y-2">
                    <p>{label}</p>
                    {value.map((row: any, i: number) => (
                        <div key={i} className="rounded border p-3 space-y-2">
                            {columns.map((field) => (
                                <label key={field} className="block space-y-1">
                                    <span>
                                        {(
                                            {
                                                name: "名称",
                                                url: "链接",
                                                link: "链接",
                                                logo: "Logo 图片",
                                                src: "资源地址",
                                                type: "类型",
                                            } as Record<string, string>
                                        )[field] || field}
                                    </span>
                                    {field === "type" ? (
                                        <select
                                            className="w-full rounded border bg-background p-2"
                                            value={row[field]}
                                            onChange={(e) =>
                                                update(
                                                    group,
                                                    key,
                                                    value.map((r: any, j: number) =>
                                                        i === j
                                                            ? { ...r, [field]: e.target.value }
                                                            : r,
                                                    ),
                                                )
                                            }
                                        >
                                            <option value="image">图片</option>
                                            <option value="video">视频</option>
                                        </select>
                                    ) : (
                                        <Input
                                            value={row[field] ?? ""}
                                            onChange={(e) =>
                                                update(
                                                    group,
                                                    key,
                                                    value.map((r: any, j: number) =>
                                                        i === j
                                                            ? { ...r, [field]: e.target.value }
                                                            : r,
                                                    ),
                                                )
                                            }
                                        />
                                    )}
                                </label>
                            ))}
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={i === 0}
                                    onClick={() => {
                                        const n = [...value]
                                        ;[n[i - 1], n[i]] = [n[i], n[i - 1]]
                                        update(group, key, n)
                                    }}
                                >
                                    上移
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        update(
                                            group,
                                            key,
                                            value.filter((_: any, j: number) => j !== i),
                                        )
                                    }
                                >
                                    移除
                                </Button>
                            </div>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            update(group, key, [
                                ...value,
                                Object.fromEntries(
                                    columns.map((c) => [c, c === "type" ? "image" : ""]),
                                ),
                            ])
                        }
                    >
                        添加
                    </Button>
                </div>
            )
        }
        return (
            <label key={key} className="block min-w-0 space-y-1">
                <span>{label}</span>
                <Input
                    type={typeof value === "number" ? "number" : "text"}
                    step="any"
                    min={d.constraints[key]?.[0]}
                    max={d.constraints[key]?.[1]}
                    value={value ?? ""}
                    onChange={(e) =>
                        update(
                            group,
                            key,
                            typeof value === "number" ? Number(e.target.value) : e.target.value,
                        )
                    }
                />
            </label>
        )
    }
    const visibleDefinitions = activeDefinitions.filter(
        (d) => d.key !== "video" && matchesSetting(d, query, group),
    )
    const renderFeature = (d: FeatureDefinition) => (
        <AppearanceSection
            onReset={() => {
                const defaults = normalizeThemeAppearance(theme)
                patch(d.key, defaults.features[d.key])
                if (d.key === "background") patch("video", defaults.features.video)
            }}
            changed={
                JSON.stringify(config.features[d.key]) !==
                JSON.stringify(savedConfig.features[d.key])
            }
            key={d.key}
            headingLevel={effectKeys.has(d.key) ? 3 : 2}
            title={d.title}
            description={d.description}
            enabled={config.features[d.key].enabled}
            onEnabledChange={(v) => update(d.key, "enabled", v)}
        >
            {d.key === "font" && theme !== "doraemon-dist" ? (
                <FontSettings value={config.features.font} onChange={value=>patch("font",value)}/>
            ) : ["heart","stars","sakura","links"].includes(d.key) && theme !== "doraemon-dist" ? (
                <AppearanceOptionsSettings definition={d} value={config.features[d.key]} onChange={value=>patch(d.key,value)}/>
            ) : d.key === "visitorIP" ? (
                <VisitorIPSettings
                    value={config.features.visitorIP}
                    onChange={(value) => patch("visitorIP", value)}
                />
            ) : d.key === "speed" ? (
                <SpeedSettings
                    value={config.features.speed}
                    onChange={(value) => patch("speed", value)}
                />
            ) : d.key === "greeting" ? (
                <GreetingSettings
                    value={config.features.greeting}
                    onChange={(value) => patch("greeting", value)}
                />
            ) : d.key === "clock" ? (
                <ClockSettings
                    value={config.features.clock}
                    onChange={(value) => patch("clock", value)}
                />
            ) : d.key === "background" ? (
                <BackgroundSettings
                    value={config.features.background}
                    sound={config.features.video}
                    onChange={(value) => patch("background", value)}
                    onSoundChange={(value) => patch("video", value)}
                />
            ) : Object.keys(d.defaults).length > 1 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                    {(d.key === "runtime" ? ["prefix", "startDate"] : Object.keys(d.defaults))
                        .filter(
                            (key) =>
                                key !== "enabled" &&
                                !(
                                    d.key === "sponsor" &&
                                    ["desktopTop", "mobileBottomThreshold"].includes(key)
                                ) &&
                                (d.key !== "live2d" ||
                                    key === "provider" ||
                                    (config.features.live2d.provider === "sakana"
                                        ? [
                                              "character",
                                              "customCharacters",
                                              "size",
                                              "controls",
                                              "autoMotion",
                                          ]
                                        : ["cdnPath", "tools"]
                                    ).includes(key)),
                        )
                        .map((key) =>
                            renderField(d.key, key, config.features[d.key][key] ?? d.defaults[key]),
                        )}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    此功能暂无额外参数，使用右侧开关启用或关闭。
                </p>
            )}
        </AppearanceSection>
    )
    return (
        <div className="space-y-6" data-settings-editor>
            <UnsavedChanges dirty={dirty} busy={busy} />
            {saved && <AppearancePreview scope={theme} config={config} validation={validation} />}
            <fieldset disabled={busy || reading || !saved} className="space-y-6">
                <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-1">
                        <h2 className="font-semibold">主题外观：{themeName}</h2>
                        <SettingHelp label="主题外观">
                            <p>
                                仅调整所选主题的外观，不会切换当前主题。修改后请点击“保存美化设置”。
                            </p>
                            <p>图片、视频、字体等外部资源需要网络连接。</p>
                        </SettingHelp>
                    </div>
                    {saved?.current_template && saved.current_template !== theme && (
                        <p className="text-amber-600">
                            当前未启用{themeName}，设置将在切换到该主题后生效。
                        </p>
                    )}
                    <label className="flex items-center gap-3">
                        <Switch
                            aria-label="启用内置美化"
                            disabled={!saved || reading || busy}
                            checked={config.enabled}
                            onCheckedChange={(enabled) => setConfig((c) => ({ ...c, enabled }))}
                        />
                        启用内置美化
                    </label>
                    {isDefault && saved?.custom_code && (
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={importLegacy}>
                                迁移已核对的原有美化
                            </Button>
                            <Button variant="outline" onClick={exportCode}>
                                导出原始代码备份
                            </Button>
                        </div>
                    )}
                    {migrate && (
                        <p className="text-amber-600">
                            本次保存将归档原始美化代码并停止旧脚本执行，避免与内置功能重复。
                        </p>
                    )}
                </div>
                {reading && <p role="status">正在读取{themeName}设置…</p>}
                {error && (
                    <p role="alert" className="text-red-500">
                        {error}
                    </p>
                )}
                <SettingsFilter
                    query={query}
                    onQuery={setQuery}
                    group={group}
                    onGroup={setGroup}
                    groups={appearanceGroups}
                    count={visibleDefinitions.length}
                />
                {saved &&
                    activeDefinitions
                        .filter((d) => d.key !== "video")
                        .map((d) => (
                            <div key={d.key} hidden={!matchesSetting(d, query, group)}>
                                {renderFeature(d)}
                            </div>
                        ))}
                {saved && !reading && !visibleDefinitions.length && (
                    <p className="py-6 text-center text-muted-foreground">
                        没有匹配的设置，请尝试其他关键词。
                    </p>
                )}
            </fieldset>
            <SettingsSaveBar
                label="保存美化设置"
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
                    if (!dirty || window.confirm("放弃未保存修改并重新读取？")) void load()
                }}
            />
        </div>
    )
}
