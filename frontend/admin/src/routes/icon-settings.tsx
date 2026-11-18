import { FetcherMethod, fetcher, swrFetcher } from "@/api/api"
import Picker from "@/components/LogoChoicePicker"
import LogoEditor from "@/components/LogoEditor"
import ProviderGroupFilter from "@/components/ProviderGroupFilter"
import SettingHelp from "@/components/SettingHelp"
import UnsavedChanges, { DiscardChangesDialog } from "@/components/UnsavedChanges"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/useAuth"
import useLogoGroups from "@/hooks/useLogoGroups"
import useLogoLibrary from "@/hooks/useLogoLibrary"
import { useEffect, useMemo, useState } from "react"
import { Navigate } from "react-router-dom"
import useSWR from "swr"

import { carrierRegions, regionName } from "../../../shared/carrier-regions"
import type { LogoLibraryEntry } from "../../../shared/logo-library"
import { safeLogoSource } from "../../../shared/other-routes"

type Usage = Record<string, { id: number; name: string }[]>
const empty = (kind: "provider" | "carrier"): LogoLibraryEntry => ({
    id: "",
    kind,
    name: "",
    regions: [],
    aliases: "",
    background: "",
    source: "",
    builtin: false,
    version: 0,
    logo: "",
    logoOriginal: "",
    logoWebsite: "",
})
function LogoImage({ entry }: { entry: LogoLibraryEntry }) {
    const [failed, setFailed] = useState(false),
        src = safeLogoSource(entry.logo)
    useEffect(() => setFailed(false), [src])
    return src && !failed ? (
        <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="max-h-10 max-w-full object-contain"
        />
    ) : (
        <span className="text-xs opacity-70">{src ? "图片加载失败" : "暂无图标"}</span>
    )
}
export default function IconSettings() {
    const { profile, loading } = useAuth(),
        { data, error, mutate, isLoading } = useLogoLibrary()
    const {
        data: usage,
        error: usageError,
        mutate: refreshUsage,
    } = useSWR<Usage>(profile?.role === 0 ? "/api/v1/logo/usage" : null, swrFetcher, {
        dedupingInterval: 10000,
        revalidateOnFocus: true,
    })
    const { data: groups } = useLogoGroups(),
        [group, setGroup] = useState("")
    const [kind, setKind] = useState<"provider" | "carrier">("provider"),
        [query, setQuery] = useState(""),
        [region, setRegion] = useState(""),
        [page, setPage] = useState(0)
    const [edit, setEdit] = useState<LogoLibraryEntry | null>(null),
        [original, setOriginal] = useState(""),
        [confirmClose, setConfirmClose] = useState(false)
    const [busy, setBusy] = useState(false),
        [logoBusy, setLogoBusy] = useState(false),
        [message, setMessage] = useState(""),
        [failure, setFailure] = useState("")
    const [selected, setSelected] = useState<Record<string, number>>({}),
        [targetGroup, setTargetGroup] = useState(""),
        [usageEntry, setUsageEntry] = useState<LogoLibraryEntry | null>(null)
    const filtered = useMemo(
        () =>
            (data || []).filter(
                (e) =>
                    e.kind === kind &&
                    (kind !== "provider" ||
                        !group ||
                        (group === "_ungrouped" ? !e.groupId : e.groupId === group)) &&
                    (!region || e.regions.includes(region)) &&
                    [e.name, e.aliases, e.logoWebsite, ...e.regions.map(regionName)]
                        .join(" ")
                        .toLowerCase()
                        .includes(query.toLowerCase().trim()),
            ),
        [data, kind, region, query, group],
    )
    const lastPage = Math.max(0, Math.ceil(filtered.length / 40) - 1),
        currentPage = Math.min(page, lastPage),
        rows = filtered.slice(currentPage * 40, currentPage * 40 + 40)
    const changeFilter = (fn: () => void) => {
            fn()
            setPage(0)
            setSelected({})
        },
        locked = busy || logoBusy
    const dirty = !!edit && JSON.stringify(edit) !== original
    const begin = (entry: LogoLibraryEntry) => {
        const value = structuredClone(entry)
        setEdit(value)
        setOriginal(JSON.stringify(value))
        setFailure("")
        setConfirmClose(false)
        void refreshUsage()
    }
    const close = () => {
        if (locked) return
        if (dirty) setConfirmClose(true)
        else setEdit(null)
    }
    const save = async () => {
        if (!edit || locked || !dirty) return
        setBusy(true)
        setFailure("")
        try {
            const result = await fetcher<{ updated_servers?: number }>(
                edit.id ? FetcherMethod.PUT : FetcherMethod.POST,
                "/api/v1/logo/library" + (edit.id ? "/" + edit.id : ""),
                edit,
            )
            await mutate()
            void refreshUsage()
            setMessage(
                "已保存" +
                    (result?.updated_servers
                        ? "，同步更新 " + result.updated_servers + " 台服务器"
                        : ""),
            )
            setEdit(null)
            setSelected({})
        } catch (e) {
            setFailure(String(e))
        } finally {
            setBusy(false)
        }
    }
    const remove = async (e: LogoLibraryEntry) => {
        if (
            locked ||
            !window.confirm(
                "删除“" +
                    e.name +
                    "”？" +
                    (usage ? "当前关联 " + (usage[e.id]?.length || 0) + " 台服务器。" : "") +
                    "已有服务器会保留最后的图标。",
            )
        )
            return
        setBusy(true)
        setFailure("")
        try {
            await fetcher(FetcherMethod.DELETE, "/api/v1/logo/library/" + e.id, {
                version: e.version,
            })
            await mutate()
            void refreshUsage()
            setMessage("已删除，已有服务器的图标保留")
            setSelected({})
        } catch (e) {
            setFailure(String(e))
        } finally {
            setBusy(false)
        }
    }
    const toggle = (e: LogoLibraryEntry) =>
        setSelected((s) => {
            const next = { ...s }
            if (e.id in next) delete next[e.id]
            else next[e.id] = e.version
            return next
        })
    const batch = async () => {
        const entries = Object.entries(selected).map(([id, version]) => ({ id, version }))
        if (
            !entries.length ||
            locked ||
            !confirm(
                "将选中的 " +
                    entries.length +
                    " 个厂商移到“" +
                    (groups?.find((g) => g.id === targetGroup)?.name || "未分组") +
                    "”？",
            )
        )
            return
        setBusy(true)
        setFailure("")
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/logo/batch-group", {
                group_id: targetGroup,
                entries,
            })
            await mutate()
            setSelected({})
            setMessage("分组已更新")
        } catch (e) {
            setFailure(String(e))
        } finally {
            setBusy(false)
        }
    }
    const usageList = (entry: LogoLibraryEntry) =>
        usageError ? (
            <p role="alert" className="text-sm text-destructive">
                关联信息读取失败
                <Button type="button" size="sm" variant="ghost" onClick={() => void refreshUsage()}>
                    重试
                </Button>
            </p>
        ) : !usage ? (
            <p className="text-sm">正在读取关联服务器…</p>
        ) : (
            <div className="space-y-2 text-sm">
                <p>
                    当前关联 {usage[entry.id]?.length || 0} 台服务器
                    {edit?.id === entry.id ? "，保存图标后将同步更新。" : "。"}
                </p>
                {!!usage[entry.id]?.length && (
                    <details>
                        <summary className="cursor-pointer">查看服务器</summary>
                        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                            {usage[entry.id].map((s) => (
                                <li key={s.id} className="break-words">
                                    {s.name} <span className="text-muted-foreground">#{s.id}</span>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}
            </div>
        )
    if (loading) return null
    if (profile?.role !== 0) return <Navigate to="/dashboard/settings/api-tokens" replace />
    return (
        <div className="min-w-0" data-settings-editor>
            <UnsavedChanges dirty={dirty} busy={locked} />
            <div className="space-y-4" data-icon-settings>
                <div className="flex flex-wrap gap-2 items-center">
                    <h1 className="text-2xl font-semibold">图标设置</h1>
                    <SettingHelp label="图标设置">
                        修改图标后会同步已关联的服务器；删除条目时，服务器保留最后使用的图标。
                    </SettingHelp>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={locked}
                        variant={kind === "provider" ? "default" : "outline"}
                        onClick={() => changeFilter(() => setKind("provider"))}
                    >
                        服务器厂商
                    </Button>
                    <Button
                        disabled={locked}
                        variant={kind === "carrier" ? "default" : "outline"}
                        onClick={() => changeFilter(() => setKind("carrier"))}
                    >
                        网络运营商
                    </Button>
                    <Button
                        disabled={locked || isLoading || !!error}
                        variant="outline"
                        onClick={() =>
                            begin({
                                ...empty(kind),
                                groupId: kind === "provider" && group !== "_ungrouped" ? group : "",
                            })
                        }
                    >
                        添加{kind === "provider" ? "厂商" : "运营商"}
                    </Button>
                </div>
                {kind === "provider" && (
                    <ProviderGroupFilter
                        disabled={locked}
                        value={group}
                        onChange={(g) => changeFilter(() => setGroup(g))}
                        onUpdated={() => {
                            setSelected({})
                            void mutate()
                        }}
                    />
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                        disabled={locked}
                        aria-label="搜索图标"
                        placeholder="搜索名称、别名或网址"
                        value={query}
                        onChange={(e) => changeFilter(() => setQuery(e.target.value))}
                    />
                    <Picker
                        disabled={locked}
                        value={region}
                        label="筛选国家地区"
                        choices={[
                            { value: "", label: "所有国家/地区" },
                            ...carrierRegions.map((r) => ({
                                value: r.code,
                                label: r.label,
                                keywords: r.code,
                            })),
                        ]}
                        onChange={(r) => changeFilter(() => setRegion(r))}
                    />
                </div>
                {kind === "provider" && !!rows.length && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                aria-label="选择本页图标"
                                disabled={locked}
                                checked={rows.every((e) => e.id in selected)}
                                onChange={(e) => {
                                    const checked = e.target.checked
                                    setSelected((s) => {
                                        const n = { ...s }
                                        rows.forEach((row) => {
                                            if (checked) n[row.id] = row.version
                                            else delete n[row.id]
                                        })
                                        return n
                                    })
                                }}
                            />
                            本页全选
                        </label>
                        <span className="text-sm">已选 {Object.keys(selected).length} 项</span>
                        {!!Object.keys(selected).length && (
                            <>
                                <div className="min-w-40 flex-1">
                                    <Picker
                                        disabled={locked}
                                        value={targetGroup}
                                        label="批量移动到分组"
                                        choices={[
                                            { value: "", label: "未分组" },
                                            ...(groups || []).map((g) => ({
                                                value: g.id,
                                                label: g.name,
                                            })),
                                        ]}
                                        onChange={setTargetGroup}
                                    />
                                </div>
                                <Button
                                    disabled={locked || Object.keys(selected).length > 500}
                                    variant="outline"
                                    onClick={() => void batch()}
                                >
                                    移动分组
                                </Button>
                                <Button
                                    disabled={locked}
                                    variant="ghost"
                                    onClick={() => setSelected({})}
                                >
                                    取消选择
                                </Button>
                            </>
                        )}
                    </div>
                )}
                {message && (
                    <p role="status" className="text-sm">
                        {message}
                    </p>
                )}
                {failure && !edit && (
                    <p role="alert" className="text-sm text-destructive">
                        {failure}
                    </p>
                )}
                {error && (
                    <div role="alert">
                        图标库加载失败
                        <Button variant="outline" onClick={() => void mutate()}>
                            重试
                        </Button>
                    </div>
                )}
                {isLoading && <p role="status">正在加载图标库…</p>}
                <div className="grid gap-2 lg:grid-cols-2">
                    {rows.map((e) => (
                        <div
                            key={e.id}
                            className="flex min-w-0 items-center gap-3 rounded-md border p-3"
                            data-library-row
                        >
                            {kind === "provider" && (
                                <input
                                    type="checkbox"
                                    aria-label={"选择 " + e.name}
                                    disabled={locked}
                                    checked={e.id in selected}
                                    onChange={() => toggle(e)}
                                />
                            )}
                            <div
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted"
                                style={{ backgroundColor: e.background || undefined }}
                            >
                                <LogoImage entry={e} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="font-medium break-words">{e.name}</p>
                                <p className="text-xs text-muted-foreground break-words">
                                    {e.kind === "provider"
                                        ? groups?.find((g) => g.id === e.groupId)?.name || "未分组"
                                        : e.regions.map(regionName).join(" / ") || "未指定地区"}
                                </p>
                                <button
                                    disabled={locked}
                                    type="button"
                                    className="mt-1 rounded text-left text-xs text-primary underline-offset-4 hover:underline"
                                    onClick={() => {
                                        setUsageEntry(e)
                                        void refreshUsage()
                                    }}
                                >
                                    {usage
                                        ? "关联 " + (usage[e.id]?.length || 0) + " 台服务器"
                                        : usageError
                                          ? "关联信息读取失败"
                                          : "读取关联信息…"}
                                </button>
                            </div>
                            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                                <Button
                                    disabled={locked}
                                    size="sm"
                                    variant="outline"
                                    aria-label={"修改 " + e.name}
                                    onClick={() => begin(e)}
                                >
                                    修改
                                </Button>
                                <Button
                                    disabled={locked}
                                    size="sm"
                                    variant="outline"
                                    aria-label={"删除 " + e.name}
                                    onClick={() => void remove(e)}
                                >
                                    删除
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
                {!isLoading && !error && !filtered.length && (
                    <p>暂无匹配图标，可以添加新的{kind === "provider" ? "厂商" : "运营商"}。</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>共 {filtered.length} 项</span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            disabled={locked || currentPage === 0}
                            onClick={() => setPage(currentPage - 1)}
                        >
                            上一页
                        </Button>
                        <span className="self-center">
                            {currentPage + 1} / {lastPage + 1}
                        </span>
                        <Button
                            variant="outline"
                            disabled={locked || currentPage >= lastPage}
                            onClick={() => setPage(currentPage + 1)}
                        >
                            下一页
                        </Button>
                    </div>
                </div>
            </div>
            {usageEntry && (
                <Dialog
                    open
                    onOpenChange={(v) => {
                        if (!v) setUsageEntry(null)
                    }}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{usageEntry.name} · 关联服务器</DialogTitle>
                            <DialogDescription>使用此图标的服务器</DialogDescription>
                        </DialogHeader>
                        {usageList(usageEntry)}
                    </DialogContent>
                </Dialog>
            )}
            {edit && (
                <Dialog
                    open
                    onOpenChange={(open) => {
                        if (!open) close()
                    }}
                >
                    <DialogContent
                        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
                        onPointerDownOutside={(e) => {
                            if (locked || confirmClose) e.preventDefault()
                        }}
                        onEscapeKeyDown={(e) => {
                            if (locked || confirmClose) e.preventDefault()
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>
                                {edit.id ? "修改" : "添加"}
                                {edit.kind === "provider" ? "厂商图标" : "运营商图标"}
                            </DialogTitle>
                            <DialogDescription>
                                {dirty ? "有未保存的修改" : "保存后同步到关联服务器"}
                            </DialogDescription>
                        </DialogHeader>
                        <form
                            className="space-y-3"
                            onSubmit={(e) => {
                                e.preventDefault()
                                void save()
                            }}
                        >
                            {edit.id && (
                                <div className="rounded-lg bg-muted/50 p-3">{usageList(edit)}</div>
                            )}
                            <label className="block space-y-1">
                                <span>名称</span>
                                <Input
                                    required
                                    maxLength={120}
                                    disabled={locked}
                                    aria-label="图标名称"
                                    placeholder={
                                        edit.kind === "provider"
                                            ? "例如：StarHub / 我的香港云"
                                            : "例如：中国电信 / HGC"
                                    }
                                    value={edit.name}
                                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                                />
                            </label>
                            {edit.kind === "provider" && (
                                <Picker
                                    value={edit.groupId || ""}
                                    label="所属厂商分组"
                                    disabled={locked}
                                    choices={[
                                        { value: "", label: "未分组" },
                                        ...(groups || []).map((g) => ({
                                            value: g.id,
                                            label: g.name,
                                        })),
                                    ]}
                                    onChange={(g) => setEdit({ ...edit, groupId: g })}
                                />
                            )}
                            <label className="block space-y-1">
                                <span>搜索别名</span>
                                <Input
                                    disabled={locked}
                                    maxLength={2000}
                                    aria-label="图标搜索别名"
                                    placeholder="可选，例如中文名、简称"
                                    value={edit.aliases}
                                    onChange={(e) => setEdit({ ...edit, aliases: e.target.value })}
                                />
                            </label>
                            <div className="space-y-2">
                                <span>国家/地区</span>
                                <div className="flex flex-wrap gap-1">
                                    {edit.regions.map((r) => (
                                        <Button
                                            key={r}
                                            type="button"
                                            disabled={locked}
                                            size="sm"
                                            variant="secondary"
                                            onClick={() =>
                                                setEdit({
                                                    ...edit,
                                                    regions: edit.regions.filter((x) => x !== r),
                                                })
                                            }
                                        >
                                            {regionName(r)} ×
                                        </Button>
                                    ))}
                                </div>
                                <Picker
                                    disabled={locked || edit.regions.length >= 32}
                                    value=""
                                    label="添加国家地区"
                                    choices={carrierRegions
                                        .filter((r) => !edit.regions.includes(r.code))
                                        .map((r) => ({
                                            value: r.code,
                                            label: r.label,
                                            keywords: r.code,
                                        }))}
                                    onChange={(r) =>
                                        setEdit({ ...edit, regions: [...edit.regions, r] })
                                    }
                                />
                            </div>
                            <LogoEditor
                                label="图标库"
                                value={edit}
                                locked={locked}
                                onBusyChange={setLogoBusy}
                                onChange={(v) =>
                                    setEdit((current) => (current ? { ...current, ...v } : current))
                                }
                            />
                            <div className="grid grid-cols-2 gap-2" aria-label="明暗图标预览">
                                {[
                                    ["浅色", "#f4f4f5", "#18181b"],
                                    ["深色", "#18181b", "#f4f4f5"],
                                ].map(([label, bg, color]) => (
                                    <div
                                        key={label}
                                        className="rounded-lg border p-3"
                                        style={{ background: bg, color }}
                                    >
                                        <small>{label}</small>
                                        <div
                                            className="mt-2 flex h-16 items-center justify-center rounded"
                                            style={{ background: edit.background || undefined }}
                                        >
                                            <LogoImage entry={edit} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                                图标底色
                                <input
                                    type="color"
                                    disabled={locked}
                                    aria-label="图标底色"
                                    value={edit.background || "#292524"}
                                    onChange={(e) =>
                                        setEdit({ ...edit, background: e.target.value })
                                    }
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={locked}
                                    variant="outline"
                                    onClick={() => setEdit({ ...edit, background: "" })}
                                >
                                    透明
                                </Button>
                            </label>
                            {failure && (
                                <p role="alert" className="text-sm text-destructive">
                                    {failure}
                                </p>
                            )}
                            <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-background py-3">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={locked || !dirty}
                                    onClick={() => setEdit(JSON.parse(original))}
                                >
                                    撤销修改
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={locked}
                                    onClick={close}
                                >
                                    取消
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={locked || !dirty || !edit.name.trim()}
                                >
                                    {busy ? "保存中…" : "保存"}
                                </Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            )}
            <DiscardChangesDialog
                open={confirmClose}
                onKeep={() => setConfirmClose(false)}
                onDiscard={() => {
                    setConfirmClose(false)
                    setEdit(null)
                }}
            />
        </div>
    )
}
