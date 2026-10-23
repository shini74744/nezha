import {describe,it,expect} from "vitest";
import {estimateRemainingValue} from "../lib/billing-value";
const now=Date.parse("2026-10-16T00:00:00+08:00");
const base={amount:"31USD",cycle:"Month",startDate:"2026-10-01T00:00:00+08:00",endDate:"2026-11-01T00:00:00+08:00",autoRenewal:"0"};
describe("estimated remaining prepaid value",()=>{
 it("uses actual calendar months and saved currency",()=>expect(estimateRemainingValue(base,now)).toEqual({value:16,unit:"USD"}));
 it.each(["","0","0USD","-1","免费","按量付费","pending","NaN","Infinity"])("hides unavailable or non-prepaid prices %s",amount=>expect(estimateRemainingValue({...base,amount},now)).toBeNull());
 it.each(["","0000-00-00T23:59:59+08:00","invalid"])("hides missing or unlimited end dates %s",endDate=>expect(estimateRemainingValue({...base,endDate},now)).toBeNull());
 it("does not crash on malformed raw-note numeric fields",()=>{
  expect(estimateRemainingValue({...base,amount:31 as unknown as string},now)).toBeNull();
  expect(estimateRemainingValue({...base,cycle:30 as unknown as string},now)).toBeNull();
 });
 it("does not invent currency for old numeric-only prices",()=>expect(estimateRemainingValue({...base,amount:"31"},now)).toEqual({value:16,unit:""}));
 it.each([["31刀","USD"],["31元","CNY"],["31欧元","EUR"]])("reads old price %s",(amount,unit)=>expect(estimateRemainingValue({...base,amount},now)).toEqual({value:16,unit}));
 it("handles expiry and renewal without negative values",()=>{
  expect(estimateRemainingValue(base,Date.parse(base.endDate))).toEqual({value:0,unit:"USD"});
  expect(estimateRemainingValue({...base,autoRenewal:"1"},Date.parse(base.endDate))).toEqual({value:31,unit:"USD"});
 });
 it("handles daily and weekly billing",()=>{
  expect(estimateRemainingValue({...base,cycle:"Day",amount:"2EUR"},now)?.value).toBe(32);
  expect(estimateRemainingValue({...base,cycle:"Week",amount:"7EUR"},now)?.value).toBe(16);
 });
 it("handles leap-day and month-end clamping",()=>{
  const endDate="2024-03-31T00:00:00+08:00",startDate="2024-02-29T00:00:00+08:00";
  expect(estimateRemainingValue({...base,amount:"31USD",startDate,endDate},Date.parse("2024-03-16T00:00:00+08:00"))?.value).toBe(15);
 });
 it("does not count service before the purchase date",()=>{
  expect(estimateRemainingValue(base,Date.parse("2026-09-20T00:00:00+08:00"))?.value).toBe(31);
 });
 it("handles multiple prepaid months, unsupported cycles and invalid dates",()=>{
  expect(estimateRemainingValue({...base,endDate:"2026-12-01T00:00:00+08:00"},now)?.value).toBeCloseTo(47);
  expect(estimateRemainingValue({...base,cycle:"unknown"},now)).toBeNull();
  expect(estimateRemainingValue({...base,startDate:base.endDate},now)).toBeNull();
  expect(estimateRemainingValue(base,NaN)).toBeNull();
 });
});
