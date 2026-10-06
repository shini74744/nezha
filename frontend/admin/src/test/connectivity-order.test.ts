import {describe,it,expect} from "vitest"
import {reorderConnectivity} from "@/lib/connectivity-order"
describe("connectivity drag ordering",()=>{
 const rows=[{id:"a",group:"cn"},{id:"x",group:"us"},{id:"b",group:"cn"},{id:"c",group:"cn"}]
 it("moves within the region, preserving interleaved other regions",()=>{
  expect(reorderConnectivity(rows,"a","c").map(row=>row.id)).toEqual(["b","x","c","a"])
  expect(rows.map(row=>row.id)).toEqual(["a","x","b","c"])
 })
 it("rejects missing and cross-region targets",()=>{
  expect(reorderConnectivity(rows,"a","x")).toBe(rows)
  expect(reorderConnectivity(rows,"missing","c")).toBe(rows)
 })
})
