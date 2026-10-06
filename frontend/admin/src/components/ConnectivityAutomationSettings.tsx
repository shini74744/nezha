import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useEffect, useState } from "react"

type Policy = { enabled: boolean; interval_hours: number; retention_days: number; revision: string }
export default function ConnectivityAutomationSettings({
    kind = "connectivity",
}: {
    kind?: "connectivity" | "bgp"
}) {
    const endpoint = `/api/v1/setting/${kind}/automation`
    const bgp = kind === "bgp"
    const [saved, setSaved] = useState<Policy>(),
        [draft, setDraft] = useState<Policy>()
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("")
    const load = async () => {
        setError("")
        try {
            const p = await fetcher<Policy>(FetcherMethod.GET, endpoint)
            setSaved(p)
            setDraft(p)
        } catch {
            setError("读取自动检测设置失败")
        }
    }
    useEffect(() => {
        void load()
    }, [kind])
    const invalid =
        !draft ||
        !Number.isInteger(draft.interval_hours) ||
        draft.interval_hours < 1 ||
        draft.interval_hours > 24 ||
        !Number.isInteger(draft.retention_days) ||
        draft.retention_days < 1 ||
        draft.retention_days > 30
    const save = async () => {
        if (!draft || invalid || busy) return
        setBusy(true)
        setError("")
        try {
            const p = await fetcher<Policy>(FetcherMethod.PUT, endpoint, draft)
            setSaved(p)
            setDraft(p)
        } catch (e) {
            setError("保存自动检测设置失败：" + String(e))
        } finally {
            setBusy(false)
        }
    }
    return (
        <section
            className="rounded-lg border bg-card p-4 space-y-3"
            aria-label={bgp ? "BGP 自动检测设置" : "自动检测设置"}
        >
            <h2 className="font-semibold">{bgp ? "BGP 自动检测与记录" : "自动检测与记录"}</h2>
            <p className="text-xs text-muted-foreground">
                {bgp
                    ? "独立管理 BGP 路由观测，遵循服务器的 BGP 开关。查询节点的 IPv4 / IPv6 公网地址；仅管理员可查看 IP 和网段，访客只读拓扑。"
                    : "连通性与流媒体共用此间隔与保留时间，各自遵循服务器编辑中的开关，由节点 Agent 发起。BGP 使用独立设置。"}
                只自动检测在线节点并分批错开；重启后记录仍保留。
            </p>
            {error && (
                <div role="alert" className="text-sm text-destructive">
                    {error}
                    <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
                        重新读取设置
                    </Button>
                </div>
            )}
            {draft ? (
                <>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <label className="flex items-center justify-between gap-3 text-sm">
                            自动检测
                            <Switch
                                aria-label={bgp ? "BGP 自动检测" : "自动检测"}
                                checked={draft.enabled}
                                disabled={busy}
                                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                            />
                        </label>
                        <label className="text-sm space-y-1">
                            <span>检测间隔（小时）</span>
                            <Input
                                aria-label={bgp ? "BGP 检测间隔（小时）" : "检测间隔（小时）"}
                                type="number"
                                min={1}
                                max={24}
                                value={draft.interval_hours}
                                disabled={busy}
                                onChange={(e) =>
                                    setDraft({ ...draft, interval_hours: Number(e.target.value) })
                                }
                            />
                        </label>
                        <label className="text-sm space-y-1">
                            <span>记录保留（天）</span>
                            <Input
                                aria-label={bgp ? "BGP 记录保留（天）" : "记录保留（天）"}
                                type="number"
                                min={1}
                                max={30}
                                value={draft.retention_days}
                                disabled={busy}
                                onChange={(e) =>
                                    setDraft({ ...draft, retention_days: Number(e.target.value) })
                                }
                            />
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                            默认每 {bgp ? 6 : 2} 小时检测、保留 1 天。
                            {bgp
                                ? "IPv4 / IPv6 分别保存于同一批快照。"
                                : "连通性每项 3 次，流媒体按协议各检测一次。"}
                            缩短保留时间后，超期记录将被清理。
                        </p>
                        <Button
                            disabled={
                                busy || invalid || JSON.stringify(saved) === JSON.stringify(draft)
                            }
                            onClick={() => void save()}
                        >
                            {busy ? "保存中…" : "保存自动检测设置"}
                        </Button>
                    </div>
                </>
            ) : (
                !error && <p role="status">正在读取自动检测设置…</p>
            )}
        </section>
    )
}
