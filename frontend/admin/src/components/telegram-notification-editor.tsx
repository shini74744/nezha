import { swrFetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useNotification } from "@/hooks/useNotfication"
import {
    NotificationDraft,
    parseTelegram,
    previewTelegram,
    telegramPresets,
    telegramVariables,
    updateTelegram,
    useFormattedSpeedVariables,
    validateTelegram,
} from "@/lib/telegram-notification"
import type { ModelAlertRule } from "@/types"
import { parseFragment } from "parse5"
import { ReactNode, createElement, useRef, useState } from "react"
import { Link } from "react-router-dom"
import useSWR from "swr"

import { NotificationEventModules } from "./notification-event-modules"

function Help({ title, children }: { title: string; children: ReactNode }) {
    return (
        <details className="inline-block text-xs align-middle">
            <summary
                aria-label={title + "说明"}
                className="inline-flex cursor-pointer rounded-full border w-4 h-4 items-center justify-center"
            >
                ?
            </summary>
            <div className="my-2 rounded border p-2 text-muted-foreground font-normal">
                {children}
            </div>
        </details>
    )
}
function HTMLPreview({ text }: { text: string }) {
    // Parse without executing HTML or fetching resources; render a small inert whitelist.
    const render = (node: any, key: number): ReactNode => {
        if (node.nodeName === "#text") return node.value
        const tag = node.tagName
        if (["script", "style", "iframe", "img", "svg", "object", "template"].includes(tag))
            return null
        const children = node.childNodes?.map(render)
        const styles: Record<string, string> = {
            b: "font-bold",
            strong: "font-bold",
            i: "italic",
            em: "italic",
            u: "underline",
            ins: "underline",
            s: "line-through",
            del: "line-through",
            strike: "line-through",
            code: "font-mono bg-black/10 rounded px-1",
            pre: "font-mono block bg-black/10 p-2",
            a: "underline text-blue-600",
            blockquote: "block border-l-2 pl-2",
            "tg-spoiler": "bg-muted",
        }
        return createElement("span", { key, className: styles[tag] || "" }, children)
    }
    return <>{parseFragment(text).childNodes.map(render)}</>
}
export function TelegramNotificationEditor({
    value,
    onChange,
    id,
    testKind,
    onTestKindChange,
}: {
    testKind: string
    onTestKindChange: (kind: string) => void
    value: NotificationDraft
    onChange: (next: NotificationDraft) => void
    id?: number
}) {
    const draft = parseTelegram(value)
    const [scenario, setScenario] = useState("incident")
    const [reveal, setReveal] = useState(false)
    const textarea = useRef<HTMLTextAreaElement>(null)
    const { notifierGroup } = useNotification()
    const { data: alerts, error: alertsError } = useSWR<ModelAlertRule[]>(
        id ? "/api/v1/alert-rule" : null,
        swrFetcher,
    )
    if (!draft)
        return (
            <p role="alert" className="text-sm text-amber-600">
                当前请求包含无法安全转换的内容。请展开高级配置编辑；原配置未被改写。
            </p>
        )
    const groups = (notifierGroup || []).filter((group) => id && group.notifications?.includes(id))
    const rules = (alerts || []).filter((rule) =>
        groups.some((group) => group.group.id === rule.notification_group_id),
    )
    const preview = previewTelegram(draft.text, scenario, !!value.format_metric_units)
    const patch = (key: keyof typeof draft, next: string | boolean) =>
        onChange(updateTelegram(value, { ...draft, [key]: next }, key))
    const insert = (token: string) => {
        const el = textarea.current
        const start = el?.selectionStart ?? draft.text.length,
            end = el?.selectionEnd ?? start
        patch("text", draft.text.slice(0, start) + token + draft.text.slice(end))
        requestAnimationFrame(() => {
            el?.focus()
            el?.setSelectionRange(start + token.length, start + token.length)
        })
    }
    return (
        <div className="space-y-4" data-telegram-editor>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm sm:col-span-2">
                    <span className="flex items-center gap-2">
                        Bot Token{" "}
                        <Help title="Bot Token">
                            从 Telegram 的 @BotFather
                            获取。仅用于发送通知，不会出现在预览中。不要向他人分享。
                        </Help>
                    </span>
                    <div className="flex gap-2">
                        <Input
                            aria-label="Bot Token"
                            type={reveal ? "text" : "password"}
                            autoComplete="off"
                            value={draft.token}
                            onChange={(e) => patch("token", e.target.value.trim())}
                            placeholder="123456:机器人密钥"
                        />
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={reveal ? "隐藏 Bot Token" : "显示 Bot Token"}
                            onClick={() => setReveal(!reveal)}
                        >
                            {reveal ? "隐藏" : "显示"}
                        </Button>
                    </div>
                </label>
                <label className="space-y-1 text-sm">
                    <span className="flex items-center gap-2">
                        Chat ID / 频道{" "}
                        <Help title="接收人">
                            私聊先向机器人发送 /start。群组 ID 通常为负数；频道也可填
                            @用户名。机器人必须拥有发送消息权限。
                        </Help>
                    </span>
                    <Input
                        aria-label="Chat ID / 频道"
                        value={draft.chat}
                        onChange={(e) => patch("chat", e.target.value.trim())}
                        placeholder="-1001234567890 或 @channel"
                    />
                </label>
                <label className="space-y-1 text-sm">
                    <span className="flex items-center gap-2">
                        话题 ID（选填）
                        <Help title="话题 ID">
                            只用于启用了话题的会话。填写目标话题的正整数 ID；普通私聊或群组留空。
                        </Help>
                    </span>
                    <Input
                        aria-label="话题 ID"
                        value={draft.topic}
                        onChange={(e) => {
                            if (/^\d*$/.test(e.target.value)) patch("topic", e.target.value)
                        }}
                        placeholder="留空发送到默认会话"
                    />
                </label>
            </div>
            <NotificationEventModules
                kind={testKind}
                onKindChange={onTestKindChange}
                value={value.event_templates}
                onChange={(event_templates) => onChange({ ...value, event_templates })}
                formatUnits={!!value.format_metric_units}
            />
            <details
                key={String(value.event_templates?.enabled)}
                open={value.event_templates?.enabled ? undefined : true}
                className="space-y-3"
            >
                <summary className="cursor-pointer font-medium">
                    通用模板（关闭模块或选择沿用时使用）
                </summary>
                <div className="grid gap-4 lg:grid-cols-2">
                    <section className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium">消息模板</h3>
                            <Help title="消息模板">
                                #NEZHA#
                                是系统产生的通知内容；此处不会改变告警条件。服务器变量仅在发送事件携带服务器数据时替换。
                            </Help>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {telegramPresets.map((preset) => (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    key={preset.name}
                                    onClick={() => {
                                        if (
                                            !draft.text ||
                                            draft.text === "#NEZHA#" ||
                                            window.confirm("替换当前消息模板？")
                                        )
                                            patch("text", preset.text)
                                    }}
                                >
                                    {preset.name}
                                </Button>
                            ))}
                        </div>
                        {/#SERVER.NET(?:IN|OUT)SPEED#/.test(draft.text) && (
                            <div className="rounded border p-2 text-sm space-y-2">
                                <p>
                                    当前模板使用原始网速变量，显示的是字节数。可改用 Mbps
                                    速度变量，并勾选“格式化数据单位”。
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        patch("text", useFormattedSpeedVariables(draft.text))
                                    }
                                >
                                    改用 Mbps 网速
                                </Button>
                            </div>
                        )}
                        <Textarea
                            ref={textarea}
                            aria-label="TG 消息模板"
                            className="min-h-48 font-mono text-sm"
                            value={draft.text}
                            onChange={(e) => patch("text", e.target.value)}
                        />
                        <div className="flex flex-wrap gap-1">
                            {telegramVariables.map(([token, name]) => (
                                <Button
                                    key={token}
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    title={token}
                                    onClick={() => insert(token)}
                                >
                                    {name}
                                </Button>
                            ))}
                        </div>
                        <label className="flex flex-wrap items-center gap-2 text-sm">
                            消息格式
                            <select
                                aria-label="TG 消息格式"
                                className="rounded border bg-background p-2"
                                value={draft.parseMode}
                                onChange={(e) => patch("parseMode", e.target.value)}
                            >
                                <option value="">纯文本（推荐）</option>
                                <option value="HTML">HTML</option>
                                <option value="MarkdownV2">MarkdownV2</option>
                                <option value="Markdown">Markdown（旧版）</option>
                                {!["", "HTML", "Markdown", "MarkdownV2"].includes(
                                    draft.parseMode,
                                ) && <option value={draft.parseMode}>{draft.parseMode}</option>}
                            </select>
                            <Help title="消息格式">
                                纯文本不会因特殊符号导致格式错误。HTML / Markdown 要遵循 Telegram
                                的格式与转义规则，系统目前仅做 JSON / URL 转义，不自动转义排版语法。
                            </Help>
                        </label>
                        <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={draft.silent}
                                    onChange={(e) => patch("silent", e.target.checked)}
                                />
                                静音发送
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={draft.noPreview}
                                    onChange={(e) => patch("noPreview", e.target.checked)}
                                />
                                关闭链接预览
                            </label>
                        </div>
                    </section>
                    <section
                        className="min-w-0 rounded-xl border bg-muted/30 p-3 space-y-3"
                        aria-label="TG 通知预览"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-medium">消息预览</h3>
                            <span className="text-xs text-muted-foreground">示例数据 · 不发送</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {[
                                ["incident", "告警"],
                                ["resolved", "恢复"],
                                ["test", "保存测试"],
                            ].map(([key, name]) => (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={scenario === key ? "default" : "outline"}
                                    key={key}
                                    onClick={() => setScenario(key)}
                                >
                                    {name}
                                </Button>
                            ))}
                        </div>
                        <div
                            className="rounded-xl rounded-tl-sm border bg-background p-3 whitespace-pre-wrap break-words text-sm min-h-40"
                            data-telegram-message
                        >
                            {draft.parseMode === "HTML" ? (
                                <HTMLPreview text={preview.text} />
                            ) : (
                                preview.text || "填写模板后显示预览"
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            替换后示例约 {Array.from(preview.text).length} 字符；Telegram 正文上限
                            4096 字符（格式解析后），实际长度取决于事件内容。
                        </p>
                        {draft.parseMode && (
                            <p className="text-xs text-amber-600">
                                {draft.parseMode === "HTML"
                                    ? "HTML 仅近似预览基本样式，链接不可点击。"
                                    : "Markdown 显示替换后的原文，不模拟 Telegram 排版。"}{" "}
                                最终以 Telegram 客户端为准。
                            </p>
                        )}
                        {scenario === "test" && /#SERVER\./.test(draft.text) && (
                            <p className="text-xs text-amber-600">
                                此处为旧版通用测试预览；实际发送测试使用下方选择的事件状态和数据源。
                            </p>
                        )}
                        {preview.unknown.length > 0 && (
                            <p role="status" className="text-xs text-amber-600">
                                未识别变量：{preview.unknown.join("、")}，发送时不会被替换。
                            </p>
                        )}
                        {/#SERVER.IP(?:V[46])?#/.test(draft.text) && (
                            <p className="text-xs text-amber-600">
                                IP 变量会显示原始 IP，不受通知正文的 IP 脱敏设置影响。
                            </p>
                        )}
                        {validateTelegram(draft) && (
                            <p role="status" className="text-xs text-amber-600">
                                {validateTelegram(draft)}
                            </p>
                        )}
                    </section>
                </div>
            </details>
            <section className="rounded-lg border p-3 space-y-2 text-sm" aria-label="TG 发送逻辑">
                <h3 className="font-medium">发送逻辑</h3>
                <p>
                    事件满足条件 → 对应通知组 → 当前 Telegram →
                    指定接收人。模板只决定内容，不会自动创建告警规则。
                </p>
                <p>
                    关联通知组：
                    {!id
                        ? "保存后可加入通知组"
                        : notifierGroup === undefined
                          ? "正在加载或未能获取，请到通知组确认"
                          : groups.map((group) => group.group.name).join("、") || "尚未加入通知组"}
                </p>
                {id && (
                    <div>
                        关联告警规则：
                        {alertsError ? (
                            "读取失败，请到告警规则页查看"
                        ) : !alerts ? (
                            "加载中…"
                        ) : rules.length ? (
                            <ul className="mt-1 space-y-1">
                                {rules.map((rule) => (
                                    <li key={rule.id}>
                                        {rule.name} · {rule.enable ? "已启用" : "已停用"} ·{" "}
                                        {rule.trigger_mode === 1
                                            ? "单次触发"
                                            : "持续触发（受去重限制）"}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            "暂无关联告警规则（不代表没有服务、任务或 IP 变更通知）"
                        )}
                    </div>
                )}
                <details>
                    <summary className="cursor-pointer text-muted-foreground">
                        触发、恢复和去重说明
                    </summary>
                    <ul className="mt-2 space-y-1 list-disc pl-5 text-muted-foreground">
                        <li>
                            单次触发：从正常变为异常时通知；持续触发：异常持续时继续检查，但仍受去重限制。
                        </li>
                        <li>告警从异常恢复为正常时发送恢复通知，同时清除另一状态的去重缓存。</li>
                        <li>
                            带去重标识的同一事件：首次立即发送，初始冷却 15 分钟，后续间隔翻倍，最长
                            24 小时。不同事件分开计时；无去重标识的消息不套用此规则。
                        </li>
                        <li>
                            去重保存在内存中，重启或缓存过期后会重置。保存测试不经过上述去重流程。
                        </li>
                    </ul>
                </details>
                <div className="flex flex-wrap gap-4">
                    <Link className="underline" to="/dashboard/notification-group">
                        管理通知组
                    </Link>
                    <Link className="underline" to="/dashboard/alert-rule">
                        查看告警规则
                    </Link>
                    <a
                        className="underline"
                        href="https://core.telegram.org/bots/api#sendmessage"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Telegram 格式说明
                    </a>
                </div>
            </section>
        </div>
    )
}
