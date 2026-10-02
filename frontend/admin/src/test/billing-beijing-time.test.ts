import { describe, expect, it } from "vitest"
import { beijingBillingISO, billingCalendarDate, formatBillingTime, parseBillingTime } from "../../../shared/billing-time"
import { applyPublicNoteDate, applyPublicNoteTime, publicNoteDateTimeLabel, publicNoteTime } from "@/lib/public-note"
describe("Beijing billing time independent of browser zone", () => {
 it("renders old UTC values at the same real Beijing instant", () => {
  expect(formatBillingTime("2026-09-02T16:00:00.000Z")).toBe("2026-09-03 00:00:00")
  expect(publicNoteDateTimeLabel("2026-09-02T16:00:00.000Z")).toBe("2026-09-03 00:00:00")
  expect(publicNoteTime("2026-09-02T16:00:00.000Z")).toBe("00:00:00")
  expect(Date.parse(beijingBillingISO("2026-09-02T16:00:00.000Z")!)).toBe(Date.parse("2026-09-02T16:00:00.000Z"))
 })
 it("keeps Beijing afternoon on the same date", () => {
  expect(formatBillingTime("2026-09-02T16:00:00+08:00")).toBe("2026-09-02 16:00:00")
  expect(formatBillingTime("2026-09-02 16:00:00")).toBe("2026-09-02 16:00:00")
  expect(formatBillingTime("2026-09-02")).toBe("2026-09-02 00:00:00")
 })
 it("keeps the selected calendar date and saves explicit +08:00", () => {
  const calendar=billingCalendarDate("2026-09-02T16:00:00Z")!
  expect([calendar.getFullYear(),calendar.getMonth()+1,calendar.getDate()]).toEqual([2026,9,3])
  const note={billingDataMod:{endDate:"2026-09-02T16:00:00Z"}}
  const time=applyPublicNoteTime(note,"billingDataMod.endDate","16:15:30")
  expect(time.billingDataMod?.endDate).toBe("2026-09-03T16:15:30+08:00")
  expect(applyPublicNoteDate(time,"billingDataMod.endDate",new Date(2026,9,2)).billingDataMod?.endDate).toBe("2026-10-02T16:15:30+08:00")
  expect(note.billingDataMod.endDate).toBe("2026-09-02T16:00:00Z")
 })
 it("does not invent unset or no-expiry dates", () => {
  for(const v of ["", "0000-00-00T23:59:59+08:00", "invalid"]) expect(parseBillingTime(v)).toBeUndefined()
 })
})
