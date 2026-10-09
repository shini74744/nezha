import { FetcherMethod, fetcher } from "@/api/api"
import { AppearanceSection } from "@/components/appearance-section"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useCallback, useEffect, useState } from "react"

type Target = {
    id: string
    name: string
    carrier: string
    ipv4: string
    ipv6: string
    enabled: boolean
}
type Policy = {
    revision: string
    enabled: boolean
    interval_hours: number
    retention_days: number
    protocol: string
    targets: Target[]
}
const endpoint = "/api/v1/setting/return-route"
export default function ReturnRouteSettings() {
    const [saved, setSaved] = useState<Policy>(),
        [draft, setDraft] = useState<Policy>(),
        [busy, setBusy] = useState(false),
        [reading, setReading] = useState(false),
        [error, setError] = useState("")
    const dirty = !!draft && JSON.stringify(saved) !== JSON.stringify(draft)
    const adopt = (p: Policy) => {
        if (!Array.isArray(p?.targets)) throw Error("回程配置无效")
        setSaved(p)
        setDraft(p)
    }
    const load = useCallback(async () => {
        setReading(true)
        setError("")
        try {
            adopt(await fetcher<Policy>(FetcherMethod.GET, endpoint))
        } catch (e) {
            setError("读取回程设置失败：" + String(e))
        } finally {
            setReading(false)
        }
    }, [])
    useEffect(() => {
        void load()
    }, [load])
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [dirty])
    const invalid =
        !draft ||
        !Number.isInteger(draft.interval_hours) ||
        draft.interval_hours < 1 ||
        draft.interval_hours > 24 ||
        !Number.isInteger(draft.retention_days) ||
        draft.retention_days < 1 ||
        draft.retention_days > 30 ||
        draft.targets.length < 1 ||
        draft.targets.length > 12 ||
        draft.targets.some((t) => !t.name.trim() || !t.carrier.trim() || (!t.ipv4 && !t.ipv6))
    const save = async () => {
        if (!draft || invalid || busy) return
        setBusy(true)
        setError("")
        try {
            adopt(await fetcher<Policy>(FetcherMethod.PUT, endpoint, draft))
        } catch (e) {
            setError("保存回程设置失败：" + String(e))
        } finally {
            setBusy(false)
        }
    }
    const patchTarget = (id: string, patch: Partial<Target>) =>
        draft &&
        setDraft({
            ...draft,
            targets: draft.targets.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })
    return (
        <section className="w-full max-w-5xl min-w-0 space-y-4" aria-label="回程设置">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-semibold">回程检测与记录</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        每天从北京时间 00:00 起算；例如每 6 小时对应 00、06、12、18 点。跨天重新对齐，排队不改变快照所属周期。
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        disabled={busy || reading}
                        onClick={() => {
                            if (!dirty || window.confirm("放弃未保存修改并重新加载？")) void load()
                        }}
                    >
                        重新读取回程设置
                    </Button>
                    <Button
                        disabled={busy || reading || invalid || !dirty}
                        onClick={() => void save()}
                    >
                        {busy ? "保存中…" : "保存回程设置"}
                    </Button>
                </div>
            </div>
            {error && (
                <p role="alert" className="text-sm text-destructive break-words">
                    {error}
                </p>
            )}
            {reading && !draft ? (
                <p role="status">正在读取回程设置…</p>
            ) : (
                draft && (
                    <fieldset disabled={busy || reading} className="min-w-0 space-y-4">
                        <div className="rounded-lg border bg-card p-4 space-y-4">
                            <label className="flex items-center justify-between gap-3">
                                <span>回程自动检测</span>
                                <Switch
                                    aria-label="回程自动检测"
                                    checked={draft.enabled}
                                    onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                                />
                            </label>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <label className="min-w-0 space-y-1 text-sm">
                                    <span>检测间隔（小时）</span>
                                    <Input
                                        aria-label="回程检测间隔（小时）"
                                        type="number"
                                        min={1}
                                        max={24}
                                        value={draft.interval_hours}
                                        onChange={(e) =>
                                            setDraft({
                                                ...draft,
                                                interval_hours: Number(e.target.value),
                                            })
                                        }
                                    />
                                </label>
                                <label className="min-w-0 space-y-1 text-sm">
                                    <span>记录保留（天）</span>
                                    <Input
                                        aria-label="回程记录保留（天）"
                                        type="number"
                                        min={1}
                                        max={30}
                                        value={draft.retention_days}
                                        onChange={(e) =>
                                            setDraft({
                                                ...draft,
                                                retention_days: Number(e.target.value),
                                            })
                                        }
                                    />
                                </label>
                                <label className="min-w-0 space-y-1 text-sm">
                                    <span>检测协议</span>
                                    <select
                                        aria-label="回程检测协议"
                                        className="h-10 w-full min-w-0 rounded-md border bg-background px-3"
                                        value={draft.protocol}
                                        onChange={(e) =>
                                            setDraft({ ...draft, protocol: e.target.value })
                                        }
                                    >
                                        <option value="tcp">TCP</option>
                                        <option value="icmp">ICMP</option>
                                        <option value="udp">UDP</option>
                                    </select>
                                </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                按北京时间周期分批检测在线节点。关闭自动检测不影响手动检测；到期记录自动清理。
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-semibold">
                                回程检测点{" "}
                                <span className="text-sm font-normal text-muted-foreground">
                                    {draft.targets.length} / 12
                                </span>
                            </h3>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={draft.targets.length >= 12}
                                onClick={() =>
                                    setDraft({
                                        ...draft,
                                        targets: [
                                            ...draft.targets,
                                            {
                                                id:
                                                    "target-" +
                                                    Date.now().toString(36) +
                                                    "-" +
                                                    Math.random().toString(36).slice(2, 7),
                                                name: "新地区",
                                                carrier: "运营商",
                                                ipv4: "",
                                                ipv6: "",
                                                enabled: true,
                                            },
                                        ],
                                    })
                                }
                            >
                                添加回程检测点
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            填写公网 IPv4 / IPv6
                            地址；节点未上报的地址族自动略过。仅管理员可修改检测点。
                        </p>
                        <div className="space-y-3">
                            {draft.targets.map((t, i) => (
                                <div key={t.id} data-return-target={t.id}>
                                    <AppearanceSection
                                        title={t.name + " · " + t.carrier}
                                        description={t.enabled ? "已启用" : "已停用"}
                                        enabled={t.enabled}
                                        onEnabledChange={(enabled) =>
                                            patchTarget(t.id, { enabled })
                                        }
                                        headingLevel={3}
                                    >
                                        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                                            {(
                                                [
                                                    ["name", "地区"],
                                                    ["carrier", "运营商"],
                                                    ["ipv4", "IPv4 地址"],
                                                    ["ipv6", "IPv6 地址"],
                                                ] as const
                                            ).map(([key, label]) => (
                                                <label
                                                    key={key}
                                                    className="min-w-0 space-y-1 text-sm"
                                                >
                                                    <span>{label}</span>
                                                    <Input
                                                        aria-label={"回程" + label + " " + (i + 1)}
                                                        value={t[key]}
                                                        maxLength={
                                                            key === "name"
                                                                ? 30
                                                                : key === "carrier"
                                                                  ? 20
                                                                  : 45
                                                        }
                                                        onChange={(e) =>
                                                            patchTarget(t.id, {
                                                                [key]: e.target.value.trim(),
                                                            })
                                                        }
                                                    />
                                                </label>
                                            ))}
                                        </div>
                                        <div className="mt-3 flex justify-end">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={draft.targets.length <= 1}
                                                onClick={() =>
                                                    setDraft({
                                                        ...draft,
                                                        targets: draft.targets.filter(
                                                            (v) => v.id !== t.id,
                                                        ),
                                                    })
                                                }
                                            >
                                                删除回程检测点 {i + 1}
                                            </Button>
                                        </div>
                                    </AppearanceSection>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            节点需允许命令执行。Linux 节点首次检测按需下载并校验独立
                            NextTrace；不运行硬件或带宽测试。
                        </p>
                    </fieldset>
                )
            )}
        </section>
    )
}
