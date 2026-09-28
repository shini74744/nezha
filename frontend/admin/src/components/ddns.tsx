import { swrFetcher } from "@/api/api"
import { createDDNSProfile, updateDDNSProfile } from "@/api/ddns"
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
import { conv } from "@/lib/utils"
import { asOptionalField } from "@/lib/utils"
import { ModelDDNSProfile, ModelNotificationGroupResponseItem } from "@/types"
import { ddnsRequestTypes, ddnsTypes } from "@/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR, { KeyedMutator } from "swr"
import { z } from "zod"

import { Textarea } from "./ui/textarea"

interface DDNSCardProps {
    data?: ModelDDNSProfile
    providers: string[]
    mutate: KeyedMutator<ModelDDNSProfile[]>
}

const ddnsFormSchema = z.object({
    notification_group_id: z.coerce.number().int().min(0),
    max_retries: z.coerce.number().int().min(1),
    enable_ipv4: asOptionalField(z.boolean()),
    enable_ipv6: asOptionalField(z.boolean()),
    name: z.string().min(1),
    provider: z.string(),
    domains: z.array(z.string()),
    domains_raw: z.string(),
    access_id: asOptionalField(z.string()),
    access_secret: asOptionalField(z.string()),
    webhook_url: asOptionalField(z.string().url()),
    webhook_method: asOptionalField(z.coerce.number().int().min(1).max(255)),
    webhook_request_type: asOptionalField(z.coerce.number().int().min(1).max(255)),
    webhook_request_body: asOptionalField(z.string()),
    webhook_headers: asOptionalField(z.string()),
})

type DDNSFormInput = z.input<typeof ddnsFormSchema>
type DDNSFormData = z.output<typeof ddnsFormSchema>

export const DDNSCard: React.FC<DDNSCardProps> = ({ data, providers, mutate }) => {
    const { t } = useTranslation()
    const form = useForm<DDNSFormInput, unknown, DDNSFormData>({
        resolver: zodResolver(ddnsFormSchema),
        defaultValues: data
            ? {
                  notification_group_id: data.notification_group_id ?? 0,
                  max_retries: data.max_retries ?? 3,
                  enable_ipv4: data.enable_ipv4 ?? false,
                  enable_ipv6: data.enable_ipv6 ?? false,
                  name: data.name ?? "",
                  provider: data.provider ?? "dummy",
                  domains: data.domains ?? [],
                  domains_raw: conv.arrToStr(data.domains ?? []),
                  access_id: data.access_id ?? "",
                  access_secret: data.access_secret ?? "",
                  webhook_url: data.webhook_url ?? "",
                  webhook_method: data.webhook_method,
                  webhook_request_type: data.webhook_request_type,
                  webhook_request_body: data.webhook_request_body ?? "",
                  webhook_headers: data.webhook_headers ?? "",
              }
            : {
                  notification_group_id: 0,
                  max_retries: 3,
                  enable_ipv4: false,
                  enable_ipv6: false,
                  name: "",
                  provider: "dummy",
                  domains: [],
                  domains_raw: "",
                  access_id: "",
                  access_secret: "",
                  webhook_url: "",
                  webhook_method: undefined,
                  webhook_request_type: undefined,
                  webhook_request_body: "",
                  webhook_headers: "",
              },
        resetOptions: {
            keepDefaultValues: false,
        },
    })

    const [open, setOpen] = useState(false)
    const { data: notifierGroup, error: groupError } = useSWR<ModelNotificationGroupResponseItem[]>(
        open ? "/api/v1/notification-group" : null,
        swrFetcher,
    )

    const onSubmit = async (values: DDNSFormData) => {
        try {
            values.domains = conv.strToArr(values.domains_raw)
            if (data?.id) {
                await updateDDNSProfile(data.id, values)
            } else {
                await createDDNSProfile(values)
            }
        } catch (e) {
            console.error(e)
            toast(t("Error"), {
                description: t("Results.UnExpectedError"),
            })
            return
        }
        setOpen(false)
        await mutate()
        form.reset(values)
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {data ? (
                    <IconButton variant="outline" icon="edit" aria-label="编辑 DDNS" />
                ) : (
                    <IconButton icon="plus" aria-label="添加 DDNS" />
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
                <ScrollArea className="max-h-[calc(100dvh-5rem)] p-3">
                    <div className="items-center mx-1">
                        <DialogHeader>
                            <DialogTitle>{data ? t("EditDDNS") : t("CreateDDNS")}</DialogTitle>
                            <DialogDescription />
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2 my-2">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("Name")}</FormLabel>
                                            <FormControl>
                                                <Input placeholder="My DDNS Profile" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="provider"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("Provider")}</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                defaultValue={`${field.value}`}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select service type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {providers.map((v, i) => (
                                                        <SelectItem key={i} value={v}>
                                                            {v}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="domains_raw"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("Domains") + t("SeparateWithComma")}
                                            </FormLabel>
                                            <FormControl>
                                                <Input placeholder="www.example.com" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="access_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("Credential")} 1</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Token ID" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="access_secret"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("Credential")} 2</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Token Secret" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="max_retries"
                                    render={({ field }) => {
                                        const { value, ...fieldProps } = field
                                        return (
                                            <FormItem>
                                                <FormLabel>{t("MaximumRetryAttempts")}</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        placeholder="3"
                                                        value={String(value ?? "")}
                                                        {...fieldProps}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )
                                    }}
                                />
                                <FormField
                                    control={form.control}
                                    name="webhook_url"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Webhook URL</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="https://ddns.example.com/?record=#record#"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="webhook_method"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Webhook {t("RequestMethod")}</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                defaultValue={`${field.value}`}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Webhook Request Method" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {Object.entries(ddnsTypes).map(([k, v]) => (
                                                        <SelectItem key={k} value={k}>
                                                            {v}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="webhook_request_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Webhook {t("RequestType")}</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                defaultValue={`${field.value}`}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Webhook Request Type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {Object.entries(ddnsRequestTypes).map(
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
                                    name="webhook_headers"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Webhook {t("RequestHeader")}</FormLabel>
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
                                    name="webhook_request_body"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Webhook {t("RequestBody")}</FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    className="resize-y"
                                                    placeholder='{&#13;&#10; "ip": #ip#,&#13;&#10; "domain": "#domain#"&#13;&#10;}'
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="enable_ipv4"
                                    render={({ field }) => (
                                        <FormItem className="flex items-center space-x-2">
                                            <FormControl>
                                                <div className="flex items-center gap-2">
                                                    <Checkbox
                                                        checked={field.value === true}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                    <Label className="text-sm">
                                                        {t("Enable")} IPv4
                                                    </Label>
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="enable_ipv6"
                                    render={({ field }) => (
                                        <FormItem className="flex items-center space-x-2">
                                            <FormControl>
                                                <div className="flex items-center gap-2">
                                                    <Checkbox
                                                        checked={field.value === true}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                    <Label className="text-sm">
                                                        {t("Enable")} IPv6
                                                    </Label>
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="notification_group_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex items-center gap-2">
                                                DDNS 结果通知
                                                <details className="text-xs font-normal">
                                                    <summary
                                                        className="cursor-pointer"
                                                        aria-label="DDNS 通知说明"
                                                    >
                                                        ？
                                                    </summary>
                                                    <p className="mt-2">
                                                        每个域名的 A / AAAA
                                                        操作重试结束后通知最终结果。选择通知组后，在
                                                        TG 通知的“DDNS 更新成功 /
                                                        失败”模块勾选提示内容；默认关闭。保存配置本身不会执行
                                                        DNS
                                                        更新或发送测试。更新成功表示服务商请求执行成功，不保证所有
                                                        DNS 缓存已立即刷新。
                                                    </p>
                                                </details>
                                            </FormLabel>
                                            <FormControl>
                                                <select
                                                    aria-label="DDNS 结果通知组"
                                                    className="w-full rounded border bg-background p-2"
                                                    value={String(field.value)}
                                                    onChange={(e) =>
                                                        field.onChange(Number(e.target.value))
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
                                                    {Number(field.value) > 0 &&
                                                        !notifierGroup?.some(
                                                            (item) =>
                                                                item.group.id ===
                                                                Number(field.value),
                                                        ) && (
                                                            <option value={String(field.value)}>
                                                                通知组 #{String(field.value)}
                                                                （加载中或不可用）
                                                            </option>
                                                        )}
                                                </select>
                                            </FormControl>
                                            {groupError && (
                                                <p
                                                    role="alert"
                                                    className="text-xs text-destructive"
                                                >
                                                    通知组读取失败，请关闭后重试；原有选择不会被清空。
                                                </p>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <DialogFooter className="justify-end">
                                    <DialogClose asChild>
                                        <Button type="button" className="my-2" variant="secondary">
                                            {t("Close")}
                                        </Button>
                                    </DialogClose>
                                    <Button type="submit" className="my-2">
                                        {t("Confirm")}
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
