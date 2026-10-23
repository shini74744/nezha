export type PlanValueKind = "bandwidth" | "amount" | "traffic"

export const planValueUnits = {
    bandwidth: ["Mbps", "Gbps", "Tbps"],
    amount: ["CNY", "USD", "EUR"],
    traffic: ["MB", "GB", "TB", "PB"],
} as const

export const defaultPlanValueUnit = { bandwidth: "Mbps", amount: "CNY", traffic: "GB" }
const numberPattern = "(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)"
const numberOnly = new RegExp("^" + numberPattern + "$")

export function splitPlanValue(kind: PlanValueKind, value = ""): { amount: string; unit?: string } | null {
    if (typeof value !== "string") return null
    const text = value.trim()
    if (!text || numberOnly.test(text)) return { amount: text }
    if (kind === "amount" && text === "-1") return { amount: text }
    if (kind === "bandwidth") {
        // Lowercase b is bits. Do not reinterpret MBps (bytes) as Mbps.
        const match = text.match(new RegExp("^(" + numberPattern + ")\\s*([mMgGtT])b[pP][sS]$"))
        return match ? { amount: match[1], unit: match[2].toUpperCase() + "bps" } : null
    }
    if (kind === "traffic") {
        const match = text.match(new RegExp("^(" + numberPattern + ")\\s*([MGTP])B?(?:\\s*/\\s*(?:月|Month))?$", "i"))
        return match ? { amount: match[1], unit: match[2].toUpperCase() + "B" } : null
    }
    const aliases: Record<string, string> = {
        CNY: "CNY", RMB: "CNY", "人民币": "CNY", "元": "CNY", "￥": "CNY", "¥": "CNY",
        USD: "USD", "美元": "USD", "美刀": "USD", "刀": "USD", "$": "USD",
        EUR: "EUR", "欧元": "EUR", "欧": "EUR", "€": "EUR",
    }
    const tokens = "(CNY|RMB|USD|EUR|人民币|元|￥|¥|美元|美刀|刀|\\$|欧元|欧|€)"
    const suffix = text.match(new RegExp("^(" + numberPattern + ")\\s*" + tokens + "$", "i"))
    if (suffix) return { amount: suffix[1], unit: aliases[suffix[2].toUpperCase()] }
    const prefix = text.match(new RegExp("^" + tokens + "\\s*(" + numberPattern + ")$", "i"))
    return prefix ? { amount: prefix[2], unit: aliases[prefix[1].toUpperCase()] } : null
}

export function formatPlanValue(kind: PlanValueKind, amount: string, unit: string): string {
    if (!amount.trim()) return ""
    // These exact values are the established free / pay-as-you-go sentinels.
    if (kind === "amount" && (amount === "-1" || Number(amount) === 0)) return Number(amount) === 0 ? "0" : "-1"
    const normalized = (amount.startsWith(".") ? "0" + amount : amount).replace(/\.$/, "")
    return normalized + unit + (kind === "traffic" ? "/月" : "")
}
