import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { fetcher, FetcherMethod, swrFetcher } from "@/api/api"
import { NotificationTab } from "@/components/notification-tab"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useAuth } from "@/hooks/useAuth"
import { useNotification } from "@/hooks/useNotfication"
import { remainingDaysClass } from "@/lib/server-expiry-color"
import { formatBillingTime } from "../../../shared/billing-time"

type Policy = { enabled: boolean; notification_group_id: number; days: number[] }
type ExpiryRow = {
    id: number; name: string; start_date: string; end_date: string; cycle: string; amount: string
    auto_renewal: boolean; status: string; expires_at: number; remaining_days: number
    latest_end_date: string; renewal_projected: boolean; renewal_warning: string
    delivery: { days: number; sent_at: number; last_error: string; attempts: number }[]
}
type ExpiryData = { config: Policy; servers: ExpiryRow[] }
export function parseReminderDays(value: string): number[] {
    const parts = value.trim().split(/[,，\s]+/)
    if (!value.trim() || parts.some(v => !/^\d+$/.test(v))) throw Error("请填写 0–365 的整数，以逗号分隔")
    const days = parts.map(Number)
    if (days.length > 20 || days.some(v => v > 365) || new Set(days).size !== days.length)
        throw Error("请填写 1–20 个不重复的 0–365 整数")
    return days.sort((a, b) => b - a)
}
const date = formatBillingTime
export default function ServerExpiryPage() {
    const { profile } = useAuth()
    const admin = profile?.role === 0
    const { data, error, mutate, isLoading } = useSWR<ExpiryData>(admin ? "/api/v1/server-expiry" : null, swrFetcher, { refreshInterval: 60000 })
    const { notifierGroup } = useNotification()
    const [config, setConfig] = useState<Policy>({ enabled: false, notification_group_id: 0, days: [7, 3, 1, 0] })
    const [days, setDays] = useState("7,3,1,0")
    const [search, setSearch] = useState("")
    const [onlyEligible, setOnlyEligible] = useState(true)
    const [saving, setSaving] = useState(false)
    const [dirty, setDirty] = useState(false)
    useEffect(() => {
        if (data && !dirty) { setConfig(data.config); setDays(data.config.days.join(",")) }
    }, [data, dirty])
    const eligible = data?.servers.filter(s => s.expires_at > 0) || []
    const rows = useMemo(() => (data?.servers || [])
        .filter(s => (!onlyEligible || s.expires_at > 0) && (s.name.includes(search) || String(s.id).includes(search)))
        .sort((a, b) => (a.expires_at || Infinity) - (b.expires_at || Infinity)), [data, onlyEligible, search])
    async function save() {
        try {
            const next = { ...config, days: parseReminderDays(days) }
            if (next.enabled && !next.notification_group_id) throw Error("启用前请选择通知组")
            setSaving(true)
            await fetcher(FetcherMethod.PUT, "/api/v1/server-expiry", next)
            setDirty(false)
            await mutate()
            toast.success("到期通知设置已保存")
        } catch (e) { toast.error(e instanceof Error ? e.message : "保存失败") }
        finally { setSaving(false) }
    }
    return <div className="px-3 pb-8 min-w-0">
        <NotificationTab className="mt-6 mb-5 w-full sm:max-w-2xl" />
        {!admin ? <p>仅管理员可管理服务器到期通知。</p> : <>
            <section className="rounded-lg border p-4 space-y-4">
                <h1 className="text-lg font-semibold">服务器到期通知</h1>
                <p className="text-sm text-muted-foreground">自动读取服务器编辑中的购买时间、到期时间、付款周期和价格，在线、离线机器均检查。未填写到期时间或设为永不过期的机器不通知。</p>
                <label className="flex items-center gap-2"><Checkbox aria-label="启用服务器到期通知" checked={config.enabled} disabled={isLoading || !!error || saving}
                    onCheckedChange={v => { setDirty(true); setConfig({ ...config, enabled: !!v }) }} />启用服务器到期通知</label>
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 min-w-0"><span>通知组</span>
                        <select aria-label="到期通知组" className="h-10 w-full rounded-md border bg-background px-3" value={config.notification_group_id}
                            disabled={saving || isLoading || !!error} onChange={e => { setDirty(true); setConfig({ ...config, notification_group_id: Number(e.target.value) }) }}>
                            <option value={0}>请选择通知组</option>
                            {notifierGroup?.map(n => <option key={n.group.id} value={n.group.id}>{n.group.name}</option>)}
                        </select>
                    </label>
                    <label className="space-y-2 min-w-0"><span>提前提醒天数</span>
                        <Input aria-label="提前提醒天数" value={days} disabled={saving || isLoading || !!error} onChange={e => { setDirty(true); setDays(e.target.value) }} />
                        <span className="block text-xs text-muted-foreground">逗号分隔，默认 7,3,1,0；0 表示到期时，按日期中的具体时分秒计算。</span>
                    </label>
                </div>
                <p className="text-xs text-muted-foreground">每分钟检查；每台机器、同一到期日期、每个阶段只提醒一次，重启后不会重复。按最新到期日期计算；启用时只补当前阶段，不连续补发过去阶段。到期超过 24 小时不补发。发送失败会重试。</p>
                <p className="text-xs text-muted-foreground">日期统一按北京时间推算；保留首次购买日期和原始到期日期。跟随服务器卡片的自动续费设置：勾选后按日、周、月、季、半年、年、两年或三年周期推算最新到期日期并提醒；未勾选按原始到期日期提醒，不代表实际付款；无法识别的自定义周期按原始到期日期提醒。</p>
                <Button disabled={saving || isLoading || !!error} onClick={save}>{saving ? "保存中…" : "保存到期通知设置"}</Button>
                {error && <p role="alert" className="text-red-500">加载失败：{error.message}</p>}
            </section>
            <section className="mt-5 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-semibold">服务器到期清单</h2>
                    <span className="text-xs text-muted-foreground">时间均为北京时间（UTC+8）</span>
                    <span className="text-sm text-muted-foreground">{eligible.length} 台已设置有效到期日期 · {(data?.servers.length || 0) - eligible.length} 台跳过</span>
                    <Button variant="outline" size="sm" onClick={() => mutate()} disabled={saving}>刷新清单</Button>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                    <Input aria-label="搜索服务器" placeholder="搜索名称或 ID" className="w-full sm:w-64" value={search} onChange={e => setSearch(e.target.value)} />
                    <label className="flex items-center gap-2 text-sm"><Checkbox aria-label="仅显示已设置到期时间" checked={onlyEligible} onCheckedChange={v => setOnlyEligible(!!v)} />仅显示已设置到期时间</label>
                </div>
                {isLoading ? <p>加载中…</p> : <div className="grid gap-3 lg:grid-cols-2">
                    {rows.map(s => <article key={s.id} className="border rounded-lg p-4 min-w-0 space-y-2">
                        <h3 className="font-medium break-words">{s.name} <span className="text-muted-foreground">#{s.id}</span></h3>
                        <div className="text-sm grid gap-1 break-words">
                            <p>首次购买日期：{date(s.start_date)}</p>
                            <p>原始到期日期：{s.expires_at ? date(s.end_date) : s.status}</p>
                            <p>最新到期日期：{s.expires_at ? date(s.latest_end_date || s.end_date) : "—"}{s.renewal_projected ? "（按周期推算）" : ""}</p>
                            <p>付款周期：{s.cycle || "未设置"} · 价格：{s.amount || "未设置"}</p>
                            <p className={s.status === "已到期" ? "text-red-500" : ""}>{s.expires_at ? (s.status === "已到期" ? "已到期" : <>剩余约 <span data-testid="expiry-days" className={remainingDaysClass(s.remaining_days)}>{s.remaining_days}</span> 天</>) : "不通知：" + s.status}{s.auto_renewal && s.expires_at > 0 && !s.renewal_warning ? " · 自动续费（按周期续算）" : ""}</p>
                            {s.renewal_warning && <p className="text-xs text-amber-500">{s.renewal_warning}</p>}
                            {s.delivery.map((d, i) => <p key={i} className="text-xs text-muted-foreground">{d.days === 0 ? "到期时" : "提前 " + d.days + " 天"}：{d.sent_at ? "已发送" : d.last_error || "等待发送"}</p>)}
                        </div>
                    </article>)}
                    {rows.length === 0 && <p className="text-muted-foreground">没有符合条件的服务器</p>}
                </div>}
            </section>
        </>}
    </div>
}
