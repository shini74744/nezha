import type { ModelNotificationForm } from "@/types"

export type NotificationDraft = ModelNotificationForm & { format_metric_units?: boolean }
export type TelegramDraft = {
    token: string
    chat: string
    topic: string
    text: string
    parseMode: string
    silent: boolean
    noPreview: boolean
}
export const telegramDefaults: NotificationDraft = {
    name: "",
    url: "https://api.telegram.org/bot/sendMessage",
    request_method: 2,
    request_type: 1,
    request_header: "",
    request_body: JSON.stringify({ chat_id: "", text: "#NEZHA#" }, null, 2),
    verify_tls: true,
    skip_check: true,
    format_metric_units: true,
}
const urlString = (url: URL) => url.toString().replace(/%23([A-Z][A-Z0-9.]*?)%23/g, "#$1#")
const isObject = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x)
function read(n: NotificationDraft) {
    // Literal Nezha placeholders in existing GET URLs are not URL fragments.
    const url = new URL(n.url.replace(/#[A-Z][A-Z0-9.]*#/g, encodeURIComponent))
    const match = url.pathname.match(/^(.*\/bot)([^/]*)\/sendMessage$/)
    if (!match || !["http:", "https:"].includes(url.protocol))
        throw new Error("Not Telegram sendMessage")
    if (![1, 2].includes(Number(n.request_method))) throw new Error("Unsupported method")
    if (Number(n.request_method) === 2 && ![1, 2].includes(Number(n.request_type)))
        throw new Error("Unsupported body")
    const body = Number(n.request_method) === 2 ? JSON.parse(n.request_body || "{}") : {}
    if (!isObject(body)) throw new Error("Expected JSON object")
    const query = Object.fromEntries(url.searchParams.entries())
    const all = { ...query, ...body }
    // Structured entities require their own editor; never silently rewrite them.
    if (all.entities != null) throw new Error("Use advanced editor for entities")
    if (all.link_preview_options != null && !isObject(all.link_preview_options)) {
        try {
            all.link_preview_options = JSON.parse(String(all.link_preview_options))
        } catch {
            throw new Error("Invalid preview options")
        }
    }
    return { url, match, body, all }
}
export function parseTelegram(n: NotificationDraft): TelegramDraft | null {
    try {
        const { match, all } = read(n)
        const yes = (v: unknown) => v === true || v === "true" || v === 1 || v === "1"
        return {
            token: decodeURIComponent(match[2]),
            chat: String(all.chat_id ?? ""),
            topic: String(all.message_thread_id ?? ""),
            text: String(all.text ?? ""),
            parseMode: String(all.parse_mode ?? ""),
            silent: yes(all.disable_notification),
            noPreview: isObject(all.link_preview_options)
                ? yes(all.link_preview_options.is_disabled)
                : yes(all.disable_web_page_preview),
        }
    } catch {
        return null
    }
}
export function updateTelegram(
    n: NotificationDraft,
    draft: TelegramDraft,
    key: keyof TelegramDraft,
): NotificationDraft {
    const { url, match, body, all } = read(n)
    if (key === "token") {
        url.pathname = match[1] + encodeURIComponent(draft.token) + "/sendMessage"
        // Telegram's colon is valid in a path and is part of every bot token.
        url.pathname = url.pathname.replace(/%3A/gi, ":")
        return { ...n, url: urlString(url) }
    }
    const put = (field: string, value: unknown) => {
        const inQuery =
            Number(n.request_method) === 1 || (url.searchParams.has(field) && !(field in body))
        if (value === undefined) {
            delete body[field]
            url.searchParams.delete(field)
            return
        }
        if (inQuery) {
            url.searchParams.set(
                field,
                typeof value === "object" ? JSON.stringify(value) : String(value),
            )
        } else {
            body[field] =
                Number(n.request_type) === 2
                    ? typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)
                    : value
            url.searchParams.delete(field)
        }
    }
    if (key === "chat") put("chat_id", draft.chat)
    if (key === "topic") put("message_thread_id", draft.topic ? Number(draft.topic) : undefined)
    if (key === "text") put("text", draft.text)
    if (key === "parseMode") put("parse_mode", draft.parseMode || undefined)
    if (key === "silent") put("disable_notification", draft.silent)
    if (key === "noPreview") {
        if (isObject(all.link_preview_options))
            put("link_preview_options", {
                ...all.link_preview_options,
                is_disabled: draft.noPreview,
            })
        else put("disable_web_page_preview", draft.noPreview)
    }
    return {
        ...n,
        url: urlString(url),
        request_body:
            Number(n.request_method) === 1 ? n.request_body : JSON.stringify(body, null, 2),
    }
}
export function useFormattedSpeedVariables(text: string) {
    return text
        .replace(/#SERVER\.NETINSPEED#/g, "#SERVER.SPEEDIN#")
        .replace(/#SERVER\.NETOUTSPEED#/g, "#SERVER.SPEEDOUT#")
}
export const telegramPresets = [
    { name: "简洁通知", text: "#NEZHA#" },
    { name: "带时间", text: "🔔 监控通知\n#NEZHA#\n\n时间：#DATETIME#" },
    {
        name: "服务器详情",
        text: "🖥 #SERVER.NAME#（#SERVER.ID#）\n#NEZHA#\n\nCPU：#SERVER.CPU#\n内存：#SERVER.MEM#\n下载：#SERVER.SPEEDIN#\n上传：#SERVER.SPEEDOUT#\n时间：#DATETIME#",
    },
]
export const telegramVariables = [
    ["#NEZHA#", "通知内容"],
    ["#DATETIME#", "时间"],
    ["#SERVER.NAME#", "服务器名称"],
    ["#SERVER.ID#", "服务器 ID"],
    ["#SERVER.CPU#", "CPU"],
    ["#SERVER.MEM#", "内存"],
    ["#SERVER.DISK#", "磁盘"],
    ["#SERVER.TCPCONNCOUNT#", "TCP 连接数"],
    ["#SERVER.UDPCONNCOUNT#", "UDP 连接数"],
    ["#SERVER.SPEEDIN#", "下载速度（自动单位）"],
    ["#SERVER.SPEEDOUT#", "上传速度（自动单位）"],
    ["#SERVER.TRANSFERIN#", "累计下载"],
    ["#SERVER.TRANSFEROUT#", "累计上传"],
    ["#SERVER.IP#", "IP（未脱敏）"],
]
const messages: Record<string, string> = {
    incident: "[告警] 示例服务器(192.0.2.**) CPU 持续超过阈值",
    resolved: "[恢复] 示例服务器(192.0.2.**) CPU 恢复正常",
    test: "这是一条测试消息",
}
export function previewTelegram(text: string, scenario: string, formatUnits: boolean) {
    const values: Record<string, string> = {
        "#NEZHA#": messages[scenario] || messages.incident,
        "#DATETIME#": "2026-09-28 12:00:00 +0800 CST（示例）",
        "#SERVER.NAME#": "示例服务器",
        "#SERVER.ID#": "12",
        "#SERVER.IP#": "192.0.2.10",
        "#SERVER.IPV4#": "192.0.2.10",
        "#SERVER.IPV6#": "2001:db8::10",
        "#SERVER.CPU#": formatUnits ? "85.25 %" : "85.250000",
        "#SERVER.MEM#": formatUnits ? "50.00 %" : "0.500000",
        "#SERVER.SWAP#": formatUnits ? "25.00 %" : "0.250000",
        "#SERVER.DISK#": formatUnits ? "25.00 %" : "0.250000",
        "#SERVER.SPEEDIN#": formatUnits ? "8.39 Mbps" : "1048576 B/s",
        "#SERVER.SPEEDOUT#": formatUnits ? "4.19 Mbps" : "524288 B/s",
        "#SERVER.TRANSFERIN#": formatUnits ? "1.0 GB" : "1073741824",
        "#SERVER.TRANSFEROUT#": formatUnits ? "512 MB" : "536870912",
        "#SERVER.CPUUSED#": "85.250000",
        "#SERVER.MEMUSED#": "1073741824",
        "#SERVER.MEMTOTAL#": "2147483648",
        "#SERVER.SWAPUSED#": "268435456",
        "#SERVER.SWAPTOTAL#": "1073741824",
        "#SERVER.DISKUSED#": "10737418240",
        "#SERVER.DISKTOTAL#": "42949672960",
        "#SERVER.NETINSPEED#": "1048576",
        "#SERVER.NETOUTSPEED#": "524288",
        "#SERVER.NETINTRANSFER#": "1073741824",
        "#SERVER.NETOUTTRANSFER#": "536870912",
        "#SERVER.LOAD1#": "0.500000",
        "#SERVER.LOAD5#": "0.400000",
        "#SERVER.LOAD15#": "0.300000",
        "#SERVER.TCPCONNCOUNT#": "16",
        "#SERVER.UDPCONNCOUNT#": "4",
    }
    const unknown = [...new Set(text.match(/#[A-Z][A-Z0-9.]*#/g) || [])].filter(
        (key) => !(key in values),
    )
    const preview = text.replace(/#[A-Z][A-Z0-9.]*#/g, (key) =>
        scenario === "test" && key.startsWith("#SERVER.") ? key : (values[key] ?? key),
    )
    return { text: preview, unknown }
}
export function validateTelegram(d: TelegramDraft) {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(d.token)) return "请填写有效的 Bot Token（数字:密钥）。"
    if (!/^-?\d+$|^@[A-Za-z0-9_]+$/.test(d.chat))
        return "请填写 Chat ID（数字，可为负数）或 @频道用户名。"
    if (
        d.topic &&
        (!/^\d+$/.test(d.topic) || !Number.isSafeInteger(Number(d.topic)) || Number(d.topic) < 1)
    )
        return "话题 ID 必须是正整数。"
    if (!d.text.trim()) return "消息模板不能为空。"
    if (!["", "HTML", "Markdown", "MarkdownV2"].includes(d.parseMode))
        return "此格式请使用高级配置编辑。"
    return ""
}
export function notificationErrorHint(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    // Never echo an exception URL: Telegram puts its credential in the path.
    if (/401|404|Unauthorized/i.test(message)) return "机器人凭据或接口地址无效，请检查 Bot Token。"
    if (/403|Forbidden|permission denied/i.test(message))
        return "没有权限：检查面板编辑权限，以及机器人是否被屏蔽、移出群组或缺少发言权限。"
    if (/400|Bad Request/i.test(message))
        return "Telegram 拒绝了消息：检查 Chat ID、话题 ID、模板格式及消息长度。"
    if (/429|Too Many/i.test(message)) return "发送过于频繁，请稍后重试。"
    if (/timeout|network|fetch|connect|TLS|certificate/i.test(message))
        return "连接失败：检查面板服务器到 Telegram 的网络、DNS 和 TLS 证书。"
    return "保存未完成。请检查通知配置、面板权限和服务器网络后重试。"
}
