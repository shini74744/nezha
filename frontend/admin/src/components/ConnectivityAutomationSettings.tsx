import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useEffect, useState } from "react"
import SettingHelp from "./SettingHelp"

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
            className="w-full max-w-5xl rounded-lg border bg-card px-4 py-3 space-y-2"
            aria-label={bgp ? "BGP 自动检测设置" : "自动检测设置"}
        >
            <div className="flex items-center gap-1">
                <h2 className="font-semibold">{bgp ? "BGP 自动检测与记录" : "自动检测与记录"}</h2>
                <SettingHelp label={bgp ? "BGP 自动检测与记录" : "自动检测与记录"}>
                    {bgp ? "设置 BGP 的检测间隔和记录保留时间。" : "连通性与流媒体共用检测间隔和记录保留时间。"}
                    记录到期后自动清理，缩短保留时间会清理超期记录。
                </SettingHelp>
            </div>
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
                    <div className="grid grid-cols-2 items-center gap-x-4 gap-y-3 sm:flex sm:flex-wrap">
                        <div className="col-span-2 flex items-center justify-between gap-3 text-sm sm:mr-2 sm:justify-start">
                            <span className="inline-flex items-center gap-1">
                                自动检测
                                <SettingHelp label={bgp ? "BGP 自动检测" : "自动检测"}>
                                    开启后按北京时间整点周期自动检测在线节点，并分批完成。关闭后停止自动检测，已有记录仍按保留时间清理。手动检测不受此开关影响。
                                </SettingHelp>
                            </span>
                            <Switch
                                aria-label={bgp ? "BGP 自动检测" : "自动检测"}
                                checked={draft.enabled}
                                disabled={busy}
                                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                            />
                        </div>
                        <label className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
                            <span>检测间隔（小时）</span>
                            <Input
                                aria-label={bgp ? "BGP 检测间隔（小时）" : "检测间隔（小时）"}
                                className="h-9 w-full sm:w-20"
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
                        <label className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
                            <span>记录保留（天）</span>
                            <Input
                                aria-label={bgp ? "BGP 记录保留（天）" : "记录保留（天）"}
                                className="h-9 w-full sm:w-20"
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
                        <Button
                            size="sm"
                            className="col-span-2 h-9 justify-self-end sm:ml-auto"
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
