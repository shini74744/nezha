import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BillingInfo from "../components/billingInfo";
import { parsePublicNote } from "../lib/utils";

const billing = { startDate: "2026-01-01T00:00:00+08:00", endDate: "2099-01-01T00:00:00+08:00", amount: "31USD", cycle: "Month", autoRenewal: "0" };
describe("per-server billing visibility", () => {
  for (const amount of ["0", "-1", "31USD"]) {
    for (const endDate of [billing.endDate, "2020-01-01T00:00:00+08:00", "0000-00-00T23:59:59+08:00"]) {
      it.each([["1", "1"], ["0", "1"], ["1", "0"], ["0", "0"]])(
        amount + " / " + endDate + " price=%s expiry=%s",
        (showPrice, showExpiry) => {
          const note = parsePublicNote(JSON.stringify({ billingDataMod: { ...billing, amount, endDate, showPrice, showExpiry } }))!;
          const { container } = render(<BillingInfo parsedData={note} />);
          expect(!!container.querySelector("[data-billing-price]")).toBe(showPrice === "1");
          expect(!!container.querySelector("[data-billing-expiry]")).toBe(showExpiry === "1");
          expect(!!container.querySelector("[data-expiry-progress]")).toBe(showExpiry === "1" && endDate === billing.endDate);
          expect(note.billingDataMod?.amount).toBe(amount);
          expect(note.billingDataMod?.endDate).toBe(endDate);
        }
      );
    }
  }
  it.each([undefined, {}])("legacy notes default to visible with plan=%s", planDataMod => {
    const note = parsePublicNote(JSON.stringify({ billingDataMod: billing, planDataMod }))!;
    const { container } = render(<BillingInfo parsedData={note} />);
    expect(container.querySelector("[data-billing-price]")).toBeTruthy();
    expect(container.querySelector("[data-billing-expiry]")).toBeTruthy();
  });
  it("receives boolean flags from raw notes and handles live updates independently", () => {
    const note = (showPrice: boolean, showExpiry: boolean) => parsePublicNote(JSON.stringify({ billingDataMod: { ...billing, showPrice, showExpiry }, planDataMod: { bandwidth: "300Mbps" } }))!;
    const { container, rerender } = render(<BillingInfo parsedData={note(false, true)} />);
    expect(container.querySelector("[data-billing-price]")).toBeNull();
    expect(container.querySelector("[data-billing-expiry]")).toBeTruthy();
    rerender(<BillingInfo parsedData={note(true, false)} />);
    expect(container.querySelector("[data-billing-price]")).toBeTruthy();
    expect(container.querySelector("[data-billing-expiry]")).toBeNull();
    expect(container.querySelector("[data-expiry-progress]")).toBeNull();
  });
});
