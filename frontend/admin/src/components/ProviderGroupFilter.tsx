import { FetcherMethod, fetcher } from "@/api/api"
import useLogoGroups from "@/hooks/useLogoGroups"
import { useState } from "react"

import Picker from "../../../../appearance/admin/components/LogoChoicePicker"
import UnsavedChanges, { DiscardChangesDialog } from "./UnsavedChanges"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Input } from "./ui/input"

export default function ProviderGroupFilter({
    value,
    onChange,
    onUpdated,
    disabled = false,
}: {
    disabled?: boolean
    value: string
    onChange: (id: string) => void
    onUpdated: () => void
}) {
    const { data: groups, error, mutate } = useLogoGroups(),
        [edit, setEdit] = useState<{ id: string; name: string; version: number } | null>(null),
        [busy, setBusy] = useState(false),
        [failure, setFailure] = useState("")
    const [original, setOriginal] = useState(""),
        [confirmClose, setConfirmClose] = useState(false)
    const dirty = !!edit && edit.name !== original,
        locked = busy || disabled
    const close = () => {
        if (locked) return
        if (dirty) setConfirmClose(true)
        else setEdit(null)
    }
    const group = groups?.find((g) => g.id === value)
    const save = async () => {
        if (!edit || busy) return
        setBusy(true)
        setFailure("")
        try {
            const saved = await fetcher<{ id: string }>(
                edit.id ? FetcherMethod.PUT : FetcherMethod.POST,
                "/api/v1/logo/groups" + (edit.id ? "/" + edit.id : ""),
                edit,
            )
            await mutate()
            onChange(saved.id)
            setEdit(null)
            onUpdated()
        } catch (e) {
            setFailure(String(e))
        } finally {
            setBusy(false)
        }
    }
    const remove = async () => {
        if (
            !group ||
            busy ||
            !confirm("删除分组“" + group.name + "”？厂商将移到未分组，已有服务器不受影响。")
        )
            return
        setBusy(true)
        setFailure("")
        try {
            await fetcher(FetcherMethod.DELETE, "/api/v1/logo/groups/" + group.id, {
                version: group.version,
            })
            await mutate()
            onChange("_ungrouped")
            onUpdated()
        } catch (e) {
            setFailure(String(e))
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="space-y-2">
            <UnsavedChanges dirty={dirty} busy={busy} />
            <DiscardChangesDialog
                open={confirmClose}
                onKeep={() => setConfirmClose(false)}
                onDiscard={() => {
                    setConfirmClose(false)
                    setEdit(null)
                }}
            />
            <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-40 flex-1">
                    <Picker
                        disabled={locked}
                        value={value}
                        label="厂商分组"
                        choices={[
                            { value: "", label: "全部分组" },
                            { value: "_ungrouped", label: "未分组" },
                            ...(groups || []).map((g) => ({ value: g.id, label: g.name })),
                        ]}
                        onChange={onChange}
                    />
                </div>
                <Button
                    disabled={locked || !!error}
                    variant="outline"
                    onClick={() => {
                        setFailure("")
                        setOriginal("")
                        setEdit({ id: "", name: "", version: 0 })
                    }}
                >
                    新建分组
                </Button>
                {group && (
                    <>
                        <Button
                            disabled={locked}
                            variant="outline"
                            onClick={() => {
                                setFailure("")
                                setOriginal(group.name)
                                setEdit(group)
                            }}
                        >
                            重命名分组
                        </Button>
                        <Button disabled={locked} variant="outline" onClick={() => void remove()}>
                            删除分组
                        </Button>
                    </>
                )}
            </div>
            {(failure || error) && (
                <p role="alert" className="text-xs text-destructive">
                    {failure || "分组加载失败，请刷新重试"}
                </p>
            )}
            {edit && (
                <Dialog
                    open
                    onOpenChange={(v) => {
                        if (!v) close()
                    }}
                >
                    <DialogContent
                        onEscapeKeyDown={(e) => {
                            if (locked || confirmClose) e.preventDefault()
                        }}
                        onPointerDownOutside={(e) => {
                            if (locked || confirmClose) e.preventDefault()
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>{edit.id ? "重命名分组" : "新建厂商分组"}</DialogTitle>
                        </DialogHeader>
                        <form
                            className="space-y-3"
                            onSubmit={(e) => {
                                e.preventDefault()
                                void save()
                            }}
                        >
                            <Input
                                required
                                maxLength={60}
                                autoFocus
                                disabled={locked}
                                aria-label="分组名称"
                                placeholder="例如：常用厂商 / 香港 / 日本"
                                value={edit.name}
                                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                            />
                            {failure && <p role="alert">{failure}</p>}
                            <Button type="submit" disabled={locked || !edit.name.trim()}>
                                保存分组
                            </Button>
                        </form>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
