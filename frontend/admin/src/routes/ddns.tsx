import { swrFetcher } from "@/api/api"
import { deleteDDNSProfiles } from "@/api/ddns"
import { DDNSCard } from "@/components/ddns"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ddnsProviderName } from "@/lib/ddns-editor"
import { ModelDDNSProfile } from "@/types"
import { RefreshCw, Search, Trash2 } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import useSWR, { KeyedMutator } from "swr"

import "./ddns.css"

function DeleteDDNS({
    ids,
    mutate,
    onDeleted,
    compact = false,
}: {
    ids: number[]
    mutate: KeyedMutator<ModelDDNSProfile[]>
    onDeleted: () => void
    compact?: boolean
}) {
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const saving = useRef(false)
    const [error, setError] = useState("")
    const remove = async () => {
        if (saving.current || !ids.length) return
        saving.current = true
        setBusy(true)
        setError("")
        try {
            await deleteDDNSProfiles(ids)
        } catch {
            setError("删除失败，请稍后重试；配置未从列表移除。")
            saving.current = false
            setBusy(false)
            return
        }
        setOpen(false)
        onDeleted()
        toast.success("DDNS 配置已删除")
        try {
            await mutate()
        } catch {
            toast.error("配置已删除，列表刷新失败，请手动刷新。")
        } finally {
            saving.current = false
            setBusy(false)
        }
    }
    return (
        <AlertDialog
            open={open}
            onOpenChange={(v) => {
                if (!saving.current) {
                    setOpen(v)
                    setError("")
                }
            }}
        >
            <AlertDialogTrigger asChild>
                <Button
                    variant="destructive"
                    size={compact ? "icon" : "default"}
                    disabled={!ids.length}
                    aria-label={compact ? "删除 DDNS" : "删除选中 DDNS"}
                >
                    <Trash2 className="h-4 w-4" />
                    {!compact && (
                        <span className="ml-2">
                            删除{ids.length ? " (" + ids.length + ")" : ""}
                        </span>
                    )}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>删除 {ids.length} 个 DDNS 配置？</AlertDialogTitle>
                    <AlertDialogDescription>
                        这会移除面板中的配置，关联节点将无法继续使用它更新解析；不会删除 DNS
                        提供商中已存在的记录。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {error && (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
                    <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
                        {busy ? "删除中…" : "确认删除"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default function DDNSPage() {
    const { data, mutate, error, isLoading, isValidating } = useSWR<ModelDDNSProfile[]>(
        "/api/v1/ddns",
        swrFetcher,
    )
    const {
        data: providers = [],
        error: providerError,
        mutate: reloadProviders,
    } = useSWR<string[]>("/api/v1/ddns/providers", swrFetcher)
    const [query, setQuery] = useState("")
    const [provider, setProvider] = useState("")
    const [selected, setSelected] = useState<number[]>([])
    const filtered = useMemo(
        () =>
            (data ?? []).filter(
                (row) =>
                    (!provider || row.provider === provider) &&
                    [
                        row.id,
                        row.name,
                        row.provider,
                        ddnsProviderName(row.provider),
                        ...(row.domains ?? []),
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(query.trim().toLowerCase()),
            ),
        [data, query, provider],
    )
    // Selection is scoped to visible records, so a filtered-out ID can never be deleted accidentally.
    const ids = filtered.filter((row) => selected.includes(row.id)).map((row) => row.id)
    const allSelected = !!filtered.length && ids.length === filtered.length
    const toggle = (id: number, checked: boolean) =>
        setSelected((previous) =>
            checked ? [...new Set([...previous, id])] : previous.filter((v) => v !== id),
        )
    const refresh = () => {
        void mutate()
        void reloadProviders()
    }
    const providerChoices = [...new Set([...providers, ...(data ?? []).map((row) => row.provider)])]
    return (
        <div className="ddns-page min-w-0 px-3 pb-6">
            <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">动态域名解析</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        管理域名、解析协议和提供商，随关联节点 IP 更新。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <DeleteDDNS ids={ids} mutate={mutate} onDeleted={() => setSelected([])} />
                    <DDNSCard providers={providers} mutate={mutate} />
                </div>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        className="pl-9"
                        aria-label="搜索 DDNS"
                        placeholder="搜索名称、域名或 ID"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value)
                            setSelected([])
                        }}
                    />
                </div>
                <select
                    className="ddns-select !w-auto min-w-0 flex-1 sm:flex-none"
                    aria-label="筛选提供商"
                    value={provider}
                    onChange={(e) => {
                        setProvider(e.target.value)
                        setSelected([])
                    }}
                >
                    <option value="">全部提供商</option>
                    {providerChoices.map((p) => (
                        <option key={p} value={p}>
                            {ddnsProviderName(p)}
                        </option>
                    ))}
                </select>
                <Button
                    variant="outline"
                    onClick={refresh}
                    disabled={isValidating}
                    aria-label="刷新 DDNS"
                >
                    <RefreshCw className={"mr-2 h-4 w-4 " + (isValidating ? "animate-spin" : "")} />
                    刷新
                </Button>
            </div>
            {providerError && (
                <p role="alert" className="mb-3 text-sm text-destructive">
                    提供商读取失败，新建暂不可用。
                    <button className="ml-2 underline" onClick={() => void reloadProviders()}>
                        重试提供商
                    </button>
                </p>
            )}
            {error ? (
                <div role="alert" className="rounded-md border p-5 text-center">
                    DDNS 列表加载失败
                    <Button className="ml-3" variant="outline" onClick={() => void mutate()}>
                        重新加载
                    </Button>
                </div>
            ) : isLoading ? (
                <p role="status" className="py-10 text-center text-muted-foreground">
                    正在加载 DDNS 配置…
                </p>
            ) : (
                <>
                    <div className="ddns-list-heading">
                        <Checkbox
                            aria-label="选择全部 DDNS"
                            disabled={!filtered.length}
                            checked={allSelected || (ids.length > 0 && "indeterminate")}
                            onCheckedChange={(checked) =>
                                setSelected(checked ? filtered.map((row) => row.id) : [])
                            }
                        />
                        <span>名称 / ID</span>
                        <span>域名</span>
                        <span>解析协议</span>
                        <span>提供商</span>
                        <span>重试</span>
                        <span>操作</span>
                    </div>
                    <div className="ddns-mobile-select mb-3 flex items-center gap-2 text-sm">
                        <Checkbox
                            aria-label="选择全部 DDNS"
                            disabled={!filtered.length}
                            checked={allSelected || (ids.length > 0 && "indeterminate")}
                            onCheckedChange={(checked) =>
                                setSelected(checked ? filtered.map((row) => row.id) : [])
                            }
                        />
                        选择本页 · {filtered.length} 个配置
                    </div>
                    <div className="space-y-2 sm:space-y-0">
                        {filtered.map((row) => (
                            <article
                                key={row.id}
                                className="ddns-row"
                                data-ddns-id={row.id}
                                data-selected={ids.includes(row.id)}
                            >
                                <Checkbox
                                    className="ddns-row-select"
                                    aria-label={"选择 " + row.name}
                                    checked={ids.includes(row.id)}
                                    onCheckedChange={(checked) => toggle(row.id, !!checked)}
                                />
                                <div className="ddns-name min-w-0">
                                    <h2 className="break-words font-semibold">{row.name}</h2>
                                    <span className="text-xs text-muted-foreground">#{row.id}</span>
                                </div>
                                <div className="ddns-domains flex min-w-0 flex-wrap gap-1">
                                    {(row.domains ?? []).length ? (
                                        row.domains.map((domain) => (
                                            <span
                                                key={domain}
                                                className="max-w-full break-all rounded border px-2 py-0.5 text-xs"
                                            >
                                                {domain}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-muted-foreground">未配置域名</span>
                                    )}
                                </div>
                                <div className="ddns-protocol flex flex-wrap gap-1">
                                    <span
                                        className={
                                            "ddns-protocol-badge " +
                                            (row.enable_ipv4 ? "is-enabled" : "")
                                        }
                                    >
                                        IPv4 · {row.enable_ipv4 ? "A" : "关闭"}
                                    </span>
                                    <span
                                        className={
                                            "ddns-protocol-badge " +
                                            (row.enable_ipv6 ? "is-enabled" : "")
                                        }
                                    >
                                        IPv6 · {row.enable_ipv6 ? "AAAA" : "关闭"}
                                    </span>
                                </div>
                                <div className="ddns-provider min-w-0 break-words text-sm">
                                    {ddnsProviderName(row.provider)}
                                </div>
                                <div className="ddns-retries text-sm text-muted-foreground">
                                    {row.max_retries} 次
                                </div>
                                <div className="ddns-actions flex shrink-0 gap-2">
                                    <DDNSCard data={row} providers={providers} mutate={mutate} />
                                    <DeleteDDNS
                                        compact
                                        ids={[row.id]}
                                        mutate={mutate}
                                        onDeleted={() =>
                                            setSelected((previous) =>
                                                previous.filter((id) => id !== row.id),
                                            )
                                        }
                                    />
                                </div>
                            </article>
                        ))}
                    </div>
                    {!filtered.length && (
                        <div className="rounded-md border border-dashed px-4 py-10 text-center text-muted-foreground">
                            {(data ?? []).length
                                ? "没有匹配的配置，试试其他名称或域名。"
                                : "还没有 DDNS 配置，点击右上角「新建 DDNS」开始。"}
                        </div>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                        共 {data?.length ?? 0} 个配置
                        {ids.length ? " · 已选 " + ids.length + " 个" : ""}
                        。协议标识仅表示配置已启用，不代表最近解析成功。
                    </p>
                </>
            )}
        </div>
    )
}
