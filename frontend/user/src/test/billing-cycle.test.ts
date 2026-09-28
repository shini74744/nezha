import {describe,it,expect} from "vitest";
import {formatBillingCycle} from "@/lib/billing-cycle";
describe("billing cycle display",()=>{
 it.each(["zh-CN","zh-TW","zh"])("translates stored cycle labels in %s without changing data",language=>{
  const billing={cycle:"Year"};
  expect(formatBillingCycle(billing.cycle,language)).toBe("年");
  expect(billing.cycle).toBe("Year");
  expect(["Day","Week","Month"].map(c=>formatBillingCycle(c,language))).toEqual(["日","周","月"]);
 });
 it("preserves custom and already Chinese labels",()=>{
  for(const c of ["年","半年","2年","monthly","custom"])expect(formatBillingCycle(c,"zh-CN")).toBe(c);
  expect(formatBillingCycle(undefined,"zh-CN")).toBe("");
 });
 it("preserves other language displays",()=>expect(formatBillingCycle("Year","en-US")).toBe("Year"));
});
