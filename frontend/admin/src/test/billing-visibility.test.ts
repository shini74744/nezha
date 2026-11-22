import { describe, expect, it } from "vitest";
import { applyPublicNotePatch, parseEditableNote, publicNoteRawText, serializePublicNote } from "../lib/public-note";
describe("billing display settings persistence", () => {
  it("keeps stored billing and unknown data across form/raw/save/reopen", () => {
    const original = { billingDataMod: { amount: "0", cycle: "Month", endDate: "0000-00-00T23:59:59+08:00", custom: "preserve" }, planDataMod: { bandwidth: "300Mbps" }, unknown: { keep: true } };
    for (const showPrice of ["0", "1"]) for (const showExpiry of ["0", "1"]) {
      const changed = applyPublicNotePatch(applyPublicNotePatch(original, "billingDataMod.showPrice", showPrice), "billingDataMod.showExpiry", showExpiry);
      const saved = serializePublicNote(parseEditableNote(publicNoteRawText(serializePublicNote(changed))));
      expect(parseEditableNote(saved)).toMatchObject({ ...original, billingDataMod: { ...original.billingDataMod, showPrice, showExpiry } });
    }
  });
  it("supports Chinese boolean flags and does not inject defaults into legacy data", () => {
    expect(parseEditableNote('{"账单信息":{"价格":"0","显示金额":false,"显示剩余天数":true}}').billingDataMod).toMatchObject({ amount: "0", showPrice: "0", showExpiry: "1" });
    const note = parseEditableNote('{"billingDataMod":{"amount":"0"}}');
    expect(note.billingDataMod?.showPrice).toBeUndefined();
    expect(note.billingDataMod?.showExpiry).toBeUndefined();
  });
  it("rejects ambiguous display settings", () => {
    expect(() => parseEditableNote('{"billingDataMod":{"showPrice":"maybe"}}')).toThrow();
  });
});
