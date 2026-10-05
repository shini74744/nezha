import { swrFetcher } from "@/api/api"
import { createDDNSProfile, updateDDNSProfile } from "@/api/ddns"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { IconButton } from "@/components/xui/icon-button"
import {
    type DDNSDraft,
    ddnsDraft,
    ddnsPayload,
    ddnsProviderName,
    parseDDNSDomains,
    validateDDNSDraft,
} from "@/lib/ddns-editor"
import {
    ModelDDNSProfile,
    ModelNotificationGroupResponseItem,
    ddnsRequestTypes,
    ddnsTypes,
} from "@/types"
import { Eye, EyeOff, Plus, X } from "lucide-react"
import { useId, useRef, useState } from "react"
import { toast } from "sonner"
import useSWR, { KeyedMutator } from "swr"

interface DDNSCardProps {
    data?: ModelDDNSProfile
    providers: string[]
    mutate: KeyedMutator<ModelDDNSProfile[]>
}

export function DDNSCard({ data, providers, mutate }: DDNSCardProps) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState(() => ddnsDraft(data))
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [failure, setFailure] = useState("")
    const [showSecret, setShowSecret] = useState(false)
    const [busy, setBusy] = useState(false)
    const saving = useRef(false)
    const id = useId()
    const {
        data: notifierGroup,
        error: groupError,
        mutate: retryGroups,
    } = useSWR<ModelNotificationGroupResponseItem[]>(
        open ? "/api/v1/notification-group" : null,
        swrFetcher,
    )
    const domains = parseDDNSDomains(draft.domains_raw)
    const webhook = draft.provider === "webhook"
    const keepsSecret = !!data?.id && data.provider === draft.provider
    const availableProviders = [
        ...new Set([...providers, ...(data?.provider ? [data.provider] : [])]),
    ]
    const field = (name: keyof DDNSDraft, value: unknown) => {
        setDraft((previous) => ({ ...previous, [name]: value }))
        setErrors((previous) => ({ ...previous, [name]: "" }))
    }
    const changeOpen = (next: boolean) => {
        if (saving.current) return
        if (next) {
            const fresh = ddnsDraft(data)
            if (!data && !availableProviders.includes(fresh.provider))
                fresh.provider = availableProviders[0] ?? ""
            setDraft(fresh)
            setErrors({})
            setFailure("")
            setShowSecret(false)
        } else {
            // Do not retain secrets or cancelled drafts between dialog openings.
            setDraft(ddnsDraft())
        }
        setOpen(next)
    }
    const inputProps = (name: keyof DDNSDraft) => ({
        id: id + "-" + name,
        "aria-invalid": !!errors[name],
        "aria-describedby": errors[name] ? id + "-" + name + "-error" : undefined,
    })
    const error = (name: keyof DDNSDraft) =>
        errors[name] ? (
            <p id={id + "-" + name + "-error"} role="alert" className="text-xs text-destructive">
                {errors[name]}
            </p>
        ) : null
    const label = (name: keyof DDNSDraft, text: string) => (
        <label className="text-sm font-medium" htmlFor={id + "-" + name}>
            {text}
        </label>
    )
    const submit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (saving.current) return
        const nextErrors = validateDDNSDraft(draft, data)
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length) {
            document.getElementById(id + "-" + Object.keys(nextErrors)[0])?.focus()
            return
        }
        saving.current = true
        setBusy(true)
        setFailure("")
        try {
            const payload = ddnsPayload(draft)
            if (data?.id) await updateDDNSProfile(data.id, payload)
            else await createDDNSProfile(payload)
        } catch {
            setFailure("保存失败，请检查权限、配置或网络后重试。当前输入已保留。")
            saving.current = false
            setBusy(false)
            return
        }
        setOpen(false)
        setDraft(ddnsDraft())
        setShowSecret(false)
        toast.success("DDNS 配置已保存")
        try {
            await mutate()
        } catch {
            toast.error("配置已保存，列表刷新失败，请手动刷新。")
        } finally {
            saving.current = false
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={changeOpen}>
            <DialogTrigger asChild>
                {data ? (
                    <IconButton variant="outline" icon="edit" aria-label="编辑 DDNS" />
                ) : (
                    <Button aria-label="添加 DDNS" disabled={!providers.length}>
                        <Plus className="mr-2 h-4 w-4" />
                        新建 DDNS
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="ddns-editor flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-lg p-0">
                <DialogHeader className="shrink-0 border-b px-4 py-4 pr-10 text-left sm:px-6">
                    <DialogTitle>{data ? "编辑 DDNS" : "新建 DDNS"}</DialogTitle>
                    <DialogDescription>
                        配置域名随关联节点 IP 更新；保存不会立即执行 DNS 更新。
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex min-h-0 flex-1 flex-col overflow-hidden"
                    onSubmit={submit}
                    noValidate
                >
                    <div className="ddns-editor-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
                        <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
                            <div className="space-y-4">
                                <section className="space-y-3" aria-label="基本配置">
                                    <h3 className="font-semibold">基本配置</h3>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            {label("name", "名称")}
                                            <Input
                                                {...inputProps("name")}
                                                value={draft.name}
                                                onChange={(e) => field("name", e.target.value)}
                                                placeholder="例如：家中服务器"
                                                autoComplete="off"
                                            />
                                            {error("name")}
                                        </div>
                                        <div className="space-y-1.5">
                                            {label("provider", "DNS 提供商")}
                                            <select
                                                {...inputProps("provider")}
                                                className="ddns-select"
                                                value={draft.provider}
                                                onChange={(e) => field("provider", e.target.value)}
                                            >
                                                {!draft.provider && (
                                                    <option value="">请选择提供商</option>
                                                )}
                                                {availableProviders.map((p) => (
                                                    <option key={p} value={p}>
                                                        {ddnsProviderName(p)}
                                                    </option>
                                                ))}
                                            </select>
                                            {error("provider")}
                                        </div>
                                    </div>
                                </section>

                                <section className="space-y-3 border-t pt-4" aria-label="解析记录">
                                    <h3 className="font-semibold">解析记录</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {(["enable_ipv4", "enable_ipv6"] as const).map((key, i) => (
                                            <label
                                                key={key}
                                                className="flex items-center justify-between gap-2 rounded-md border p-3"
                                            >
                                                <span>
                                                    <span className="block font-medium">
                                                        IPv{i === 0 ? "4" : "6"}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {i === 0 ? "A 记录" : "AAAA 记录"}
                                                    </span>
                                                </span>
                                                <Switch
                                                    aria-label={i === 0 ? "启用 IPv4" : "启用 IPv6"}
                                                    checked={!!draft[key]}
                                                    onCheckedChange={(value) => field(key, value)}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                    {!draft.enable_ipv4 && !draft.enable_ipv6 && (
                                        <p className="text-xs text-muted-foreground">
                                            IPv4 / IPv6 均已关闭，此配置不会更新解析记录。
                                        </p>
                                    )}
                                    <div className="space-y-1.5">
                                        {label("domains_raw", "域名")}
                                        <Textarea
                                            {...inputProps("domains_raw")}
                                            rows={2}
                                            placeholder={"home.example.com\nnas.example.com"}
                                            value={draft.domains_raw}
                                            onChange={(e) => field("domains_raw", e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            每行一个，或用逗号分隔；重复域名自动合并。支持中文域名。
                                        </p>
                                        {error("domains_raw")}
                                    </div>
                                    {!!domains.length && (
                                        <div className="flex flex-wrap gap-2" aria-label="域名预览">
                                            {domains.map((domain) => (
                                                <span
                                                    key={domain}
                                                    className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                                                >
                                                    <span className="min-w-0 break-all">
                                                        {domain}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="shrink-0 rounded p-1 hover:bg-muted focus-visible:outline focus-visible:outline-2"
                                                        aria-label={"移除域名 " + domain}
                                                        onClick={() =>
                                                            field(
                                                                "domains_raw",
                                                                domains
                                                                    .filter((d) => d !== domain)
                                                                    .join("\n"),
                                                            )
                                                        }
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                <section
                                    className="space-y-3 border-t pt-4"
                                    aria-label="提供商配置"
                                >
                                    <h3 className="font-semibold">
                                        {webhook ? "Webhook 请求" : "提供商凭据"}
                                    </h3>
                                    {draft.provider === "dummy" ? (
                                        <p className="text-sm text-muted-foreground">
                                            Dummy 不会向 DNS 提供商更新记录，无需填写凭据。
                                        </p>
                                    ) : (
                                        <>
                                            {(draft.provider === "tencentcloud" ||
                                                webhook ||
                                                !["cloudflare", "he"].includes(draft.provider)) && (
                                                <div className="space-y-1.5">
                                                    {label(
                                                        "access_id",
                                                        draft.provider === "tencentcloud"
                                                            ? "SecretId"
                                                            : "凭据 ID",
                                                    )}
                                                    <Input
                                                        {...inputProps("access_id")}
                                                        value={draft.access_id ?? ""}
                                                        autoComplete="off"
                                                        onChange={(e) =>
                                                            field("access_id", e.target.value)
                                                        }
                                                    />
                                                    {error("access_id")}
                                                </div>
                                            )}
                                            <div className="space-y-1.5">
                                                {label(
                                                    "access_secret",
                                                    draft.provider === "cloudflare"
                                                        ? "API Token"
                                                        : draft.provider === "tencentcloud"
                                                          ? "SecretKey"
                                                          : draft.provider === "he"
                                                            ? "DDNS Key"
                                                            : "凭据密钥（可选）",
                                                )}
                                                <div className="flex gap-2">
                                                    <Input
                                                        {...inputProps("access_secret")}
                                                        type={showSecret ? "text" : "password"}
                                                        autoComplete="new-password"
                                                        value={draft.access_secret ?? ""}
                                                        placeholder={
                                                            keepsSecret
                                                                ? "留空保留已保存的密钥"
                                                                : "填写此提供商的密钥"
                                                        }
                                                        onChange={(e) =>
                                                            field("access_secret", e.target.value)
                                                        }
                                                    />
                                                    <Button
                                                        type="button"
                                                        size="icon"
                                                        variant="outline"
                                                        aria-label={
                                                            showSecret ? "隐藏密钥" : "显示密钥"
                                                        }
                                                        onClick={() => setShowSecret((v) => !v)}
                                                    >
                                                        {showSecret ? (
                                                            <EyeOff className="h-4 w-4" />
                                                        ) : (
                                                            <Eye className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    {keepsSecret
                                                        ? "旧密钥不回显；仅填写新值时替换。"
                                                        : "密钥仅在保存时提交，不会在列表显示。"}
                                                    {draft.provider === "cloudflare" &&
                                                        " 请使用有目标区域 DNS 编辑权限的 API Token。"}
                                                </p>
                                                {error("access_secret")}
                                            </div>
                                        </>
                                    )}
                                    {webhook && (
                                        <>
                                            <div className="space-y-1.5">
                                                {label("webhook_url", "Webhook URL")}
                                                <Input
                                                    {...inputProps("webhook_url")}
                                                    value={draft.webhook_url ?? ""}
                                                    placeholder="https://ddns.example.com/?ip=#ip#"
                                                    onChange={(e) =>
                                                        field("webhook_url", e.target.value)
                                                    }
                                                />
                                                {error("webhook_url")}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    {label("webhook_method", "请求方法")}
                                                    <select
                                                        {...inputProps("webhook_method")}
                                                        className="ddns-select"
                                                        value={draft.webhook_method}
                                                        onChange={(e) =>
                                                            field(
                                                                "webhook_method",
                                                                Number(e.target.value),
                                                            )
                                                        }
                                                    >
                                                        {Object.entries(ddnsTypes).map(
                                                            ([value, text]) => (
                                                                <option key={value} value={value}>
                                                                    {text}
                                                                </option>
                                                            ),
                                                        )}
                                                    </select>
                                                    {error("webhook_method")}
                                                </div>
                                                <div className="space-y-1.5">
                                                    {label("webhook_request_type", "请求格式")}
                                                    <select
                                                        {...inputProps("webhook_request_type")}
                                                        className="ddns-select"
                                                        value={draft.webhook_request_type}
                                                        onChange={(e) =>
                                                            field(
                                                                "webhook_request_type",
                                                                Number(e.target.value),
                                                            )
                                                        }
                                                    >
                                                        {Object.entries(ddnsRequestTypes).map(
                                                            ([value, text]) => (
                                                                <option key={value} value={value}>
                                                                    {text}
                                                                </option>
                                                            ),
                                                        )}
                                                    </select>
                                                    {error("webhook_request_type")}
                                                </div>
                                            </div>
                                            <div className="space-y-1.5">
                                                {label("webhook_headers", "请求头（JSON）")}
                                                <Textarea
                                                    {...inputProps("webhook_headers")}
                                                    rows={2}
                                                    value={draft.webhook_headers ?? ""}
                                                    placeholder={
                                                        keepsSecret
                                                            ? "留空保留原有请求头"
                                                            : '{"Authorization":"Bearer #access_secret#"}'
                                                    }
                                                    onChange={(e) =>
                                                        field("webhook_headers", e.target.value)
                                                    }
                                                />
                                                {error("webhook_headers")}
                                                <p className="text-xs text-muted-foreground">
                                                    请求头可能包含凭据，旧值不回显，留空不修改。
                                                </p>
                                            </div>
                                            <div className="space-y-1.5">
                                                {label("webhook_request_body", "请求体")}
                                                <Textarea
                                                    {...inputProps("webhook_request_body")}
                                                    rows={3}
                                                    value={draft.webhook_request_body ?? ""}
                                                    placeholder={
                                                        '{"ip":"#ip#","domain":"#domain#"}'
                                                    }
                                                    onChange={(e) =>
                                                        field(
                                                            "webhook_request_body",
                                                            e.target.value,
                                                        )
                                                    }
                                                />
                                                <p className="break-words text-xs text-muted-foreground">
                                                    可用变量：#ip#、#domain#、#type#、#record#、#access_id#、#access_secret#。Form
                                                    格式的请求体也以 JSON 对象填写。
                                                </p>
                                            </div>
                                        </>
                                    )}
                                </section>

                                <section
                                    className="space-y-3 border-t pt-4"
                                    aria-label="通知与重试"
                                >
                                    <h3 className="font-semibold">通知与重试</h3>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            {label("max_retries", "最大重试次数")}
                                            <Input
                                                {...inputProps("max_retries")}
                                                type="number"
                                                min={1}
                                                max={10}
                                                step={1}
                                                value={
                                                    Number.isNaN(draft.max_retries)
                                                        ? ""
                                                        : draft.max_retries
                                                }
                                                onChange={(e) =>
                                                    field(
                                                        "max_retries",
                                                        e.target.value === ""
                                                            ? NaN
                                                            : Number(e.target.value),
                                                    )
                                                }
                                            />
                                            {error("max_retries")}
                                        </div>
                                        <div className="space-y-1.5">
                                            {label("notification_group_id", "DDNS 结果通知组")}
                                            <select
                                                {...inputProps("notification_group_id")}
                                                className="ddns-select"
                                                value={draft.notification_group_id}
                                                onChange={(e) =>
                                                    field(
                                                        "notification_group_id",
                                                        Number(e.target.value),
                                                    )
                                                }
                                            >
                                                <option value="0">不发送 DDNS 通知</option>
                                                {notifierGroup?.map((item) => (
                                                    <option
                                                        key={item.group.id}
                                                        value={item.group.id}
                                                    >
                                                        {item.group.name}
                                                    </option>
                                                ))}
                                                {!!draft.notification_group_id &&
                                                    !notifierGroup?.some(
                                                        (item) =>
                                                            item.group.id ===
                                                            draft.notification_group_id,
                                                    ) && (
                                                        <option value={draft.notification_group_id}>
                                                            通知组 #{draft.notification_group_id}
                                                            （加载中或不可用）
                                                        </option>
                                                    )}
                                            </select>
                                            {error("notification_group_id")}
                                        </div>
                                    </div>
                                    {groupError && (
                                        <p role="alert" className="text-xs text-destructive">
                                            通知组读取失败，原有选择不会被清空。
                                            <button
                                                type="button"
                                                className="ml-2 underline"
                                                onClick={() => void retryGroups()}
                                            >
                                                重试
                                            </button>
                                        </p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                        每个域名的 A / AAAA
                                        操作完成重试后通知最终结果；在通知组对应的通知中启用 DDNS
                                        成功 / 失败模块。成功表示服务商请求执行成功，不保证 DNS
                                        缓存立即刷新。
                                    </p>
                                </section>
                                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                                    {domains.length} 个域名 ·{" "}
                                    {[draft.enable_ipv4 && "A", draft.enable_ipv6 && "AAAA"]
                                        .filter(Boolean)
                                        .join(" + ") || "未启用解析"}
                                    <span className="mt-1 block">
                                        保存后，请在服务器编辑中启用 DDNS 并关联此配置。
                                    </span>
                                </div>
                                {failure && (
                                    <p role="alert" className="text-sm text-destructive">
                                        {failure}
                                    </p>
                                )}
                            </div>
                        </fieldset>
                    </div>
                    <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t px-4 py-3 sm:px-6">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => changeOpen(false)}
                        >
                            取消
                        </Button>
                        <Button type="submit" disabled={busy || !draft.provider}>
                            {busy ? "保存中…" : "保存配置"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
