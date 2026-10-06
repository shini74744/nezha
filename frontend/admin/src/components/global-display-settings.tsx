import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import SettingHelp from "@/components/SettingHelp"
import { useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"

type DisplaySettings = { statistics_split: boolean; detail_network_split: boolean }
const options = [
    {
        key: "statistics_split",
        title: "统计显示拆分",
        description:
            "开启后分别查看流量统计和在线率；关闭后合并显示。",
    },
    {
        key: "detail_network_split",
        title: "详细网络拆分",
        description: "开启后，详情与网络分标签显示；关闭后，网络监控合并到详情页，并隐藏网络标签。",
    },
] as const
const endpoint = "/api/v1/setting/display"

export function GlobalDisplaySettings() {
    const id = useId()
    const [saved, setSaved] = useState<DisplaySettings>()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const request = useRef(0)
    const load = async () => {
        const current = ++request.current
        setBusy(true)
        setError("")
        try {
            const value = await fetcher<DisplaySettings>(FetcherMethod.GET, endpoint)
            if (current === request.current) setSaved(value)
        } catch {
            if (current === request.current) setError("读取失败，请重新读取。")
        } finally {
            if (current === request.current) setBusy(false)
        }
    }
    useEffect(() => {
        void load()
        return () => {
            request.current++
        }
    }, [])
    const save = async (key: keyof DisplaySettings, enabled: boolean) => {
        if (!saved || busy) return
        const current = ++request.current
        setBusy(true)
        setError("")
        try {
            const value = await fetcher<DisplaySettings>(FetcherMethod.PATCH, endpoint, {
                [key]: enabled,
            })
            if (current !== request.current) return
            setSaved(value)
            toast.success("全站显示设置已保存")
        } catch {
            if (current === request.current) setError("保存失败，开关状态未更改，请重试。")
        } finally {
            if (current === request.current) setBusy(false)
        }
    }
    return (
        <section aria-label="全站显示" className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">全站显示</h2>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    主题通用
                </span>
            </div>
            {options.map((option) => (
                <div key={option.key} className="flex items-center justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1">
                            <label htmlFor={id + option.key} className="text-sm font-medium">{option.title}</label>
                            <SettingHelp label={option.title}>{option.description}</SettingHelp>
                        </div>
                    </div>
                    <Switch
                        id={id + option.key}
                        checked={saved?.[option.key] ?? false}
                        disabled={!saved || busy}
                        onCheckedChange={(value) => save(option.key, value)}
                    />
                </div>
            ))}
            <p className="text-xs text-muted-foreground">
                适用于全部主题，修改后自动保存。
            </p>
            {busy && (
                <p role="status" className="text-sm text-muted-foreground">
                    {saved ? "保存中…" : "正在读取…"}
                </p>
            )}
            {error && (
                <div className="flex flex-wrap items-center gap-2">
                    <p role="alert" className="text-sm text-red-500">
                        {error}
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={load}
                    >
                        重新读取全站设置
                    </Button>
                </div>
            )}
        </section>
    )
}
