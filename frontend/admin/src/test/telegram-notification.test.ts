import {
    notificationErrorHint,
    parseTelegram,
    previewTelegram,
    telegramDefaults,
    updateTelegram,
    formatSpeedVariables,
    validateTelegram,
} from "@/lib/telegram-notification"
import { describe, expect, it } from "vitest"

const original = {
    ...telegramDefaults,
    url: "https://api.telegram.org/bot123:fake_token/sendMessage",
    request_header: '{"X-Custom":"keep"}',
    request_body: JSON.stringify({
        chat_id: -1001234,
        text: "#NEZHA#",
        disable_notification: true,
        reply_markup: { inline_keyboard: [] },
        custom: "keep",
    }),
}
describe("Telegram visual editor", () => {
    it("reads existing JSON without rewriting or losing extension fields", () => {
        const draft = parseTelegram(original)!
        expect(draft).toMatchObject({
            token: "123:fake_token",
            chat: "-1001234",
            text: "#NEZHA#",
            silent: true,
        })
        const next = updateTelegram(
            original,
            { ...draft, text: '通知 "#NEZHA#"\n#SERVER.NAME#' },
            "text",
        )
        expect(JSON.parse(next.request_body)).toEqual({
            ...JSON.parse(original.request_body),
            text: '通知 "#NEZHA#"\n#SERVER.NAME#',
        })
        expect(next.request_header).toBe(original.request_header)
        expect(next.url).toBe(original.url)
        expect(validateTelegram(parseTelegram(next)!)).toBe("")
    })
    it("preserves GET method, query fields and literal placeholders for backend replacement", () => {
        const n = {
            ...original,
            request_method: 1,
            url: original.url + "?chat_id=-1001234&text=#NEZHA#&custom=keep",
            request_body: "unchanged",
        }
        const draft = parseTelegram(n)!
        expect(draft.text).toBe("#NEZHA#")
        const next = updateTelegram(n, { ...draft, text: "🔔 #NEZHA#\n#DATETIME#" }, "text")
        expect(next.request_method).toBe(1)
        expect(next.request_body).toBe("unchanged")
        expect(next.url).toContain("#NEZHA#")
        expect(next.url).toContain("#DATETIME#")
        expect(next.url).toContain("custom=keep")
        expect(parseTelegram(next)!.text).toBe("🔔 #NEZHA#\n#DATETIME#")
    })
    it("updates form bodies, query-located fields, optional topic and new preview options", () => {
        const n = {
            ...original,
            request_type: 2,
            url: original.url + "?chat_id=-99",
            request_body:
                '{"text":"#NEZHA#","link_preview_options":"{\\"is_disabled\\":false,\\"prefer_large_media\\":true}"}',
        }
        let draft = parseTelegram(n)!
        let next = updateTelegram(n, { ...draft, chat: "-100" }, "chat")
        expect(next.url).toContain("chat_id=-100")
        expect(JSON.parse(next.request_body)).not.toHaveProperty("chat_id")
        draft = parseTelegram(next)!
        next = updateTelegram(next, { ...draft, noPreview: true }, "noPreview")
        expect(JSON.parse(JSON.parse(next.request_body).link_preview_options)).toEqual({
            is_disabled: true,
            prefer_large_media: true,
        })
        next = updateTelegram(next, { ...parseTelegram(next)!, topic: "12" }, "topic")
        expect(JSON.parse(next.request_body).message_thread_id).toBe("12")
        next = updateTelegram(next, { ...parseTelegram(next)!, topic: "" }, "topic")
        expect(JSON.parse(next.request_body)).not.toHaveProperty("message_thread_id")
    })
    it("keeps unsupported or broken requests in raw mode", () => {
        expect(parseTelegram({ ...original, request_body: "broken" })).toBeNull()
        expect(parseTelegram({ ...original, request_body: '{"entities":[]}' })).toBeNull()
        expect(parseTelegram({ ...original, url: "https://hooks.example/send" })).toBeNull()
    })
    it("updates credentials without touching body or custom API base", () => {
        const n = { ...original, url: "https://proxy.example/tg/bot123:old/sendMessage" }
        const next = updateTelegram(n, { ...parseTelegram(n)!, token: "456:new_key" }, "token")
        expect(next.url).toBe("https://proxy.example/tg/bot456:new_key/sendMessage")
        expect(next.request_body).toBe(n.request_body)
    })
    it("previews serverless tests honestly and reports unknown variables", () => {
        const text = "#NEZHA# #SERVER.NAME# #SERVER.MEM# #TYPO#"
        expect(previewTelegram(text, "test", true).text).toContain("#SERVER.NAME#")
        expect(previewTelegram(text, "incident", true).text).toContain("50.00 %")
        expect(previewTelegram(text, "incident", false).text).toContain("0.500000")
        expect(previewTelegram(text, "resolved", true).text).toContain("恢复正常")
        expect(previewTelegram(text, "incident", true).unknown).toEqual(["#TYPO#"])
    })
    it("rejects incomplete config and never includes credential URLs in error hints", () => {
        const draft = parseTelegram(original)!
        expect(validateTelegram({ ...draft, token: "" })).toContain("Bot Token")
        expect(validateTelegram({ ...draft, topic: "-1" })).toContain("正整数")
        expect(validateTelegram({ ...draft, text: "" })).toContain("不能为空")
        const hint = notificationErrorHint(
            new Error("connect timeout https://api.telegram.org/bot123:secret/sendMessage"),
        )
        expect(hint).toContain("连接失败")
        expect(hint).not.toContain("secret")
    })
})

it("converts legacy raw speed variables without changing other template content", () => {
    const text = formatSpeedVariables(
        "🚀 ↓#SERVER.NETINSPEED# | ↑#SERVER.NETOUTSPEED# #SERVER.NAME#",
    )
    expect(text).toBe("🚀 ↓#SERVER.SPEEDIN# | ↑#SERVER.SPEEDOUT# #SERVER.NAME#")
    const preview = previewTelegram(text, "incident", true)
    expect(preview.text).toContain("8.39 Mbps")
    expect(preview.text).toContain("4.19 Mbps")
})
