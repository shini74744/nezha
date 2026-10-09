import {describe,it,expect} from "vitest";
import {returnHopRows,returnStages} from "@/lib/return-route-view";
describe("return-route compact view",()=>{
 it("groups only adjacent unanswered TTLs and retains ECMP samples",()=>{
  const hops=[{ttl:1,samples:3},{ttl:2,samples:0},{ttl:3,samples:0},{ttl:4,samples:3},{ttl:4,samples:2},{ttl:6,samples:0}];
  const rows=returnHopRows(hops,true);
  expect(rows.map(r=>[r.hop.ttl,r.end])).toEqual([[1,1],[2,3],[4,4],[4,4],[6,6]]);
  expect(returnHopRows(hops,false)).toHaveLength(6);
  expect(hops).toHaveLength(6);
 });
 it("marks landing as inferred rather than actual cable landing",()=>{
  expect(returnStages.landing.text).toBe("首个大陆响应");
  expect(returnStages.landing.help).toContain("IP 定位可能不准");
  expect(returnStages.landing.help).toContain("不确认");
 });
});
