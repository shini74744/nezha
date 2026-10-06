import { updateServer } from "@/api/server"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { IconButton } from "@/components/xui/icon-button"
import {
    type PublicNote,
    applyPublicNoteDate,
    applyPublicNoteTime,
    publicNoteTime,
    publicNoteDateTimeLabel,
    billingCalendarDate,
    applyPublicNotePatch,
    detectPublicNoteMode,
    normalizeISO,
    parseEditableNote,
    publicNoteRawText,
    serializePublicNote,
    parsePublicNote,
    toggleEndNoExpiry,
    validatePublicNote,
} from "@/lib/public-note"
import { chineseNote, patchRoutes, readRoutes, routeFields } from "@/lib/public-note-compat"
import OtherRoutesEditor from "./OtherRoutesEditor"
import CarrierColorPicker from "./CarrierColorPicker"
import ProviderLogoEditor from "./ProviderLogoEditor"
import SettingHelp from "./SettingHelp"
import LinkTagsEditor from "./LinkTagsEditor"
import { conv } from "@/lib/utils"
import { asOptionalField } from "@/lib/utils"
import { ModelServer } from "@/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { HelpCircle } from "lucide-react"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { KeyedMutator } from "swr"
import { z } from "zod"

function BillingTimePicker({value,label,onChange}:{value?:string;label:string;onChange:(time:string)=>void}) {
    const parts = publicNoteTime(value).split(":")
    const disabled = !value || Number.isNaN(new Date(value).getTime())
    return <div data-billing-time-picker className="border-t p-3 space-y-2">
        <div className="flex items-center gap-1 text-xs">
            时分秒
            <SettingHelp label="时分秒">使用浏览器本地时区，与上方日期一致。新选日期默认 00:00:00；修改日期保留已设置的时间。请先选择日期，清除日期或设为不过期时不可设置时间。</SettingHelp>
        </div>
        <div className="flex items-center gap-2">
            {["小时","分钟","秒"].map((part,index)=><select
                key={part} aria-label={label+part} disabled={disabled} value={parts[index]}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                onChange={e=>{const next=[...parts];next[index]=e.target.value;onChange(next.join(":"))}}
            >
                {Array.from({length:index===0?24:60},(_,i)=>String(i).padStart(2,"0")).map(v=><option key={v} value={v}>{v}</option>)}
            </select>)}
        </div>
    </div>
}

interface ServerCardProps {
    data: ModelServer
    mutate: KeyedMutator<ModelServer[]>
}

export const serverFormSchema = z.object({
    name: z.string().min(1),
    note: asOptionalField(z.string()),
    // Raw text may contain arbitrary JSON or plain text. Structured-mode
    // validation runs in onSubmit against the fields the user actually edited.
    public_note: asOptionalField(z.string()),
    display_index: z.coerce.number().int(),
    hide_for_guest: asOptionalField(z.boolean()),
    hide_for_display: asOptionalField(z.boolean()),
    connectivity_disabled: asOptionalField(z.boolean()),
    bgp_disabled: asOptionalField(z.boolean()),
    streaming_disabled: asOptionalField(z.boolean()),
    enable_ddns: asOptionalField(z.boolean()),
    ddns_profiles: asOptionalField(z.array(z.number())),
    ddns_profiles_raw: asOptionalField(z.string()),
    override_ddns_domains: asOptionalField(z.record(z.string(), z.array(z.string()))),
    override_ddns_domains_raw: asOptionalField(
        z.string().refine(
            (val) => {
                try {
                    JSON.parse(val)
                    return true
                } catch {
                    return false
                }
            },
            {
                message: "Invalid JSON string",
            },
        ),
    ),
})

export const ServerCard: React.FC<ServerCardProps> = ({ data, mutate }) => {
    const { t } = useTranslation()
    const form = useForm({
        resolver: zodResolver(serverFormSchema) as any,
        defaultValues: {
            ...data,
            ddns_profiles_raw: data.ddns_profiles ? conv.arrToStr(data.ddns_profiles) : undefined,
            override_ddns_domains_raw: data.override_ddns_domains
                ? JSON.stringify(data.override_ddns_domains)
                : undefined,
        },
        resetOptions: {
            keepDefaultValues: false,
        },
    })
    const enableDDNS = useWatch({ control: form.control, name: "enable_ddns" })

    const [open, setOpen] = useState(false)

    const [publicNoteObj, setPublicNoteObj] = useState<PublicNote>(
        parsePublicNote(data?.public_note),
    )
    const [publicNoteErrors, setPublicNoteErrors] = useState<
        Partial<
            Record<
                | "billing.startDate"
                | "billing.endDate"
                | "billing.autoRenewal"
                | "billing.cycle"
                | "billing.amount"
                | "plan.bandwidth"
                | "plan.trafficVol"
                | "plan.trafficType"
                | "plan.resetDay"
                | "plan.linkTags"
                | "plan.IPv4"
                | "plan.IPv6"
                | "plan.extra",
                string
            >
        >
    >({})

    const [publicNoteMode, setPublicNoteMode] = useState<"structured" | "raw">(
        detectPublicNoteMode(data?.public_note),
    )
    const [publicNoteRaw, setPublicNoteRaw] = useState<string>(publicNoteRawText(data?.public_note))

    const patchPublicNote = (path: string, value: string | undefined) => {
        setPublicNoteObj((prev) => applyPublicNotePatch(prev, path, value))
    }
    const patchPublicNoteDate = (
        path: "billingDataMod.startDate" | "billingDataMod.endDate",
        d: Date,
    ) => {
        setPublicNoteObj((prev) => applyPublicNoteDate(prev, path, d))
    }
    const toggleEndNoExpiryLocal = () => {
        setPublicNoteObj((prev) => toggleEndNoExpiry(prev))
    }

    const onSubmit = async (values: any) => {
        try {
            values.ddns_profiles = values.ddns_profiles_raw
                ? conv.strToArr(values.ddns_profiles_raw).map(Number)
                : undefined
            values.override_ddns_domains = values.override_ddns_domains_raw
                ? JSON.parse(values.override_ddns_domains_raw)
                : undefined

            if (publicNoteMode === "raw") {
                const raw = (publicNoteRaw ?? "").trim()
                if (raw.length === 0) {
                    values.public_note = undefined
                } else {
                    // Keep arbitrary legacy notes raw, but save recognized bilingual JSON
                    // in the established English storage format for all existing themes.
                    if (detectPublicNoteMode(raw) === "structured") {
                        const parsed = parseEditableNote(raw)
                        const check = validatePublicNote(parsed)
                        if (!check.valid) {
                            toast("公开备注设置无效", { description: Object.values(check.errors).join("；") })
                            return
                        }
                        values.public_note = serializePublicNote(parsed)
                    } else values.public_note = raw
                }
            } else {
                const { errors, valid } = validatePublicNote(publicNoteObj)
                if (!valid) {
                    setPublicNoteErrors(errors)
                    toast(t("Error"), { description: t("Validation.InvalidForm") })
                    return
                }
                setPublicNoteErrors({})

                const bd = publicNoteObj.billingDataMod
                const pd = publicNoteObj.planDataMod
                const pnNormalized: PublicNote = {
                    ...publicNoteObj,
                    billingDataMod: bd && {
                        ...bd,
                        startDate: normalizeISO(bd.startDate),
                        endDate: normalizeISO(bd.endDate),
                    },
                    planDataMod: pd,
                }
                const jsonStr = serializePublicNote(pnNormalized)
                values.public_note = jsonStr.length > 2 ? jsonStr : undefined
            }

            await updateServer(data!.id!, values)
        } catch (e) {
            console.error(e)
            toast(t("Error"), {
                description: t("Results.UnExpectedError"),
            })
            return
        }
        setOpen(false)
        await mutate()
        form.reset()
    }

    const handleOpenChange = (v: boolean) => {
        if (v) {
            form.reset({
                ...data,
                ddns_profiles_raw: data.ddns_profiles
                    ? conv.arrToStr(data.ddns_profiles)
                    : undefined,
                override_ddns_domains_raw: data.override_ddns_domains
                    ? JSON.stringify(data.override_ddns_domains)
                    : undefined,
            })
            setPublicNoteObj(parsePublicNote(data?.public_note))
            setPublicNoteRaw(publicNoteRawText(data?.public_note))
            setPublicNoteMode(detectPublicNoteMode(data?.public_note))
            setPublicNoteErrors({})
        }
        setOpen(v)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <IconButton variant="outline" icon="edit" aria-label={t("EditServer")} />
            </DialogTrigger>
            <DialogContent
                className="sm:max-w-xl"
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                <ScrollArea className="max-h-[calc(100dvh-5rem)] p-3">
                    <div className="items-center mx-1">
                        <DialogHeader>
                            <DialogTitle>{t("EditServer")}</DialogTitle>
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
                                                <Input placeholder="My Server" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="display_index"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("Weight")}</FormLabel>
                                            <FormControl>
                                                <Input type="number" placeholder="0" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {enableDDNS ? (
                                    <>
                                        <FormField
                                            control={form.control}
                                            name="ddns_profiles_raw"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("DDNSProfiles") + t("SeparateWithComma")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="1,2,3" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="override_ddns_domains_raw"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("OverrideDDNSDomains")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Textarea className="resize-y" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </>
                                ) : (
                                    <></>
                                )}

                                <div data-server-visibility-options className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-6">
                                    <FormField
                                        control={form.control}
                                        name="enable_ddns"
                                        render={({ field }) => (
                                            <FormItem className="flex min-h-8 items-center gap-1 space-y-0 whitespace-nowrap sm:gap-2">
                                                <FormControl>
                                                    <Checkbox aria-label={t("EnableDDNS")} checked={field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                                <FormLabel className="cursor-pointer text-xs sm:text-sm">{t("EnableDDNS")}</FormLabel>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="hide_for_guest"
                                        render={({ field }) => (
                                            <FormItem className="flex min-h-8 items-center gap-1 space-y-0 whitespace-nowrap sm:gap-2">
                                                <FormControl>
                                                    <Checkbox aria-label={t("HideForGuest")} checked={field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                                <FormLabel className="cursor-pointer text-xs sm:text-sm">{t("HideForGuest")}</FormLabel>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="hide_for_display"
                                        render={({ field }) => (
                                            <FormItem className="flex min-h-8 items-center gap-1 space-y-0 whitespace-nowrap sm:gap-2">
                                                <FormControl>
                                                    <Checkbox aria-label="普通隐藏" checked={!!field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                                <FormLabel className="cursor-pointer text-xs sm:text-sm">普通隐藏</FormLabel>
                                                <button type="button" title="仅未登录访客默认不展示，连续点击前台小鸡插画 5 下展开，再点 5 下收起。登录后不受普通隐藏影响。不是权限保护；同时勾选“对游客隐藏”时，仍需管理员或所属用户登录。" aria-label="普通隐藏说明" className="flex min-h-6 min-w-6 items-center justify-center text-muted-foreground"><HelpCircle size={14} /></button>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <FormField
                                    control={form.control}
                                    name="note"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("Private") + t("Note")}</FormLabel>
                                            <FormControl>
                                                <Textarea className="resize-none" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {/* Public Note controls (optional + dual mode) */}
                                <div className="space-y-3">
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <FormLabel>{t("PublicNote.Label")}</FormLabel>
                                                <a
                                                    href="https://nezha.wiki/guide/servers.html#%E5%85%AC%E5%BC%80%E5%A4%87%E6%B3%A8%E8%AE%BE%E7%BD%AE"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                                >
                                                    <HelpCircle className="h-4 w-4" />
                                                </a>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Toggle: when disabled, hide edit controls and submit an empty value */}
                                    <div className="flex items-center gap-4">
                                        {/* Mode switch: Raw text / Custom fields */}
                                        <div className="flex items-center gap-2">
                                            {/* Show 'structured' first, then 'raw' */}
                                            <Button
                                                type="button"
                                                variant={
                                                    publicNoteMode === "structured"
                                                        ? "default"
                                                        : "outline"
                                                }
                                                className="text-xs h-7"
                                                onClick={() => {
                                                    if (publicNoteMode === "structured") return
                                                    try {
                                                        setPublicNoteObj(parseEditableNote(publicNoteRaw))
                                                        setPublicNoteMode("structured")
                                                    } catch {
                                                        toast("无法转换为自定义字段", { description: "请检查 JSON 格式和中英文字段冲突；原始内容已保留，不会清空。" })
                                                    }
                                                }}
                                            >
                                                {t("PublicNote.CustomFields")}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant={
                                                    publicNoteMode === "raw" ? "default" : "outline"
                                                }
                                                className="text-xs h-7"
                                                onClick={() => {
                                                    if (publicNoteMode === "raw") return
                                                    setPublicNoteRaw(chineseNote(publicNoteObj))
                                                    setPublicNoteMode("raw")
                                                }}
                                            >
                                                {t("PublicNote.RawText")}
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Raw text mode: shown by default; submission uses this string */}
                                    {publicNoteMode === "raw" && (
                                        <div>
                                            <Textarea
                                                className="resize-y"
                                                aria-label="公开备注原始文本"
                                                value={publicNoteRaw}
                                                onChange={(e) => setPublicNoteRaw(e.target.value)}
                                                rows={10}
                                            />
                                            <p className="text-xs text-muted-foreground mt-2">支持中文或旧英文字段；识别到的套餐信息会自动回填。保存使用兼容格式，未知字段保留。</p>
                                        </div>
                                    )}

                                    {/* Custom fields mode: keep structured editing; serialize to string on submit */}
                                    {publicNoteMode === "structured" && (
                                        <>
                                            <div className="rounded-md border p-3 space-y-3">
                                                <div className="text-sm font-medium opacity-80">
                                                    {t("PublicNote.Billing")} <span className="text-xs text-muted-foreground">（北京时间 UTC+8）</span>
                                                </div>
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">
                                                            {t("PublicNote.StartDate")}
                                                        </Label>
                                                        {/* Add 'Clear' button to allow removing the date */}
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="text-xs px-2 py-0 h-auto bg-gray-200 dark:bg-gray-700 ml-2"
                                                            onClick={() =>
                                                                patchPublicNote(
                                                                    "billingDataMod.startDate",
                                                                    undefined,
                                                                )
                                                            }
                                                        >
                                                            {t("PublicNote.ClearDate") ?? "Clear"}
                                                        </Button>
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    className="w-full justify-start text-left font-normal tabular-nums"
                                                                    type="button"
                                                                    aria-label={t("PublicNote.StartDate")+"日期时间"}
                                                                >
                                                                    {publicNoteDateTimeLabel(publicNoteObj.billingDataMod?.startDate)}
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent
                                                                className="p-0 w-[300px] max-w-[calc(100vw-32px)] max-h-[70dvh] overflow-y-auto"
                                                                align="start"
                                                            >
                                                                <div>
                                                                    <Calendar
                                                                        className="w-full min-h-[320px]"
                                                                        mode="single"
                                                                        captionLayout="dropdown"
                                                                        startMonth={
                                                                            new Date(2000, 0)
                                                                        }
                                                                        endMonth={
                                                                            new Date(2050, 11)
                                                                        }
                                                                        selected={
                                                                            publicNoteObj
                                                                                .billingDataMod
                                                                                ?.startDate
                                                                                ? billingCalendarDate(
                                                                                      publicNoteObj
                                                                                          .billingDataMod!
                                                                                          .startDate!,
                                                                                  )
                                                                                : undefined
                                                                        }
                                                                        onSelect={(d) => {
                                                                            if (!d) return
                                                                            patchPublicNoteDate(
                                                                                "billingDataMod.startDate",
                                                                                d,
                                                                            )
                                                                        }}
                                                                        autoFocus
                                                                    />
                                                                    <BillingTimePicker
                                                                        value={publicNoteObj.billingDataMod?.startDate}
                                                                        label={t("PublicNote.StartDate")}
                                                                        onChange={time=>setPublicNoteObj(prev=>applyPublicNoteTime(prev,"billingDataMod.startDate",time))}
                                                                    />
                                                                </div>
                                                            </PopoverContent>
                                                        </Popover>
                                                        {publicNoteErrors["billing.startDate"] && (
                                                            <p className="text-xs text-destructive mt-1">
                                                                {
                                                                    publicNoteErrors[
                                                                        "billing.startDate"
                                                                    ]
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs">
                                                                {t("PublicNote.EndDate")}
                                                            </Label>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                className="text-xs px-2 py-0 h-auto bg-gray-200 dark:bg-gray-700"
                                                                onClick={toggleEndNoExpiryLocal}
                                                            >
                                                                {publicNoteObj.billingDataMod
                                                                    ?.endDate ===
                                                                "0000-00-00T23:59:59+08:00"
                                                                    ? t("PublicNote.CancelNoExpiry")
                                                                    : t("PublicNote.SetNoExpiry")}
                                                            </Button>
                                                            {/* Add 'Clear' button to allow removing the date */}
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                className="text-xs px-2 py-0 h-auto bg-gray-200 dark:bg-gray-700"
                                                                onClick={() =>
                                                                    patchPublicNote(
                                                                        "billingDataMod.endDate",
                                                                        undefined,
                                                                    )
                                                                }
                                                            >
                                                                {t("PublicNote.ClearDate") ??
                                                                    "Clear"}
                                                            </Button>
                                                        </div>
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    className="w-full justify-start text-left font-normal tabular-nums"
                                                                    type="button"
                                                                    aria-label={t("PublicNote.EndDate")+"日期时间"}
                                                                >
                                                                    {publicNoteObj.billingDataMod?.endDate === "0000-00-00T23:59:59+08:00"
                                                                        ? t("PublicNote.NoExpiry")
                                                                        : publicNoteDateTimeLabel(publicNoteObj.billingDataMod?.endDate)}
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent
                                                                className="p-0 w-[300px] max-w-[calc(100vw-32px)] max-h-[70dvh] overflow-y-auto"
                                                                align="start"
                                                            >
                                                                <div>
                                                                    <Calendar
                                                                        className="w-full min-h-[320px]"
                                                                        mode="single"
                                                                        captionLayout="dropdown"
                                                                        startMonth={
                                                                            new Date(2000, 0)
                                                                        }
                                                                        endMonth={
                                                                            new Date(2050, 11)
                                                                        }
                                                                        selected={
                                                                            publicNoteObj
                                                                                .billingDataMod
                                                                                ?.endDate &&
                                                                            publicNoteObj
                                                                                .billingDataMod
                                                                                ?.endDate !==
                                                                                "0000-00-00T23:59:59+08:00"
                                                                                ? billingCalendarDate(
                                                                                      publicNoteObj
                                                                                          .billingDataMod
                                                                                          ?.endDate as string,
                                                                                  )
                                                                                : undefined
                                                                        }
                                                                        onSelect={(d) => {
                                                                            if (!d) return
                                                                            patchPublicNoteDate(
                                                                                "billingDataMod.endDate",
                                                                                d,
                                                                            )
                                                                        }}
                                                                        autoFocus
                                                                    />
                                                                    <BillingTimePicker
                                                                        value={publicNoteObj.billingDataMod?.endDate}
                                                                        label={t("PublicNote.EndDate")}
                                                                        onChange={time=>setPublicNoteObj(prev=>applyPublicNoteTime(prev,"billingDataMod.endDate",time))}
                                                                    />
                                                                </div>
                                                            </PopoverContent>
                                                        </Popover>

                                                        {publicNoteErrors["billing.endDate"] && (
                                                            <p className="text-xs text-destructive mt-1">
                                                                {
                                                                    publicNoteErrors[
                                                                        "billing.endDate"
                                                                    ]
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs">
                                                                {t("PublicNote.AutoRenewal")}
                                                            </Label>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-3">
                                                            <span className="text-xs">
                                                                {t("PublicNote.Disabled")}
                                                            </span>
                                                            <Switch
                                                                checked={
                                                                    publicNoteObj.billingDataMod
                                                                        ?.autoRenewal === "1"
                                                                }
                                                                onCheckedChange={(checked) =>
                                                                    patchPublicNote(
                                                                        "billingDataMod.autoRenewal",
                                                                        checked ? "1" : undefined,
                                                                    )
                                                                }
                                                            />
                                                            <span className="text-xs">
                                                                {t("PublicNote.Enabled")}
                                                            </span>
                                                        </div>

                                                        {publicNoteErrors[
                                                            "billing.autoRenewal"
                                                        ] && (
                                                            <p className="text-xs text-destructive mt-1">
                                                                {
                                                                    publicNoteErrors[
                                                                        "billing.autoRenewal"
                                                                    ]
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs">
                                                                {t("PublicNote.Cycle")}
                                                            </Label>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                className="text-xs px-2 py-0 h-auto bg-gray-200 dark:bg-gray-700"
                                                                onClick={() =>
                                                                    patchPublicNote(
                                                                        "billingDataMod.cycle",
                                                                        undefined,
                                                                    )
                                                                }
                                                            >
                                                                {t("PublicNote.Clear") ?? "Clear"}
                                                            </Button>
                                                        </div>
                                                        <Select
                                                            onValueChange={(val) =>
                                                                patchPublicNote(
                                                                    "billingDataMod.cycle",
                                                                    val,
                                                                )
                                                            }
                                                            value={
                                                                publicNoteObj.billingDataMod?.cycle
                                                            }
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select cycle" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="Day">
                                                                    {t("PublicNote.Day")}
                                                                </SelectItem>
                                                                <SelectItem value="Week">
                                                                    {t("PublicNote.Week")}
                                                                </SelectItem>
                                                                <SelectItem value="Month">
                                                                    {t("PublicNote.Month")}
                                                                </SelectItem>
                                                                <SelectItem value="Year">
                                                                    {t("PublicNote.Year")}
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        {publicNoteErrors["billing.cycle"] && (
                                                            <p className="text-xs text-destructive mt-1">
                                                                {publicNoteErrors["billing.cycle"]}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1 sm:col-span-2">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs">
                                                                {t("PublicNote.Amount")}
                                                            </Label>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                className="text-xs px-2 py-0 h-auto bg-gray-200 dark:bg-gray-700"
                                                                onClick={() =>
                                                                    patchPublicNote(
                                                                        "billingDataMod.amount",
                                                                        "0",
                                                                    )
                                                                }
                                                            >
                                                                {t("PublicNote.Free")}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                className="text-xs px-2 py-0 h-auto bg-gray-200 dark:bg-gray-700"
                                                                onClick={() =>
                                                                    patchPublicNote(
                                                                        "billingDataMod.amount",
                                                                        "-1",
                                                                    )
                                                                }
                                                            >
                                                                {t("PublicNote.PayAsYouGo")}
                                                            </Button>
                                                        </div>
                                                        <Input
                                                            placeholder="200EUR"
                                                            value={
                                                                publicNoteObj.billingDataMod?.amount
                                                            }
                                                            onChange={(e) =>
                                                                patchPublicNote(
                                                                    "billingDataMod.amount",
                                                                    e.target.value,
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="rounded-md border p-3 space-y-3">
                                                <div className="text-sm font-medium opacity-80">
                                                    {t("PublicNote.Plan")}
                                                </div>
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">
                                                            {t("PublicNote.Bandwidth")}
                                                        </Label>
                                                        <Input
                                                            placeholder="30Mbps"
                                                            value={
                                                                publicNoteObj.planDataMod?.bandwidth
                                                            }
                                                            onChange={(e) =>
                                                                patchPublicNote(
                                                                    "planDataMod.bandwidth",
                                                                    e.target.value,
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center flex-wrap gap-2">
                                                            <Label className="text-xs">{t("PublicNote.TrafficVolume")}</Label>
                                                            {[["500G","500G/月"],["1T","1T/月"],["无限","无限流量"]].map(([label,value])=>(
                                                                <Button key={label} type="button" variant="outline" className="text-xs px-2 py-0 h-auto"
                                                                    onClick={()=>patchPublicNote("planDataMod.trafficVol",value)}>{label}</Button>
                                                            ))}
                                                        </div>
                                                        <Input
                                                            placeholder="1TB/Month"
                                                            value={
                                                                publicNoteObj.planDataMod
                                                                    ?.trafficVol
                                                            }
                                                            onChange={(e) =>
                                                                patchPublicNote(
                                                                    "planDataMod.trafficVol",
                                                                    e.target.value,
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs">
                                                                {t("PublicNote.TrafficType")}
                                                            </Label>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                className="text-xs px-2 py-0 h-auto bg-gray-200 dark:bg-gray-700"
                                                                onClick={() =>
                                                                    patchPublicNote(
                                                                        "planDataMod.trafficType",
                                                                        undefined,
                                                                    )
                                                                }
                                                            >
                                                                {t("PublicNote.Clear") ?? "Clear"}
                                                            </Button>
                                                        </div>
                                                        <Select
                                                            onValueChange={(val) =>
                                                                patchPublicNote(
                                                                    "planDataMod.trafficType",
                                                                    val,
                                                                )
                                                            }
                                                            value={
                                                                publicNoteObj.planDataMod
                                                                    ?.trafficType ?? ""
                                                            }
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select type" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="0">未指定（默认双向）</SelectItem>
                                                                <SelectItem value="3">上传（出站）</SelectItem>
                                                                <SelectItem value="1">
                                                                    下载（入站）
                                                                </SelectItem>
                                                                <SelectItem value="2">
                                                                    {t("PublicNote.Both")}
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        {publicNoteErrors["plan.trafficType"] && (
                                                            <p className="text-xs text-destructive mt-1">
                                                                {
                                                                    publicNoteErrors[
                                                                        "plan.trafficType"
                                                                    ]
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3" data-ip-options>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">
                                                            {t("PublicNote.IPv4")}
                                                        </Label>
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <span className="text-xs">
                                                                {t("PublicNote.None")}
                                                            </span>
                                                            <Switch
                                                                checked={
                                                                    publicNoteObj.planDataMod
                                                                        ?.IPv4 === "1"
                                                                }
                                                                onCheckedChange={(checked) =>
                                                                    patchPublicNote(
                                                                        "planDataMod.IPv4",
                                                                        checked ? "1" : "0",
                                                                    )
                                                                }
                                                            />
                                                            <span className="text-xs">
                                                                {t("PublicNote.Has")}
                                                            </span>
                                                        </div>
                                                        {publicNoteErrors["plan.IPv4"] && (
                                                            <p className="text-xs text-destructive mt-1">
                                                                {publicNoteErrors["plan.IPv4"]}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">
                                                            {t("PublicNote.IPv6")}
                                                        </Label>
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <span className="text-xs">
                                                                {t("PublicNote.None")}
                                                            </span>
                                                            <Switch
                                                                checked={
                                                                    publicNoteObj.planDataMod
                                                                        ?.IPv6 === "1"
                                                                }
                                                                onCheckedChange={(checked) =>
                                                                    patchPublicNote(
                                                                        "planDataMod.IPv6",
                                                                        checked ? "1" : "0",
                                                                    )
                                                                }
                                                            />
                                                            <span className="text-xs">
                                                                {t("PublicNote.Has")}
                                                            </span>
                                                        </div>
                                                        {publicNoteErrors["plan.IPv6"] && (
                                                            <p className="text-xs text-destructive mt-1">
                                                                {publicNoteErrors["plan.IPv6"]}
                                                            </p>
                                                        )}
                                                    </div>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:col-span-2" data-network-feature-settings>
                                                        {([
                                                            ["connectivity_disabled", "连通性"],
                                                            ["bgp_disabled", "BGP"],
                                                            ["streaming_disabled", "流媒体"],
                                                        ] as const).map(([name, label]) => (
                                                            <FormField key={name} control={form.control} name={name} render={({ field }) => (
                                                                <FormItem className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 space-y-0 rounded-md border p-3" data-connectivity-setting={name === "connectivity_disabled" ? "" : undefined}>
                                                                    <div className="flex min-w-0 items-center">
                                                                        <FormLabel className="whitespace-nowrap">{label}</FormLabel>
                                                                        <SettingHelp label={label}>默认开启；关闭后隐藏前台标签并停止对应检测。</SettingHelp>
                                                                    </div>
                                                                    <FormControl><Switch className="shrink-0" aria-label={label} checked={!field.value} onCheckedChange={checked => field.onChange(!checked)} /></FormControl>
                                                                </FormItem>
                                                            )} />
                                                        ))}
                                                    </div>
                                                    <ProviderLogoEditor note={publicNoteObj} onChange={setPublicNoteObj} serverId={data.id} name={form.watch('name')}/>
                                                    <LinkTagsEditor note={publicNoteObj} onChange={setPublicNoteObj}/>
                                                    {publicNoteErrors["plan.linkTags"]&&<p className="text-xs text-destructive">{publicNoteErrors["plan.linkTags"]}</p>}
                                                    <fieldset className="space-y-2 sm:col-span-2">
                                                        <legend className="text-xs font-medium">网络路由<SettingHelp label="网络路由">按电信、移动、联通排序；同一运营商的多条线路用逗号分隔。无法确定的旧线路保留在“其他运营商”，可选择地区和 Logo。</SettingHelp></legend>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                            {routeFields.filter(route=>route.key!=="other").map(route => (
                                                                <div key={route.key} className="space-y-1">
                                                                    <CarrierColorPicker label={route.label} fallback={route.color}
                                                                        value={publicNoteObj.planDataMod?.networkRouteColors?.[route.key]}
                                                                        onChange={color=>setPublicNoteObj(prev=>({...prev,planDataMod:{...prev.planDataMod,
                                                                            networkRouteColors:{...prev.planDataMod?.networkRouteColors,[route.key]:color}}}))}/>
                                                                    <Input id={"route-"+route.key} placeholder={route.placeholder}
                                                                        value={readRoutes(publicNoteObj.planDataMod)[route.key]}
                                                                        onChange={e=>setPublicNoteObj(prev=>patchRoutes(prev,route.key,e.target.value))}/>

                                                                </div>
                                                            ))}
                                                            <OtherRoutesEditor note={publicNoteObj} onChange={setPublicNoteObj}/>
                                                        </div>
                                                    </fieldset>
                                                    <div className="space-y-1 sm:col-span-2">
                                                        <div className="flex items-center"><Label htmlFor="traffic-reset-day" className="text-xs">流量重置日</Label><SettingHelp label="流量重置日">每月该日北京时间 00:00 开始新周期，历史记录保留；没有该日则取月末。留空使用账单开始日期的日号，无开始日期则为 1 日。未指定流量类型按双向统计。</SettingHelp></div>
                                                        <Input id="traffic-reset-day" type="number" min={1} max={31} placeholder="1–31，可留空"
                                                            value={publicNoteObj.planDataMod?.resetDay ?? ""}
                                                            onChange={e=>patchPublicNote("planDataMod.resetDay",e.target.value)}/>
                                                        {publicNoteErrors["plan.resetDay"] && <p className="text-xs text-destructive">{publicNoteErrors["plan.resetDay"]}</p>}
                                                    </div>
                                                    <div className="space-y-1 sm:col-span-2">
                                                        <Label className="text-xs">
                                                            {t("PublicNote.Extra")}
                                                        </Label>
                                                        <Input
                                                            placeholder={t(
                                                                "PublicNote.CommaSeparated",
                                                            )}
                                                            value={
                                                                publicNoteObj.planDataMod?.extra ??
                                                                ""
                                                            }
                                                            onChange={(e) =>
                                                                patchPublicNote(
                                                                    "planDataMod.extra",
                                                                    e.target.value,
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                                <DialogFooter className="justify-end">
                                    <DialogClose asChild>
                                        <Button type="button" className="my-2" variant="secondary">
                                            {t("Close")}
                                        </Button>
                                    </DialogClose>
                                    <Button type="submit" className="my-2">
                                        {t("Submit")}
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
