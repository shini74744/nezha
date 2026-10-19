import { getNotificationEditor } from "@/api/notification"
import { copyToClipboard } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { IconButton } from "./xui/icon-button"

export function NotificationURLCopyButton({ notificationId }: { notificationId: number }) {
    const [pending, setPending] = useState(false)
    const [copied, setCopied] = useState(false)
    const busy = useRef(false)
    const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => () => clearTimeout(resetTimer.current), [])

    const copyURL = async () => {
        if (busy.current) return
        busy.current = true
        setPending(true)
        setCopied(false)
        clearTimeout(resetTimer.current)
        try {
            // Lists redact credentials. Read the saved URL only on an explicit
            // copy, through the existing owner/write-authorized editor endpoint.
            let url: string
            try {
                const config = await getNotificationEditor(notificationId)
                url = config.url
            } catch {
                toast.error("无法读取通知地址，请检查登录状态、编辑权限或网络")
                return
            }
            if (!url) {
                toast.error("该通知尚未配置 URL")
                return
            }
            // Preserve the complete URL, including the Telegram Bot Token.
            // The legacy clipboard fallback returns false when copying fails.
            if ((await copyToClipboard(url)) === false) throw new Error("clipboard unavailable")
            setCopied(true)
            toast.success("复制成功")
            resetTimer.current = setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error("复制失败，请允许浏览器访问剪贴板后重试")
        } finally {
            busy.current = false
            setPending(false)
        }
    }

    return (
        <IconButton
            type="button"
            variant="outline"
            icon={copied ? "check" : "clipboard"}
            aria-label="复制完整通知地址"
            title="复制完整通知地址（包含 Bot Token）"
            aria-busy={pending}
            disabled={pending}
            onClick={copyURL}
        />
    )
}
