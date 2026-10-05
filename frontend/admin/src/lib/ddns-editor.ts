import { ModelDDNSForm, ModelDDNSProfile } from "@/types"

export const ddnsProviderLabels: Record<string, string> = {
    cloudflare: "Cloudflare",
    tencentcloud: "腾讯云 DNSPod",
    he: "HE.net",
    webhook: "Webhook",
    dummy: "不更新 DNS（Dummy）",
}
export const ddnsProviderName = (provider: string) => ddnsProviderLabels[provider] || provider

export function parseDDNSDomains(raw: string): string[] {
    return [
        ...new Set(
            raw
                .split(/[,，\s]+/u)
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
        ),
    ]
}

export function validDDNSDomain(value: string): boolean {
    if (/[/:?#@\\]/.test(value) || value.length > 253) return false
    const domain = value.replace(/\.$/, "")
    try {
        const ascii = new URL("https://" + domain).hostname
        return (
            ascii.includes(".") &&
            ascii
                .split(".")
                .every(
                    (part) =>
                        part.length > 0 &&
                        part.length <= 63 &&
                        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part),
                ) &&
            !/^[\d.]+$/.test(ascii)
        )
    } catch {
        return false
    }
}

export type DDNSDraft = ModelDDNSForm & { domains_raw: string }
export function ddnsDraft(data?: ModelDDNSProfile): DDNSDraft {
    return {
        name: data?.name ?? "",
        provider: data?.provider ?? "cloudflare",
        domains: [...(data?.domains ?? [])],
        domains_raw: (data?.domains ?? []).join("\n"),
        enable_ipv4: data ? (data.enable_ipv4 ?? false) : true,
        enable_ipv6: data?.enable_ipv6 ?? false,
        max_retries: data?.max_retries ?? 3,
        notification_group_id: data?.notification_group_id ?? 0,
        access_id: data?.access_id ?? "",
        access_secret: "",
        webhook_url: data?.webhook_url ?? "",
        webhook_headers: "",
        webhook_method: data?.webhook_method || 1,
        webhook_request_type: data?.webhook_request_type || 1,
        webhook_request_body: data?.webhook_request_body ?? "",
    }
}

export function validateDDNSDraft(
    draft: DDNSDraft,
    original?: ModelDDNSProfile,
): Record<string, string> {
    const errors: Record<string, string> = {}
    if (!draft.name.trim()) errors.name = "请输入配置名称"
    if (!draft.provider) errors.provider = "请选择 DNS 提供商"
    const domains = parseDDNSDomains(draft.domains_raw)
    if (!domains.length && draft.provider !== "dummy") errors.domains_raw = "请至少添加一个域名"
    else if (domains.some((domain) => !validDDNSDomain(domain)))
        errors.domains_raw = "请输入完整域名，不要带协议、路径、端口或 *；支持中文域名"
    if (!Number.isInteger(draft.max_retries) || draft.max_retries < 1 || draft.max_retries > 10)
        errors.max_retries = "重试次数必须是 1–10 之间的整数"
    if (
        !Number.isSafeInteger(draft.notification_group_id) ||
        (draft.notification_group_id ?? -1) < 0
    )
        errors.notification_group_id = "请选择有效的通知组"
    if (draft.provider === "tencentcloud" && !draft.access_id?.trim())
        errors.access_id = "请输入 SecretId"
    const keepsSecret = original?.id && original.provider === draft.provider
    if (
        ["cloudflare", "tencentcloud", "he"].includes(draft.provider) &&
        !keepsSecret &&
        !draft.access_secret?.trim()
    )
        errors.access_secret = "请输入此提供商的密钥"
    if (draft.provider === "webhook") {
        try {
            const url = new URL(draft.webhook_url ?? "")
            if (!["http:", "https:"].includes(url.protocol)) throw new Error()
        } catch {
            errors.webhook_url = "请输入 http:// 或 https:// 开头的 Webhook 地址"
        }
        if (![1, 2, 3, 4, 5].includes(draft.webhook_method ?? 0))
            errors.webhook_method = "请选择请求方法"
        if (![1, 2].includes(draft.webhook_request_type ?? 0))
            errors.webhook_request_type = "请选择请求格式"
        if (draft.webhook_headers?.trim()) {
            try {
                const headers = JSON.parse(draft.webhook_headers)
                if (
                    !headers ||
                    Array.isArray(headers) ||
                    typeof headers !== "object" ||
                    Object.values(headers).some((v) => typeof v !== "string")
                )
                    throw new Error()
            } catch {
                errors.webhook_headers = "请求头必须是 JSON 对象，且每个值都是字符串"
            }
        }
    }
    return errors
}

export function ddnsPayload(draft: DDNSDraft): ModelDDNSForm {
    const { domains_raw, ...payload } = draft
    return { ...payload, name: draft.name.trim(), domains: parseDDNSDomains(domains_raw) }
}
