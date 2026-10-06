import {describe,it,expect} from "vitest";
import {formatDetectionTime} from "@/lib/detection-time";
describe("scheduled detection time",()=>{
 it("renders the real scheduled UTC+8 boundary, not rounded completion time",()=>{
  const slot=Date.parse("2026-10-06T16:00:00Z");
  expect(formatDetectionTime(slot,true)).toBe("2026/10/7 00:00:00");
  expect(formatDetectionTime(slot+127000,true)).toContain("00:02:07");
  expect(formatDetectionTime()).toBe("—");
 });
});
