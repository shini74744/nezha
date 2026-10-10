import { validateTelegramMenu } from "@/lib/telegram-menu"
import { parseTelegram, telegramDefaults, updateTelegram } from "@/lib/telegram-notification"
import { describe, expect, it } from "vitest"

const fixture = {
    ...telegramDefaults,
    url: "https://api.telegram.org/bot123:fixture_token/sendMessage",
    request_body: JSON.stringify({ chat_id: "12345678", text: "#NEZHA#", custom: "keep" }),
    telegram_menu: { enabled: true, expiry_days: 7 },
}
describe("Telegram server menu", () => {
    it("requires a private recipient and bounded expiry days", () => {
        expect(validateTelegramMenu(fixture)).toBe("")
        for (const chat of ["-100123", "@channel", "0", "12.5", "4503599627370496"])
            expect(
                validateTelegramMenu({
                    ...fixture,
                    request_body: JSON.stringify({ chat_id: chat }),
                }),
            ).not.toBe("")
        for (const days of [0, 366, 1.5])
            expect(
                validateTelegramMenu({
                    ...fixture,
                    telegram_menu: { enabled: true, expiry_days: days },
                }),
            ).not.toBe("")
        expect(
            validateTelegramMenu({
                ...fixture,
                url: "https://proxy.example/bot123:fixture_token/sendMessage",
            }),
        ).not.toBe("")
    })
    it("keeps disabled legacy notifications unchanged and preserves menus while editing templates", () => {
        expect(validateTelegramMenu({ ...fixture, telegram_menu: undefined })).toBe("")
        const next = updateTelegram(
            fixture,
            { ...parseTelegram(fixture)!, text: "updated #NEZHA#" },
            "text",
        )
        expect(next.telegram_menu).toEqual(fixture.telegram_menu)
        expect(JSON.parse(next.request_body).custom).toBe("keep")
        expect(fixture.telegram_menu.expiry_days).toBe(7)
    })
})
