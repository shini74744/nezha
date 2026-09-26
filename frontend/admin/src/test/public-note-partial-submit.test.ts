import { serverFormSchema } from "@/components/server"
import { validatePublicNote } from "@/lib/public-note"
import { describe, expect, it } from "vitest"

describe("public note partial submission", () => {
    it("does not let untouched raw JSON block the server form", () => {
        const result = serverFormSchema.safeParse({
            name: "server",
            display_index: 0,
            public_note: JSON.stringify({
                billingDataMod: { startDate: "2026-06-02" },
                legacyCustomField: "preserve in raw mode",
            }),
        })
        expect(result.success).toBe(true)
    })

    it("accepts incomplete structured fields when supplied values are valid", () => {
        const result = validatePublicNote({
            billingDataMod: { startDate: "2026-06-02" },
            planDataMod: { bandwidth: "30Mbps" },
        })
        expect(result.valid).toBe(true)
        expect(result.errors).toEqual({})
    })
})
