import { z } from "zod"
import { normalizeNote, chineseNote } from "./public-note-compat"
import {safeLink} from "../../../shared/link-tags"

import i18n from "./i18n"

/**
 * Zod schema for PublicNote
 * Conventions:
 * - All fields are strings and may be empty
 * - IPv4/IPv6/autoRenewal must be "0" or "1"
 * - cycle is one of Day/Week/Month/Year
 * - Date fields can be empty, ISO-like, or the special value "0000-00-00T23:59:59+08:00"
 */
const placementSchema=z.object({x:z.number().min(-150).max(150).optional(),y:z.number().min(-150).max(150).optional(),scale:z.number().min(25).max(250).optional()}).passthrough();
const logoLayoutSchema=z.object({desktop:placementSchema.optional(),mobile:placementSchema.optional()}).passthrough();
export const PublicNoteSchema = z.object({
    billingDataMod: z
        .object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            autoRenewal: z.string().optional(),
            cycle: z.string().optional(),
            amount: z.string().optional(),
        }).passthrough()
        .optional(),
    planDataMod: z
        .object({
            providerLogo: z.object({logoLayout:logoLayoutSchema.optional(),logo:z.string().optional(),logoOriginal:z.string().optional(),logoWebsite:z.string().optional(),logoLibraryId:z.string().optional(),logoLibraryName:z.string().optional(),logoBackground:z.string().optional()}).passthrough().optional(),
            networkRouteLogos: z.record(z.string(),z.object({logo:z.string().optional(),logoOriginal:z.string().optional(),logoWebsite:z.string().optional(),logoLibraryId:z.string().optional(),logoLibraryName:z.string().optional(),logoBackground:z.string().optional()}).passthrough()).optional(),
            bandwidth: z.string().optional(),
            trafficVol: z.string().optional(),
            trafficType: z.string().optional(),
            resetDay: z.string().optional(),
            linkTags: z.array(z.object({name:z.string().max(60),url:z.string().max(2048)}).passthrough()).max(20).optional(),
            networkRouteEntries: z.array(z.object({carrier:z.string(),text:z.string(),country:z.string().optional(),name:z.string().optional(),logo:z.string().optional(),logoOriginal:z.string().optional(),logoWebsite:z.string().optional(),logoLibraryId:z.string().optional(),logoLibraryName:z.string().optional(),logoBackground:z.string().optional()}).passthrough()).max(50).optional(),
            networkRouteColors: z.object({telecom:z.string().optional(),mobile:z.string().optional(),unicom:z.string().optional(),other:z.string().optional()}).passthrough().optional(),
            networkRoutes: z.object({telecom:z.string().optional(),mobile:z.string().optional(),unicom:z.string().optional(),other:z.string().optional()}).passthrough().optional(),
            IPv4: z.string().optional(),
            IPv6: z.string().optional(),
            networkRoute: z.string().optional(),
            extra: z.string().optional(),
        }).passthrough()
        .optional(),
}).passthrough()

export type PublicNote = z.infer<typeof PublicNoteSchema>

export const defaultPublicNote: PublicNote = {}
export function parseEditableNote(raw:string):PublicNote {
 if(!raw.trim())return {};
 const obj=normalizeNote(JSON.parse(raw));
 if(!("billingDataMod" in obj)&&!("planDataMod" in obj)&&Object.keys(obj).length)throw Error("这段原始文本无法识别为套餐字段，请继续使用原始文本编辑");
 return PublicNoteSchema.parse(obj);
}
export function publicNoteRawText(raw?:string):string {
 if(!raw?.trim())return "";
 try{return chineseNote(parseEditableNote(raw))}catch{return raw}
}
export function serializePublicNote(note:PublicNote):string {
 const normalized=normalizeNote(note);
 if(normalized.planDataMod?.networkRoutes)
  normalized.planDataMod.networkRoute=[...["telecom","mobile","unicom","other"].map(k=>normalized.planDataMod.networkRoutes[k]?.trim()),...(normalized.planDataMod.networkRouteEntries||[]).map((e:{text:string})=>e.text.trim())].filter(Boolean).join(",");
 return JSON.stringify(normalized);
}

export const isValidISOLike = (v: string) => {
    if (!v) return true
    if (v === "0000-00-00T23:59:59+08:00") return true
    const d = new Date(v)
    return !isNaN(d.getTime())
}

export const normalizeISO = (v?: string) => {
    if (!v) return undefined
    if (v === "0000-00-00T23:59:59+08:00") return v
    const date = new Date(v)
    return isNaN(date.getTime()) ? v : date.toISOString()
}

/**
 * Parse a string into PublicNote; return the default object if not valid JSON or validation fails.
 */
export const parsePublicNote = (s?: string): PublicNote => {
    if (!s) return defaultPublicNote
    try {
        const obj = normalizeNote(JSON.parse(s))
        const parsed = PublicNoteSchema.safeParse(obj)
        if (parsed.success) {
            return parsed.data
        }
        return defaultPublicNote
    } catch {
        return defaultPublicNote
    }
}

export const validatePublicNote = (pn: PublicNote) => {
    const errors: Partial<Record<string, string>> = {}
    if(pn.planDataMod?.providerLogo?.logoLayout!==undefined&&!logoLayoutSchema.safeParse(pn.planDataMod.providerLogo.logoLayout).success)errors["plan.providerLogo"]="图标位置范围为 -150～150px，缩放范围为 25～250%";

    // Structural and enum validations
    if (pn.billingDataMod?.autoRenewal && !/^(0|1)$/.test(pn.billingDataMod.autoRenewal)) {
        errors["billing.autoRenewal"] = i18n.t("Validation.MustBe0Or1")
    }
    if (pn.billingDataMod?.cycle && !/^(Day|Week|Month|Year)$/i.test(pn.billingDataMod.cycle)) {
        errors["billing.cycle"] = i18n.t("Validation.MustBeDayWeekMonthYear")
    }
    if (pn.planDataMod?.trafficType && !/^(0|1|2|3)$/.test(pn.planDataMod.trafficType)) {
        errors["plan.trafficType"] = i18n.t("Validation.MustBe1Or2")
    }
    if (pn.planDataMod?.IPv4 !== undefined && !/^(0|1)$/.test(pn.planDataMod.IPv4)) {
        errors["plan.IPv4"] = i18n.t("Validation.MustBe0Or1")
    }
    if (pn.planDataMod?.IPv6 !== undefined && !/^(0|1)$/.test(pn.planDataMod.IPv6)) {
        errors["plan.IPv6"] = i18n.t("Validation.MustBe0Or1")
    }

    if (pn.planDataMod?.resetDay && !/^(?:[1-9]|[12][0-9]|3[01])$/.test(pn.planDataMod.resetDay)) errors["plan.resetDay"]="重置日必须为 1–31"

    if(pn.planDataMod?.linkTags?.some(t=>(t.name||t.url)&&(!t.name.trim()||!safeLink(t.url))))errors["plan.linkTags"]="链接标签需要名称和有效的 HTTP/HTTPS 网址";

    // Date validity checks
    if (pn.billingDataMod?.startDate && !isValidISOLike(pn.billingDataMod.startDate)) {
        errors["billing.startDate"] = i18n.t("Validation.InvalidDate")
    }
    if (pn.billingDataMod?.endDate && !isValidISOLike(pn.billingDataMod.endDate)) {
        errors["billing.endDate"] = i18n.t("Validation.InvalidDate")
    }

    return { errors, valid: Object.keys(errors).length === 0 }
}

/**
 * Detect default mode from string: JSON matching schema -> "structured"; otherwise "raw".
 */
export const detectPublicNoteMode = (s?: string): "structured" | "raw" => {
    if (!s?.trim()) return "structured"
    try {
        parseEditableNote(s)
        return "structured"
    } catch {
        return "raw"
    }
}

/**
 * Immutable patch by path, for use in component wrappers around setPublicNoteObj.
 * Example path: "billingDataMod.startDate"
 */
export const applyPublicNotePatch = (
    obj: PublicNote,
    path: string,
    value: string | undefined,
): PublicNote => {
    const keys = path.split(".")
    const draft: any = structuredClone ? structuredClone(obj) : JSON.parse(JSON.stringify(obj))
    let cur: any = draft
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]
        cur[k] = { ...(cur[k] ?? {}) }
        cur = cur[k]
    }
    cur[keys[keys.length - 1]] = value
    return draft
}

/**
 * Update a date field while preserving time parts: if the previous value is a valid date,
 * keep hours/minutes/seconds. Path example: "billingDataMod.startDate" | "billingDataMod.endDate"
 */
export const applyPublicNoteDate = (obj: PublicNote, path: string, date: Date): PublicNote => {
    const keys = path.split(".")
    const draft: any = structuredClone ? structuredClone(obj) : JSON.parse(JSON.stringify(obj))

    // Read previous value to preserve time components
    let curRead: any = draft
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]
        curRead = (curRead as any)[k]
        if (!curRead) break
    }
    const leafKey = keys[keys.length - 1]
    const prevVal: string | undefined = curRead ? curRead[leafKey] : undefined

    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    if (prevVal) {
        const pd = new Date(prevVal)
        if (!isNaN(pd.getTime())) {
            d.setHours(pd.getHours(), pd.getMinutes(), pd.getSeconds(), 0)
        }
    }

    // Write back
    let curWrite: any = draft
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]
        curWrite[k] = { ...(curWrite[k] ?? {}) }
        curWrite = curWrite[k]
    }
    curWrite[leafKey] = d.toISOString()
    return draft
}

/** Local browser time, matching the existing calendar and ISO save behavior. */
export const publicNoteTime = (value?: string): string => {
    const d = value ? new Date(value) : undefined
    if (!d || Number.isNaN(d.getTime())) return "00:00:00"
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, "0")).join(":")
}
export const publicNoteDateTimeLabel = (value?: string): string => {
    const d = value ? new Date(value) : undefined
    if (!d || Number.isNaN(d.getTime())) return "YYYY-MM-DD 00:00:00"
    return d.toLocaleDateString() + " " + publicNoteTime(value)
}
export const applyPublicNoteTime = (obj: PublicNote, path: "billingDataMod.startDate" | "billingDataMod.endDate", time: string): PublicNote => {
    if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(time)) return obj
    const value = obj.billingDataMod?.[path === "billingDataMod.startDate" ? "startDate" : "endDate"]
    const d = value ? new Date(value) : undefined
    if (!d || Number.isNaN(d.getTime())) return obj
    const [hours, minutes, seconds] = time.split(":").map(Number)
    d.setHours(hours, minutes, seconds, 0)
    return applyPublicNotePatch(obj, path, d.toISOString())
}

/**
 * Toggle the special "no expiry" value for endDate.
 */
export const toggleEndNoExpiry = (obj: PublicNote): PublicNote => {
    const NO_EXPIRY = "0000-00-00T23:59:59+08:00"
    const current = obj.billingDataMod?.endDate
    const next = current === NO_EXPIRY ? "" : NO_EXPIRY
    return applyPublicNotePatch(obj, "billingDataMod.endDate", next)
}
