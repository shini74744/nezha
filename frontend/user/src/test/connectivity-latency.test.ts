import {describe,it,expect} from "vitest";
import {averageConnectivityDelay,validSampleDelay} from "@/lib/connectivity-latency";
describe("average connectivity latency",()=>{
 it("uses all three or five valid measurements, not the last value or median",()=>{
  expect(averageConnectivityDelay([10,20,120].map(delay_ms=>({status:"ok",delay_ms})))).toBe(50);
  expect(averageConnectivityDelay([10,100,0,30,20].map(delay_ms=>({status:"ok",delay_ms})))).toBe(32);
 });
 it("includes zero and HTTP responses but excludes missing and invalid timings",()=>{
  expect(averageConnectivityDelay([{status:"ok",delay_ms:0},{status:"http_error",delay_ms:100},{status:"timeout"},{status:"ok",delay_ms:NaN},{status:"ok",delay_ms:Infinity},{status:"ok",delay_ms:-1}])).toBe(50);
  expect(averageConnectivityDelay([{status:"timeout"}])).toBeUndefined();
  expect(validSampleDelay({status:"timeout",delay_ms:3000})).toBeUndefined();
 });
});
