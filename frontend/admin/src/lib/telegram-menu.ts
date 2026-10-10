import type { NotificationDraft } from "./telegram-notification"
import { parseTelegram } from "./telegram-notification"

export type TelegramMenuConfig = {
    items?: Partial<Record<"home" | "online" | "offline" | "expiry" | "traffic", boolean>>
    enabled: boolean
    expiry_days: number
    login_success?: boolean
    login_failure?: boolean
    login_failure_password?: boolean
    daily_traffic?: boolean
}
export type TelegramMenuStatus = { state: string; message: string; updated_at?: number }
export function validateTelegramMenu(value: NotificationDraft): string {
    if (!value.telegram_menu?.enabled) return ""
    const draft = parseTelegram(value)
    if (
        !draft ||
        !/^[1-9]\d*$/.test(draft.chat) ||
        !Number.isSafeInteger(Number(draft.chat)) ||
        Number(draft.chat) >= 2 ** 52 ||
        draft.topic
    )
        return "服务器管理菜单仅支持数字私聊 Chat ID，不支持群组、频道或话题。"
    let url: URL
    try {
        url = new URL(value.url)
    } catch {
        return "请先填写 Telegram 通知地址。"
    }
    if (url.origin !== "https://api.telegram.org" || url.username || url.password)
        return "服务器管理菜单目前仅支持 Telegram 官方 HTTPS 地址。"
    if (
        !Number.isInteger(value.telegram_menu.expiry_days) ||
        value.telegram_menu.expiry_days < 1 ||
        value.telegram_menu.expiry_days > 365
    )
        return "即将到期范围必须为 1–365 天。"
    return ""
}
