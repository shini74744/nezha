import { serverFormSchema } from "@/components/server"
import { validatePublicNote,applyPublicNoteDate,applyPublicNoteTime,publicNoteTime,publicNoteDateTimeLabel,toggleEndNoExpiry,normalizeISO } from "@/lib/public-note"
import { describe, expect, it } from "vitest"

describe("billing date time editing",()=>{
 it("starts new dates at local midnight regardless of calendar input time",()=>{
  const day=new Date(2026,8,22,14,25,36);
  const note=applyPublicNoteDate({},"billingDataMod.startDate",day);
  expect(note.billingDataMod?.startDate).toBe(new Date(2026,8,22,0,0,0).toISOString());
  expect(publicNoteTime(note.billingDataMod?.startDate)).toBe("00:00:00");
 });
 it("preserves existing hours minutes and seconds when changing the date",()=>{
  const note={billingDataMod:{startDate:new Date(2026,8,22,13,14,15).toISOString()},unknown:"keep"};
  const changed=applyPublicNoteDate(note,"billingDataMod.startDate",new Date(2026,9,23));
  expect(changed.billingDataMod?.startDate).toBe(new Date(2026,9,23,13,14,15).toISOString());
  expect(note.billingDataMod.startDate).toBe(new Date(2026,8,22,13,14,15).toISOString());
  expect(changed.unknown).toBe("keep");
 });
 it("changes only time, keeps local date and survives ISO normalization",()=>{
  const note={billingDataMod:{startDate:new Date(2026,8,22,0,0,0).toISOString(),endDate:"2026-10-22T23:59:58+08:00"},unknown:"keep"};
  const changed=applyPublicNoteTime(note,"billingDataMod.startDate","23:59:59");
  expect(changed.billingDataMod?.startDate).toBe(new Date(2026,8,22,23,59,59).toISOString());
  expect(publicNoteTime(normalizeISO(changed.billingDataMod?.startDate))).toBe("23:59:59");
  expect(publicNoteDateTimeLabel(changed.billingDataMod?.startDate)).toContain("23:59:59");
  expect(changed.billingDataMod?.endDate).toBe(note.billingDataMod.endDate);
  expect(changed.unknown).toBe("keep");
 });
 it("does not invent dates or overwrite no-expiry or accept invalid times",()=>{
  expect(applyPublicNoteTime({},"billingDataMod.startDate","12:00:00")).toEqual({});
  const note=toggleEndNoExpiry({});
  expect(applyPublicNoteTime(note,"billingDataMod.endDate","12:00:00")).toBe(note);
  const restored=applyPublicNoteDate(note,"billingDataMod.endDate",new Date(2026,9,22,13));
  expect(publicNoteTime(restored.billingDataMod?.endDate)).toBe("00:00:00");
  for(const time of ["24:00:00","12:60:00","12:00:60","","1:2:3","12:00"]){
   expect(applyPublicNoteTime(restored,"billingDataMod.endDate",time)).toBe(restored);
  }
  expect(publicNoteDateTimeLabel()).toBe("YYYY-MM-DD 00:00:00");
 });
});

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
