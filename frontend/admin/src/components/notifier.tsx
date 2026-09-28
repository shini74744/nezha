import { createNotification, getNotificationEditor, updateNotification } from "@/api/notification"
import { getServers } from "@/api/server"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { IconButton } from "@/components/xui/icon-button"
import { eventGroups, eventKinds } from "@/lib/notification-events"
import {
    NotificationDraft,
    notificationErrorHint,
    parseTelegram,
    telegramDefaults,
    validateTelegram,
} from "@/lib/telegram-notification"
import { asOptionalField } from "@/lib/utils"
import { ModelNotification } from "@/types"
import { nrequestMethods, nrequestTypes } from "@/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useId, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR from "swr"
import { KeyedMutator } from "swr"
import { z } from "zod"

import { TelegramNotificationEditor } from "./telegram-notification-editor"
import { Textarea } from "./ui/textarea"

interface NotifierCardProps {
    data?: ModelNotification
    mutate: KeyedMutator<ModelNotification[]>
}

const notificationFormSchema = z.object({
    event_templates: z
        .object({
            enabled: z.boolean(),
            modules: z.record(
                z.string(),
                z.object({
                    mode: z.enum(["inherit", "fields", "disabled"]),
                    title: z.string().max(120),
                    fields: z.array(z.string()),
                }),
            ),
        })
        .optional(),
    name: z.string().min(1),
    url: z.string().url(),
    request_method: z.coerce.number().int().min(1).max(255),
    request_type: z.coerce.number().int().min(1).max(255),
    request_header: z.string(),
    request_body: z.string(),
    verify_tls: asOptionalField(z.boolean()),
    skip_check: asOptionalField(z.boolean()),
    format_metric_units: asOptionalField(z.boolean()),
})

export const NotifierCard: React.FC<NotifierCardProps> = ({ data, mutate }) => {
    const { t } = useTranslation()
    type NotificationFormInput = z.input<typeof notificationFormSchema>
    type NotificationFormData = z.output<typeof notificationFormSchema>
    type NotificationDefaults = ModelNotification &
        Partial<Pick<NotificationFormData, "skip_check">>
    const notificationDefaults: NotificationDefaults | undefined = data

    const form = useForm<NotificationFormInput, unknown, NotificationFormData>({
        resolver: zodResolver(notificationFormSchema),
        defaultValues: data
            ? {
                  name: data.name ?? "",
                  url: data.url ?? "",
                  request_method: data.request_method ?? 1,
                  request_type: data.request_type ?? 1,
                  request_header: data.request_header ?? "",
                  request_body: data.request_body ?? "",
                  verify_tls: data.verify_tls ?? false,
                  skip_check: notificationDefaults?.skip_check ?? false,
                  format_metric_units: data.format_metric_units ?? false,
              }
            : {
                  name: "",
                  url: "",
                  request_method: 1,
                  request_type: 1,
                  request_header: "",
                  request_body: "",
                  verify_tls: false,
                  skip_check: false,
                  format_metric_units: false,
              },
        resetOptions: {
            keepDefaultValues: false,
        },
    })

    const formId = useId()
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState<"telegram" | "raw">("telegram")
    const [testKind, setTestKind] = useState("offline")
    const [testServer, setTestServer] = useState("0")
    const { data: testServers, error: testServersError } = useSWR(
        open && mode === "telegram" ? "notification-test-servers" : null,
        getServers,
    )
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState(false)
    const [saveError, setSaveError] = useState("")
    useEffect(() => {
        let cancelled = false
        setSaveError("")
        setTestKind("offline")
        setTestServer("0")
        if (!open) {
            form.reset()
            return
        }
        setLoadError(false)
        if (!data?.id) {
            form.reset({ ...telegramDefaults })
            setMode("telegram")
            return
        }
        setLoading(true)
        getNotificationEditor(data.id)
            .then((config) => {
                if (cancelled) return
                form.reset({ ...config, skip_check: !!parseTelegram(config) })
                setMode(parseTelegram(config) ? "telegram" : "raw")
            })
            .catch(() => {
                if (!cancelled) setLoadError(true)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [open, data?.id, form])

    const watched = form.watch()
    const draftValues: NotificationDraft = {
        ...watched,
        skip_check: watched.skip_check === true,
        verify_tls: watched.verify_tls === true,
        format_metric_units: watched.format_metric_units === true,
        request_method: Number(watched.request_method),
        request_type: Number(watched.request_type),
    }
    const switchToTelegram = () => {
        if (!parseTelegram(draftValues)) {
            if (
                draftValues.url &&
                !window.confirm(
                    "将当前 HTTP 配置替换为 Telegram 模板？尚未保存的原始配置会被替换。",
                )
            )
                return
            form.reset({ ...telegramDefaults, name: form.getValues("name") })
        }
        setMode("telegram")
    }

    const onSubmit = async (values: NotificationFormData) => {
        setSaveError("")
        if (mode === "telegram") {
            const tg = parseTelegram(values)
            const error = tg
                ? validateTelegram(tg)
                : "请检查高级配置；当前内容无法作为 Telegram 模板读取。"
            if (error) {
                setSaveError(error)
                return
            }
        }
        if (
            !values.skip_check &&
            mode === "telegram" &&
            values.event_templates?.enabled &&
            values.event_templates.modules[testKind]?.mode === "disabled"
        ) {
            setSaveError("当前状态设为不发送，请先调整处理方式或选择仅保存。")
            return
        }
        const payload = {
            ...values,
            ...(!values.skip_check && mode === "telegram"
                ? { test_event: { kind: testKind, server_id: Number(testServer) } }
                : {}),
        }
        try {
            if (data?.id) {
                await updateNotification(data.id, payload)
            } else {
                await createNotification(payload)
            }
        } catch (e) {
            const message = parseTelegram(values)
                ? notificationErrorHint(e)
                : "通知配置未保存，请检查 HTTP 请求配置、编辑权限和服务器网络。错误详情可能含凭据，因此不会直接显示。"
            setSaveError(message)
            toast.error(t("Error"), { description: message })
            return
        }
        toast.success(
            values.skip_check ? "通知配置已保存，未发送测试消息" : "测试请求已成功，通知配置已保存",
        )
        setOpen(false)
        await mutate()
        form.reset()
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (form.formState.isSubmitting) return
                if (next && data?.id) setLoading(true)
                setOpen(next)
            }}
        >
            <DialogTrigger asChild>
                {data ? (
                    <IconButton variant="outline" icon="edit" aria-label="编辑通知" />
                ) : (
                    <IconButton icon="plus" aria-label="添加通知" />
                )}
            </DialogTrigger>
            <DialogContent className={mode === "telegram" ? "sm:max-w-4xl" : "sm:max-w-xl"}>
                <ScrollArea className="max-h-[calc(100dvh-5rem)] p-3">
                    <div className="items-center mx-1">
                        <DialogHeader>
                            <DialogTitle>
                                {data ? t("EditNotifier") : t("CreateNotifier")}
                            </DialogTitle>
                            <DialogDescription />
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 my-2">
                                {loading && <p role="status">正在安全读取通知配置…</p>}
                                {loadError && (
                                    <p role="alert" className="text-sm text-destructive">
                                        无法读取配置，请确认你有编辑权限后关闭重试。为避免覆盖旧配置，当前禁止保存。
                                    </p>
                                )}
                                <fieldset
                                    disabled={loading || loadError || form.formState.isSubmitting}
                                    className="space-y-3 min-w-0"
                                >
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t("Name")}</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="My Notifier" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="flex flex-wrap gap-2" aria-label="通知编辑模式">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={mode === "telegram" ? "default" : "outline"}
                                            onClick={switchToTelegram}
                                        >
                                            Telegram 可视化
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={mode === "raw" ? "default" : "outline"}
                                            onClick={() => setMode("raw")}
                                        >
                                            通用 Webhook / 原始配置
                                        </Button>
                                    </div>
                                    {mode === "telegram" && !loading && !loadError && (
                                        <TelegramNotificationEditor
                                            testKind={testKind}
                                            onTestKindChange={setTestKind}
                                            value={draftValues}
                                            id={data?.id}
                                            onChange={(next) => {
                                                setSaveError("")
                                                form.setValue(
                                                    "event_templates",
                                                    next.event_templates,
                                                    { shouldDirty: true },
                                                )
                                                form.setValue("url", next.url, {
                                                    shouldDirty: true,
                                                })
                                                form.setValue("request_body", next.request_body, {
                                                    shouldDirty: true,
                                                })
                                            }}
                                        />
                                    )}
                                    <details
                                        key={mode}
                                        open={mode === "raw" ? true : undefined}
                                        className="space-y-2 rounded-lg border p-3"
                                    >
                                        <summary className="cursor-pointer text-sm">
                                            高级 HTTP 配置（含凭据）
                                        </summary>
                                        {mode === "telegram" && (
                                            <p className="text-xs text-muted-foreground">
                                                可视化编辑和这里使用同一份配置；未编辑的扩展参数会保留。
                                            </p>
                                        )}
                                        <FormField
                                            control={form.control}
                                            name="url"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>URL</FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="request_method"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("RequestMethod")}</FormLabel>
                                                    <Select
                                                        onValueChange={field.onChange}
                                                        value={`${field.value}`}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Request Method" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {Object.entries(nrequestMethods).map(
                                                                ([k, v]) => (
                                                                    <SelectItem key={k} value={k}>
                                                                        {v}
                                                                    </SelectItem>
                                                                ),
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="request_type"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("Type")}</FormLabel>
                                                    <Select
                                                        onValueChange={field.onChange}
                                                        value={`${field.value}`}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Request Type" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {Object.entries(nrequestTypes).map(
                                                                ([k, v]) => (
                                                                    <SelectItem key={k} value={k}>
                                                                        {v}
                                                                    </SelectItem>
                                                                ),
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="request_header"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("RequestHeader")}</FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            className="resize-y"
                                                            placeholder='{"User-Agent":"Nezha-Agent"}'
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="request_body"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("RequestBody")}</FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            className="resize-y h-[240px]"
                                                            placeholder='{&#13;&#10;  "content":"#NEZHA#",&#13;&#10;  "ServerName":"#SERVER.NAME#",&#13;&#10;  "ServerIP":"#SERVER.IP#",&#13;&#10;  "ServerIPV4":"#SERVER.IPV4#",&#13;&#10;  "ServerIPV6":"#SERVER.IPV6#",&#13;&#10;  "CPU":"#SERVER.CPU#",&#13;&#10;  "MEM":"#SERVER.MEM#",&#13;&#10;  "SWAP":"#SERVER.SWAP#",&#13;&#10;  "DISK":"#SERVER.DISK#",&#13;&#10;  "NetInSpeed":"#SERVER.NETINSPEED#",&#13;&#10;  "NetOutSpeed":"#SERVER.NETOUTSPEED#",&#13;&#10;  "TransferIn":"#SERVER.TRANSFERIN#",&#13;&#10;  "TranferOut":"#SERVER.TRANSFEROUT#",&#13;&#10;  "Load1":"#SERVER.LOAD1#",&#13;&#10;  "Load5":"#SERVER.LOAD5#",&#13;&#10;  "Load15":"#SERVER.LOAD15#",&#13;&#10;  "TCP_CONN_COUNT":"#SERVER.TCPCONNCOUNT",&#13;&#10;  "UDP_CONN_COUNT":"#SERVER.UDPCONNCOUNT"&#13;&#10;}'
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </details>
                                    <FormField
                                        control={form.control}
                                        name="verify_tls"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center space-x-2">
                                                <FormControl>
                                                    <div className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={formId + "-verify_tls"}
                                                            aria-label={t("VerifyTLS")}
                                                            checked={field.value === true}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                        <Label
                                                            className="text-sm"
                                                            htmlFor={formId + "-verify_tls"}
                                                        >
                                                            {t("VerifyTLS")}
                                                        </Label>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="skip_check"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center space-x-2">
                                                <FormControl>
                                                    <div className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={formId + "-skip_check"}
                                                            aria-label={t("DoNotSendTestMessage")}
                                                            checked={field.value === true}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                        <Label
                                                            className="text-sm"
                                                            htmlFor={formId + "-skip_check"}
                                                        >
                                                            {t("DoNotSendTestMessage")}
                                                        </Label>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="format_metric_units"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center space-x-2">
                                                <FormControl>
                                                    <div className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={formId + "-format_metric_units"}
                                                            aria-label={t("FormatMetricUnits")}
                                                            checked={field.value === true}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                        <Label
                                                            className="text-sm"
                                                            htmlFor={
                                                                formId + "-format_metric_units"
                                                            }
                                                        >
                                                            {t("FormatMetricUnits")}
                                                        </Label>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {mode === "telegram" && !watched.skip_check && (
                                        <section
                                            aria-label="发送测试设置"
                                            className="rounded border p-3 space-y-2"
                                        >
                                            <label className="block text-sm">
                                                测试事件（与上方状态同步）
                                                <select
                                                    aria-label="测试事件"
                                                    className="w-full rounded border bg-background p-2"
                                                    value={testKind}
                                                    onChange={(e) => setTestKind(e.target.value)}
                                                >
                                                    {eventGroups.map((group) => (
                                                        <optgroup
                                                            key={group.id}
                                                            label={group.label}
                                                        >
                                                            {group.kinds.map((kind) => (
                                                                <option key={kind} value={kind}>
                                                                    {
                                                                        eventKinds.find(
                                                                            ([key]) => key === kind,
                                                                        )?.[1]
                                                                    }
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block text-sm">
                                                测试数据
                                                <select
                                                    aria-label="测试数据"
                                                    className="w-full rounded border bg-background p-2"
                                                    value={testServer}
                                                    onChange={(e) => setTestServer(e.target.value)}
                                                >
                                                    <option value="0">
                                                        模拟数据（不使用真实服务器）
                                                    </option>
                                                    {(testServers ?? []).map((server) => (
                                                        <option key={server.id} value={server.id}>
                                                            {server.name}（ID：{server.id}）
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            {testServersError && (
                                                <p role="alert">
                                                    服务器列表读取失败，仍可使用模拟数据。
                                                </p>
                                            )}
                                            <p className="text-xs text-muted-foreground">
                                                消息会标记“测试”。指定服务器只读取当前快照；状态、IP
                                                变更及 DDNS 结果均为模拟，不会修改机器、DNS
                                                或执行触发任务。实际发送使用当前未保存的模块设置；上方预览仍为示例数据。
                                            </p>
                                        </section>
                                    )}
                                    <p className="rounded border p-2 text-sm" role="status">
                                        {watched.skip_check
                                            ? "本次操作：仅保存配置，不向 Telegram 或其他通知地址发送消息。"
                                            : mode === "telegram"
                                              ? `本次操作：发送一条真实测试消息 · ${eventKinds.find(([kind]) => kind === testKind)?.[1]} · ${testServer === "0" ? "模拟数据" : "指定服务器快照"}；成功后保存，失败则不保存。`
                                              : "本次操作：发送一条通用 Webhook 测试消息，成功后保存；失败则不保存。"}
                                    </p>
                                    {saveError && (
                                        <p role="alert" className="text-sm text-destructive">
                                            {saveError}
                                        </p>
                                    )}
                                </fieldset>
                                <DialogFooter className="justify-end">
                                    <DialogClose asChild>
                                        <Button type="button" className="my-2" variant="secondary">
                                            {t("Close")}
                                        </Button>
                                    </DialogClose>
                                    <Button
                                        type="submit"
                                        className="my-2"
                                        disabled={
                                            loading || loadError || form.formState.isSubmitting
                                        }
                                    >
                                        {form.formState.isSubmitting
                                            ? "处理中…"
                                            : watched.skip_check
                                              ? "仅保存"
                                              : "发送测试并保存"}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
