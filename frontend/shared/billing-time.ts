// Billing dates use Beijing (UTC+08:00), independent of the browser's zone.
// Explicit offsets are real instants; legacy unzoned values mean Beijing wall time.
export function parseBillingTime(value?: string): Date | undefined {
    if (!value || value.startsWith("0000-00-00")) return undefined
    let raw = value.trim().replace(" ", "T")
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += "T00:00:00+08:00"
    else if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += "+08:00"
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? undefined : d
}
export function beijingBillingISO(value?: string): string | undefined {
    const d = parseBillingTime(value)
    return d ? new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, -1) + "+08:00" : undefined
}
export function formatBillingTime(value?: string): string {
    const iso = beijingBillingISO(value)
    return iso ? iso.slice(0, 19).replace("T", " ") : value || "未设置"
}
// Calendar widgets exchange browser-local Date objects representing selected days.
export function billingCalendarDate(value?: string): Date | undefined {
    const iso = beijingBillingISO(value)
    if (!iso) return undefined
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
    return new Date(y, m - 1, d)
}
