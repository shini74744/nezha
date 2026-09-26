import { AppearanceSection } from "@/components/appearance-section"
import { defaults, normalize, validate } from "@/lib/appearance-config"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

describe("appearance editor configuration", () => {
    it("preserves old switches and fills only new parameters", () => {
        const c = normalize(
            '{"version":1,"enabled":true,"features":{"greeting":{"enabled":false},"clock":{"enabled":true}}}',
        )
        expect(c.features.greeting.enabled).toBe(false)
        expect(c.features.greeting.rules).toHaveLength(7)
        expect(c.features.greeting.rules.flatMap((r: any) => r.messages)).toHaveLength(70)
        expect(c.features.clock.secondEndColor).toBe("#2878ff")
        expect(validate(c)).toBe("")
    })
    it("validates custom configuration without accepting CSS injection", () => {
        const c = defaults()
        c.features.clock.hourEndColor = "red;display:none"
        expect(validate(c)).not.toBe("")
        c.features.clock.hourEndColor = "#123456"
        c.features.greeting.rules[0].end = "12:60"
        expect(validate(c)).not.toBe("")
        c.features.greeting.rules = []
        expect(validate(c)).toBe("")
    })
    it("starts collapsed and retains unsaved fields across repeated open/close", () => {
        render(
            <AppearanceSection title="设置" description="说明" enabled onEnabledChange={() => {}}>
                <input aria-label="草稿" defaultValue="before" />
            </AppearanceSection>,
        )
        const button = screen.getByRole("button", { name: "设置" }),
            input = screen.getByLabelText("草稿")
        expect(button.getAttribute("aria-expanded")).toBe("false")
        expect(input.closest("[hidden]")).not.toBeNull()
        fireEvent.click(button)
        fireEvent.change(input, { target: { value: "unsaved" } })
        fireEvent.click(button)
        expect(input.closest("[hidden]")).not.toBeNull()
        fireEvent.click(button)
        expect((input as HTMLInputElement).value).toBe("unsaved")
        expect(input.closest("[hidden]")).toBeNull()
        fireEvent.click(screen.getByRole("switch"))
        expect(button.getAttribute("aria-expanded")).toBe("true")
    })
})
