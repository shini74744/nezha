import { FetcherMethod, fetcher } from "@/api/api"
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
import { useAuth } from "@/hooks/useAuth"
import { connectivityIcons } from "@/lib/connectivity-icons"
import { ArrowDown, ArrowUp, Globe2, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import { toast } from "sonner"

type Item = { id: string; name: string; group: string; url: string; icon: string; enabled: boolean }
type State = { revision: string; items: Item[]; defaults: Item[]; max_targets: number }
const endpoint = "/api/v1/setting/connectivity"
const groups = [
    ["china", "中国"],
    ["japan", "日本"],
    ["usa", "美国"],
    ["global", "全球"],
]
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
    useEffect(() => setFailed(false), [id])
    return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white p-1">
            {connectivityIcons[id] && !failed ? (
                <img
                    src={connectivityIcons[id]}
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
    const [saved, setSaved] = useState<State>(),
        [items, setItems] = useState<Item[]>([])
    const [reading, setReading] = useState(true),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("")
    const [search, setSearch] = useState(""),
        [group, setGroup] = useState("all"),
        [editor, setEditor] = useState<Item | null>(null)
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
    const move = (id: string, offset: number) => {
        setItems((current) => {
            const at = current.findIndex((row) => row.id === id),
                peers = current
                    .map((row, index) => ({ row, index }))
                    .filter(({ row }) => row.group === current[at].group)
            const pos = peers.findIndex(({ index }) => index === at),
                other = peers[pos + offset]?.index
            if (other === undefined) return current
            const next = [...current]
            ;[next[at], next[other]] = [next[other], next[at]]
            return next
        })
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
        <section className="space-y-5" data-card-settings>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">卡片设置</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        连通性检测点 · 全站统一 · 默认主题与哆啦 A 梦共用
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
                        <RefreshCw className="mr-2 size-4" />
                        重新加载
                    </Button>
                    <Button disabled={!dirty || busy || reading} onClick={() => void save()}>
                        <Save className="mr-2 size-4" />
                        {busy ? "保存中…" : "保存配置"}
                    </Button>
                </div>
            </div>
            <div className="rounded-lg border bg-card p-4 text-sm leading-relaxed">
                前端只显示图标、名称、检测圆点与延迟，不显示网址。保存不会发起检测；正在执行的批次保持原清单，完成后使用新配置。排序在各地区内生效。
                <p className="mt-1 text-muted-foreground">
                    每项检测 3 次，3 秒未回包即标记超时。仅允许管理员配置可信 HTTPS
                    公网域名；节点自行解析 DNS，请勿填入密钥、私密链接或内部服务。
                </p>
            </div>
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
                                                "恢复内置 72 项并清除当前自定义清单？保存配置后才生效。",
                                            )
                                        )
                                            setItems(saved.defaults.map((row) => ({ ...row })))
                                    }}
                                >
                                    恢复默认
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
                                        className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3"
                                    >
                                        <Brand id={row.icon} />
                                        <div className="min-w-0 flex-1 basis-36">
                                            <h2 className="truncate text-sm font-semibold">
                                                {row.name}
                                            </h2>
                                            <p className="break-all text-xs text-muted-foreground">
                                                {row.url}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {groups.find(([id]) => id === row.group)?.[1]} · 第{" "}
                                                {position + 1} 项
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
                                                aria-label={"上移 " + row.name}
                                                disabled={busy || position === 0}
                                                onClick={() => move(row.id, -1)}
                                            >
                                                <ArrowUp className="size-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="outline"
                                                aria-label={"下移 " + row.name}
                                                disabled={busy || position === peers.length - 1}
                                                onClick={() => move(row.id, 1)}
                                            >
                                                <ArrowDown className="size-4" />
                                            </Button>
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
                                if (validate(editor, saved?.defaults)) return
                                const next = {
                                    ...editor,
                                    name: editor.name.trim(),
                                    url: editor.url.trim(),
                                }
                                setItems((current) =>
                                    current.some((row) => row.id === next.id)
                                        ? current.map((row) => (row.id === next.id ? next : row))
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
                                    onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                                />
                            </label>
                            <label className="block space-y-1 text-sm">
                                <span>检测地址</span>
                                <Input
                                    required
                                    type="url"
                                    maxLength={2048}
                                    value={editor.url}
                                    onChange={(e) => setEditor({ ...editor, url: e.target.value })}
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
                                <label className="block space-y-1 text-sm">
                                    <span>图标</span>
                                    <select
                                        aria-label="图标"
                                        className={selectStyle}
                                        value={editor.icon}
                                        onChange={(e) =>
                                            setEditor({ ...editor, icon: e.target.value })
                                        }
                                    >
                                        <option value="">默认地球图标</option>
                                        {saved?.defaults.map((row) => (
                                            <option key={row.id} value={row.id}>
                                                {row.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
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
                                    disabled={!!validate(editor, saved?.defaults)}
                                >
                                    保存到草稿
                                </Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </section>
    )
}
