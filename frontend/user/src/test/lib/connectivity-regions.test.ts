import {describe,it,expect} from "vitest";
import {connectivityRegions,orderedConnectivityRegions} from "../../../../shared/connectivity-regions";
describe("node region priority",()=>{
 it.each(connectivityRegions.filter(r=>r.country).map(r=>[r.country,r.id]))("%s local then global, China always last", (code,id)=>{
  const order=orderedConnectivityRegions(code).map(r=>r.id);
  expect(order.slice(0,id==="china"?1:2)).toEqual(id==="china"?["global"]:[id,"global"]);
  expect(order[order.length - 1]).toBe("china");
  expect(new Set(order).size).toBe(connectivityRegions.length);
 });
 it.each(["","xx",undefined])("unknown %s starts with global",code=>{
  const order=orderedConnectivityRegions(code).map(r=>r.id);
  expect(order[0]).toBe("global");
  expect(order[order.length - 1]).toBe("china");
 });
 it("normalizes ISO case and GB alias",()=>{
  expect(orderedConnectivityRegions(" hk ")[0].id).toBe("hongkong");
  expect(orderedConnectivityRegions("UK")[0].id).toBe("uk");
 });
});
