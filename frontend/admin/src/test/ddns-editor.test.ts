import {
    ddnsDraft,
    ddnsPayload,
    parseDDNSDomains,
    validDDNSDomain,
    validateDDNSDraft,
} from "@/lib/ddns-editor"
import { ModelDDNSProfile } from "@/types"
import { describe, expect, it } from "vitest"

describe("DDNS visual editor data compatibility", () => {
    const saved = {
        id: 7,
        name: "Existing",
        provider: "cloudflare",
        domains: ["home.example.com"],
        enable_ipv4: true,
        enable_ipv6: true,
        access_id: "old-id",
        max_retries: 3,
        notification_group_id: 9,
    } as ModelDDNSProfile
    it("parses comma/newline/Chinese comma domains and deduplicates", () => {
        expect(parseDDNSDomains("HOME.example.com，\n home.example.com test.example.com")).toEqual([
            "home.example.com",
            "test.example.com",
        ])
    })
    it.each(["home.example.com", "例子.中国", "example.com."])("accepts %s", (domain) =>
        expect(validDDNSDomain(domain)).toBe(true),
    )
    it.each([
        "*.example.com",
        "https://example.com",
        "example.com/path",
        "example.com:443",
        "127.0.0.1",
        "localhost",
        "-bad.example.com",
        "example..com",
        "a".repeat(64) + ".com",
    ])("rejects %s", (domain) => expect(validDDNSDomain(domain)).toBe(false))
    it("retains protocol, notification, ID, webhook values; never preloads write-only secrets", () => {
        const draft = ddnsDraft({
            ...saved,
            access_secret: "do-not-copy",
            webhook_headers: "do-not-copy",
            webhook_request_body: "keep",
            webhook_url: "https://example.com",
        })
        expect(draft).toMatchObject({
            access_secret: "",
            webhook_headers: "",
            access_id: "old-id",
            enable_ipv6: true,
            notification_group_id: 9,
            webhook_request_body: "keep",
        })
        expect(validateDDNSDraft(draft, saved)).toEqual({})
        const payload = ddnsPayload(draft)
        expect(payload).not.toHaveProperty("domains_raw")
        expect(payload.domains).toEqual(["home.example.com"])
    })
    it("validates retry bounds and requires new provider credentials", () => {
        const draft = ddnsDraft(saved)
        for (const count of [0, 11, 1.5, NaN])
            expect(validateDDNSDraft({ ...draft, max_retries: count }, saved)).toHaveProperty(
                "max_retries",
            )
        expect(validateDDNSDraft({ ...draft, provider: "he" }, saved)).toHaveProperty(
            "access_secret",
        )
        expect(
            validateDDNSDraft({ ...draft, provider: "tencentcloud", access_id: "" }, saved),
        ).toHaveProperty("access_id")
        expect(
            validateDDNSDraft({ ...draft, enable_ipv4: false, enable_ipv6: false }, saved),
        ).toEqual({})
    })
    it("validates webhook URL/method/JSON headers without rewriting template body", () => {
        const draft = {
            ...ddnsDraft(saved),
            provider: "webhook",
            webhook_url: "https://example.com/?ip=#ip#",
            webhook_headers: '{"Authorization":"Bearer #access_secret#"}',
            webhook_request_body: '{"ip":"#ip#"}',
        }
        expect(validateDDNSDraft(draft)).toEqual({})
        expect(ddnsPayload(draft).webhook_request_body).toBe(draft.webhook_request_body)
        expect(validateDDNSDraft({ ...draft, webhook_headers: '{"bad":1}' })).toHaveProperty(
            "webhook_headers",
        )
        expect(validateDDNSDraft({ ...draft, webhook_url: "javascript:alert(1)" })).toHaveProperty(
            "webhook_url",
        )
        expect(validateDDNSDraft({ ...draft, webhook_method: 99 })).toHaveProperty("webhook_method")
    })
})
