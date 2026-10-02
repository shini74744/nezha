import { describe, expect, it } from "vitest"
import { remainingDaysClass } from "../lib/server-expiry-color"
describe("expiry day number colors", () => {
    it.each([8, 30, -1, NaN, Infinity])("keeps %s unchanged", days => {
        expect(remainingDaysClass(days)).toBe("")
    })
    it.each([4, 5, 6, 7])("marks %s yellow", days => {
        expect(remainingDaysClass(days)).toContain("text-yellow-600")
    })
    it.each([2, 3])("marks %s orange", days => {
        expect(remainingDaysClass(days)).toContain("text-orange-600")
    })
    it.each([0, 1])("marks %s red", days => {
        expect(remainingDaysClass(days)).toContain("text-red-600")
    })
})
