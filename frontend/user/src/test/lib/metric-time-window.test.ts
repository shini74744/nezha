import { describe, it, expect } from "vitest";
import { metricTimeWindow, metricTimeAxis } from "@/lib/metric-time-window";
import { detailWindow } from "@/lib/chart-detail";
describe("rolling historical windows", () => {
 const now = Date.parse("2026-10-26T14:36:17+08:00");
 it.each([["1d",1],["7d",7],["30d",30]] as const)("keeps a full %s interval regardless of sample coverage", (period,days) => {
  const domain:[number,number] = [now-days*86400000,now];
  expect(metricTimeWindow(period,now)).toEqual(domain);
  expect(metricTimeAxis(period,now)).toMatchObject({type:"number",domain,ticks:domain,allowDataOverflow:true});
  const sparse = [{ts:now-3600000,value:5}];
  expect(detailWindow(sparse,...domain,domain)).toEqual(domain);
  expect(detailWindow(sparse,domain[0],domain[0]+1000,domain)).toEqual([domain[0],domain[0]+1000]);
  expect(detailWindow(sparse,domain[0]-1,now,domain)).toBeUndefined();
  expect(detailWindow(sparse,now,domain[0],domain)).toBeUndefined();
 });
 it("leaves live and last-report axes sample-based", () => {
  expect(metricTimeAxis("realtime",now)).toEqual({});
  expect(metricTimeWindow("last",now)).toBeUndefined();
  expect(metricTimeWindow("1d",NaN)).toBeUndefined();
 });
});
