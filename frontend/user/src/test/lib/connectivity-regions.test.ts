import {describe,it,expect} from "vitest";
import {connectivityRegions,orderedConnectivityRegions} from "../../../../shared/connectivity-regions";
describe("node region priority",()=>{
 it.each(connectivityRegions.filter(r=>r.country).map(r=>[r.country,r.id]))("%s region first", (code,id)=>{
  const order=orderedConnectivityRegions(code).map(r=>r.id);
  expect(order.slice(0,id==="usa"?2:3)).toEqual(id==="usa"?["usa","global"]:[id,"usa","global"]);
  expect(new Set(order).size).toBe(connectivityRegions.length);
 });
 it.each(["","xx",undefined])("unknown %s uses US then global",code=>{
  expect(orderedConnectivityRegions(code).slice(0,2).map(r=>r.id)).toEqual(["usa","global"]);
 });
 it("normalizes ISO case and GB alias",()=>{
  expect(orderedConnectivityRegions(" cn ")[0].id).toBe("china");
  expect(orderedConnectivityRegions("UK")[0].id).toBe("uk");
 });
});
