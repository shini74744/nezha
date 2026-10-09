import { FetcherMethod, fetcher } from "@/api/api"
import ReturnRouteSettings from "@/components/ReturnRouteSettings"
import ConnectivityAutomationSettings from "@/components/ConnectivityAutomationSettings"
import SettingHelp from "@/components/SettingHelp"
import ConnectivityDragHandle from "@/components/ConnectivityDragHandle"
import ConnectivityIconPicker from "@/components/ConnectivityIconPicker"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"
import { resolveConnectivityIcon } from "@/lib/connectivity-icons"
import { reorderConnectivity } from "@/lib/connectivity-order"
import { Globe2, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import { toast } from "sonner"

import { connectivityRegions } from "../../../shared/connectivity-regions"

type Item = {
    id: string
    name: string
    group: string
    url: string
    icon: string
    icon_source?: string
    enabled: boolean
}
type State = { revision: string; items: Item[]; defaults: Item[]; max_targets: number }
const endpoint = "/api/v1/setting/connectivity"
const groups = connectivityRegions.map((region) => [region.id, region.zh])
const selectStyle = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
function validate(item: Item, defaults: Item[] = []) {
    if (!item.name.trim() || Array.from(item.name.trim()).length > 60)
        return "请输入 1–60 字符的名称"
    if (defaults.some((row) => row.id === item.id && row.url === item.url)) return ""
    try {
        const url = new URL(item.url)
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.hash ||
            (url.port && url.port !== "443")
        )
            return "仅支持 HTTPS/443，不允许用户名、密码或片段"
        if (
            !url.hostname.includes(".") ||
            /^[0-9.]+$/.test(url.hostname) ||
            url.hostname.includes(":") ||
            /\.(local|localhost|internal|lan|home|test|invalid|onion)$/.test(url.hostname)
        )
            return "请使用可信公网域名，不能使用 IP 或内部地址"
    } catch {
        return "请输入完整 HTTPS 检测地址"
    }
    return ""
}
function Brand({ id }: { id: string }) {
    const [failed, setFailed] = useState(false)
    const source = resolveConnectivityIcon(id)
    useEffect(() => setFailed(false), [id])
    return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white p-1">
            {source && !failed ? (
                <img
                    src={source}
                    alt=""
                    className="size-6 object-contain"
                    onError={() => setFailed(true)}
                />
            ) : (
                <Globe2 className="size-5 text-slate-500" />
            )}
        </span>
    )
}
export default function CardSettings() {
    const { profile, loading } = useAuth()
    const [category, setCategory] = useState("connectivity")
    const [saved, setSaved] = useState<State>(),
        [items, setItems] = useState<Item[]>([])
    const [reading, setReading] = useState(true),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("")
    const [search, setSearch] = useState(""),
        [group, setGroup] = useState("all"),
        [editor, setEditor] = useState<Item | null>(null)
    const [iconBlocked, setIconBlocked] = useState(false)
    const [dragTarget, setDragTarget] = useState<string | null>(null)
    const [orderNotice, setOrderNotice] = useState("")
    const request = useRef({ sequence: 0 })
    const dirty = !!saved && JSON.stringify(items) !== JSON.stringify(saved.items)
    const adopt = (value: State) => {
        setSaved(value)
        setItems(value.items)
        setError("")
    }
    const load = async () => {
        const id = ++request.current.sequence
        setReading(true)
        setError("")
        try {
            const value = await fetcher<State>(FetcherMethod.GET, endpoint)
            if (id === request.current.sequence) adopt(value)
        } catch (e) {
            if (id === request.current.sequence) setError("读取失败：" + String(e))
        } finally {
            if (id === request.current.sequence) setReading(false)
        }
    }
    useEffect(() => {
        const token = request.current
        if (profile?.role === 0) void load()
        return () => {
            token.sequence++
        }
    }, [profile?.role])
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [dirty])
    const save = async () => {
        if (!saved || busy) return
        setBusy(true)
        setError("")
        try {
            adopt(
                await fetcher<State>(FetcherMethod.PUT, endpoint, {
                    revision: saved.revision,
                    items,
                }),
            )
            toast.success("卡片设置已保存，全站生效")
        } catch (e) {
            setError("保存失败：" + String(e))
        } finally {
            setBusy(false)
        }
    }
    const reorder = (id: string, over: string) => {
        if (busy || reading || search.trim()) return
        setItems((current) => reorderConnectivity(current, id, over))
        setOrderNotice("顺序已调整，点击保存配置后生效")
    }
    const move = (id: string, offset: number) => {
        const row = items.find((item) => item.id === id)
        if (!row) return
        const peers = items.filter((item) => item.group === row.group)
        const other = peers[peers.findIndex((item) => item.id === id) + offset]
        if (other) reorder(id, other.id)
    }
    const filtered = items.filter(
        (row) =>
            (group === "all" || row.group === group) &&
            (!search ||
                [row.name, row.url].some((value) =>
                    value.toLowerCase().includes(search.toLowerCase()),
                )),
    )
    if (loading) return null
    if (profile?.role !== 0) return <Navigate to="/dashboard" replace />
    return (
        <Tabs value={category} onValueChange={setCategory} className="space-y-5" data-card-settings>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">卡片设置</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        管理前台各类卡片的内容与显示。
                    </p>
                </div>
                <div className={category === "connectivity" ? "flex flex-wrap gap-2" : "hidden"}>
                    <Button
                        variant="outline"
                        disabled={busy || reading}
                        onClick={() => {
                            if (!dirty || window.confirm("放弃未保存修改并重新加载？")) void load()
                        }}
                    >
                        <RefreshCw className="mr-2 size-4" />
                        重新加载
                    </Button>
                    <Button disabled={!dirty || busy || reading} onClick={() => void save()}>
                        <Save className="mr-2 size-4" />
                        {busy ? "保存中…" : "保存配置"}
                    </Button>
                </div>
            </div>
            <TabsList aria-label="卡片分类">
                <TabsTrigger value="connectivity">连通性</TabsTrigger>
                <TabsTrigger value="bgp">BGP</TabsTrigger>
                <TabsTrigger value="return-route">回程</TabsTrigger>
            </TabsList>
            <TabsContent value="return-route" forceMount className="data-[state=inactive]:hidden"><ReturnRouteSettings /></TabsContent>
            <TabsContent value="bgp" forceMount className="data-[state=inactive]:hidden">
                <ConnectivityAutomationSettings kind="bgp" />
            </TabsContent>
            <TabsContent
                value="connectivity"
                forceMount
                className="space-y-5 data-[state=inactive]:hidden"
            >
                <ConnectivityAutomationSettings />
                <div className="flex items-center gap-1">
                    <h2 className="font-semibold">连通性检测点</h2>
                    <SettingHelp label="连通性检测点">
                        <p>管理全站检测目标，保存后用于后续检测。拖动手柄可调整同一地区的顺序，也可聚焦手柄后按上下方向键。</p>
                        <p className="mt-2">前台优先展示节点所在地区，其次是全球，中国区域始终排在最后。</p>
                        <p className="mt-2">请使用可信的 HTTPS 公共网址，不要填写密码、令牌、私密链接或内网地址。</p>
                    </SettingHelp>
                </div>
                <p className="sr-only" aria-live="polite">
                    {orderNotice}
                </p>
                {search.trim() && (
                    <p className="text-xs text-muted-foreground">
                        搜索时暂停排序，请清空搜索后拖动。
                    </p>
                )}
                {error && (
                    <div
                        role="alert"
                        className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive"
                    >
                        {error}
                    </div>
                )}
                {reading ? (
                    <p role="status">正在读取检测点…</p>
                ) : (
                    saved && (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-muted-foreground">
                                    共 {items.length} 项 · 已启用{" "}
                                    {items.filter((row) => row.enabled).length} 项
                                    {dirty && (
                                        <span className="ml-2 text-amber-700 dark:text-amber-300">
                                            有未保存修改
                                        </span>
                                    )}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() => {
                                            if (
                                                window.confirm(
                                                    `恢复内置 ${saved.defaults.length} 项并清除当前自定义清单？保存配置后才生效。`,
                                                )
                                            )
                                                setItems(saved.defaults.map((row) => ({ ...row })))
                                        }}
                                    >
                                        恢复默认
                                    </Button>
                                    <Button
                                        variant="outline"
                                        disabled={
                                            busy ||
                                            !saved.defaults.some(
                                                (row) => !items.some((item) => item.id === row.id),
                                            )
                                        }
                                        onClick={() => {
                                            const missing = saved.defaults.filter(
                                                (row) => !items.some((item) => item.id === row.id),
                                            )
                                            if (items.length + missing.length > saved.max_targets) {
                                                setError(
                                                    `补充后超过 ${saved.max_targets} 项上限，请先删除不需要的项。`,
                                                )
                                                return
                                            }
                                            if (
                                                window.confirm(
                                                    `补充 ${missing.length} 个缺少的内置检测点？保留现有项的设置和顺序；以前移除的内置项也会补回。保存配置后生效。`,
                                                )
                                            )
                                                setItems((current) => [
                                                    ...current,
                                                    ...missing.map((row) => ({ ...row })),
                                                ])
                                        }}
                                    >
                                        补充内置检测点
                                    </Button>
                                    <Button
                                        disabled={busy || items.length >= saved.max_targets}
                                        onClick={() =>
                                            setEditor({
                                                id: "custom-" + crypto.randomUUID(),
                                                name: "",
                                                group: group === "all" ? "global" : group,
                                                url: "https://",
                                                icon: "",
                                                enabled: true,
                                            })
                                        }
                                    >
                                        <Plus className="mr-2 size-4" />
                                        添加检测点
                                    </Button>
                                </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                                <Input
                                    aria-label="搜索检测点"
                                    placeholder="搜索名称或检测地址"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                <select
                                    aria-label="筛选地区"
                                    className={selectStyle}
                                    value={group}
                                    onChange={(e) => setGroup(e.target.value)}
                                >
                                    <option value="all">全部地区</option>
                                    {groups.map(([id, name]) => (
                                        <option key={id} value={id}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                {filtered.map((row) => {
                                    const peers = items.filter((item) => item.group === row.group),
                                        position = peers.findIndex((item) => item.id === row.id)
                                    return (
                                        <article
                                            key={row.id}
                                            data-checkpoint-id={row.id}
                                            data-checkpoint-group={row.group}
                                            data-drop-target={dragTarget === row.id || undefined}
                                            className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 data-[drop-target]:ring-2 data-[drop-target]:ring-primary"
                                        >
                                            <ConnectivityDragHandle
                                                id={row.id}
                                                name={row.name}
                                                group={row.group}
                                                disabled={busy || !!search.trim()}
                                                onDrop={reorder}
                                                onStep={move}
                                                onTarget={setDragTarget}
                                            />
                                            <Brand id={row.icon} />
                                            <div className="min-w-0 flex-1 basis-36">
                                                <h2 className="truncate text-sm font-semibold">
                                                    {row.name}
                                                </h2>
                                                <p className="break-all text-xs text-muted-foreground">
                                                    {row.url}
                                                </p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {groups.find(([id]) => id === row.group)?.[1]} ·
                                                    第 {position + 1} 项
                                                </p>
                                            </div>
                                            <div className="ml-auto flex flex-wrap items-center gap-1.5">
                                                <Switch
                                                    aria-label={"启用 " + row.name}
                                                    checked={row.enabled}
                                                    disabled={busy}
                                                    onCheckedChange={(enabled) =>
                                                        setItems((current) =>
                                                            current.map((item) =>
                                                                item.id === row.id
                                                                    ? { ...item, enabled }
                                                                    : item,
                                                            ),
                                                        )
                                                    }
                                                />
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    aria-label={"编辑 " + row.name}
                                                    disabled={busy}
                                                    onClick={() => setEditor({ ...row })}
                                                >
                                                    <Pencil className="size-4" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="destructive"
                                                    aria-label={"删除 " + row.name}
                                                    disabled={busy}
                                                    onClick={() => {
                                                        if (
                                                            window.confirm(
                                                                "移除检测点“" +
                                                                    row.name +
                                                                    "”？保存配置后生效，不会删除服务器。",
                                                            )
                                                        )
                                                            setItems((current) =>
                                                                current.filter(
                                                                    (item) => item.id !== row.id,
                                                                ),
                                                            )
                                                    }}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </article>
                                    )
                                })}
                                {filtered.length === 0 && (
                                    <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                                        {items.length
                                            ? "没有匹配的检测点"
                                            : "暂无检测点，点击“添加检测点”开始配置"}
                                    </p>
                                )}
                            </div>
                        </>
                    )
                )}
                <Dialog
                    open={!!editor}
                    onOpenChange={(open) => {
                        if (!open) setEditor(null)
                    }}
                >
                    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>
                                {items.some((row) => row.id === editor?.id)
                                    ? "编辑检测点"
                                    : "添加检测点"}
                            </DialogTitle>
                            <DialogDescription>
                                修改先保存到草稿，点击页面“保存配置”后全站生效。
                            </DialogDescription>
                        </DialogHeader>
                        {editor && (
                            <form
                                className="space-y-4"
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    if (iconBlocked || validate(editor, saved?.defaults)) return
                                    const next = {
                                        ...editor,
                                        name: editor.name.trim(),
                                        url: editor.url.trim(),
                                    }
                                    setItems((current) =>
                                        current.some((row) => row.id === next.id)
                                            ? current.map((row) =>
                                                  row.id === next.id ? next : row,
                                              )
                                            : [...current, next],
                                    )
                                    setEditor(null)
                                }}
                            >
                                <label className="block space-y-1 text-sm">
                                    <span>应用名称</span>
                                    <Input
                                        required
                                        maxLength={60}
                                        value={editor.name}
                                        onChange={(e) =>
                                            setEditor({ ...editor, name: e.target.value })
                                        }
                                    />
                                </label>
                                <label className="block space-y-1 text-sm">
                                    <span>检测地址</span>
                                    <Input
                                        required
                                        type="url"
                                        maxLength={2048}
                                        value={editor.url}
                                        onChange={(e) =>
                                            setEditor({ ...editor, url: e.target.value })
                                        }
                                    />
                                </label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="block space-y-1 text-sm">
                                        <span>地区</span>
                                        <select
                                            aria-label="地区"
                                            className={selectStyle}
                                            value={editor.group}
                                            onChange={(e) =>
                                                setEditor({ ...editor, group: e.target.value })
                                            }
                                        >
                                            {groups.map(([id, name]) => (
                                                <option key={id} value={id}>
                                                    {name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <ConnectivityIconPicker
                                        key={editor.id}
                                        value={editor}
                                        options={saved?.defaults || []}
                                        onBlockedChange={setIconBlocked}
                                        onChange={(value) =>
                                            setEditor((current) =>
                                                current ? { ...current, ...value } : null,
                                            )
                                        }
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Brand id={editor.icon} />
                                    <label className="flex items-center gap-2 text-sm">
                                        启用
                                        <Switch
                                            checked={editor.enabled}
                                            onCheckedChange={(enabled) =>
                                                setEditor({ ...editor, enabled })
                                            }
                                        />
                                    </label>
                                </div>
                                {validate(editor, saved?.defaults) && (
                                    <p className="text-xs text-muted-foreground">
                                        {validate(editor, saved?.defaults)}
                                    </p>
                                )}
                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setEditor(null)}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={
                                            iconBlocked || !!validate(editor, saved?.defaults)
                                        }
                                    >
                                        保存到草稿
                                    </Button>
                                </DialogFooter>
                            </form>
                        )}
                    </DialogContent>
                </Dialog>
            </TabsContent>
        </Tabs>
    )
}
