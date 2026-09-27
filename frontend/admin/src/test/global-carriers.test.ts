import {describe,it,expect} from "vitest";
import {parseEditableNote,serializePublicNote} from "@/lib/public-note";
import {readOtherRoutes,patchOtherRoutes,patchRoutes,chineseNote} from "@/lib/public-note-compat";
import {safeLogoSource} from "../../../shared/other-routes";
import {carriers} from "../../../shared/carriers";
import {carrierRegions} from "../../../shared/carrier-regions";
describe("global carrier notes",()=>{
 it("migrates legacy other text without losing fixed carriers or unknown fields",()=>{
  const n=parseEditableNote(JSON.stringify({planDataMod:{networkRoute:"CN2,陌生线路",x:1}}));
  expect(readOtherRoutes(n.planDataMod)).toEqual([{carrier:"",text:"陌生线路"}]);
  const edited=patchOtherRoutes(n,[...readOtherRoutes(n.planDataMod),{carrier:"ntt",text:"AS2914",country:"JP",custom:1}]);
  const saved=JSON.parse(serializePublicNote(patchRoutes(edited,"mobile","CMI")));
  expect(saved.planDataMod.networkRoute).toBe("CN2,CMI,陌生线路,AS2914");
  expect(saved.planDataMod.x).toBe(1);expect(saved.planDataMod.networkRoutes.other).toBe("");
  expect(saved.planDataMod.networkRouteEntries[1].custom).toBe(1);
 });
 it("round trips Chinese raw fields, custom logos and country selection",()=>{
  const n=patchOtherRoutes({} as import("@/lib/public-note").PublicNote,[{carrier:"custom",country:"NZ",name:"Example ISP",logo:"https://example.com/logo.png",text:"精品线路"}]);
  const raw=chineseNote(n);expect(raw).toContain("其他运营商线路");expect(raw).toContain("国家地区");
  expect(parseEditableNote(raw).planDataMod?.networkRouteEntries).toEqual(n.planDataMod?.networkRouteEntries);
  expect(JSON.parse(serializePublicNote(n)).planDataMod.networkRoute).toBe("精品线路");
 });
 it("retains old Chinese other alias and can remove all entries permanently",()=>{
  const n=parseEditableNote('{"套餐信息":{"运营商线路":{"其他线路":"旧线路"}}}');
  expect(readOtherRoutes(n.planDataMod)[0].text).toBe("旧线路");
  const next=parseEditableNote(serializePublicNote(patchOtherRoutes(n,[])));
  expect(readOtherRoutes(next.planDataMod)).toEqual([]);expect(next.planDataMod?.networkRoute).toBe("");
 });
 it("keeps mixed old and new other entries instead of silently dropping old text",()=>{
  expect(readOtherRoutes({networkRoutes:{other:"旧线路"},networkRouteEntries:[{carrier:"ntt",text:"NTT"}]})).toHaveLength(2);
 });
 it("rejects malformed extra entries and unsafe logo protocols",()=>{
  expect(()=>parseEditableNote('{"planDataMod":{"networkRouteEntries":[{"carrier":"ntt","text":12}]}}')).toThrow();
  for(const url of ["javascript:alert(1)","http://a.test/a","data:image/svg+xml;base64,PHN2Zz4=","https://user:pass@a.test/a"])expect(safeLogoSource(url)).toBe("");
  expect(safeLogoSource("https://example.com/a.png")).toBe("");
  expect(safeLogoSource("/api/v1/logo/assets/"+"a".repeat(64)+".svg")).toBe("/api/v1/logo/assets/"+"a".repeat(64)+".svg");
 });
 it("ships unique verified logos and a complete region selector",()=>{
  expect(carriers.length).toBeGreaterThanOrEqual(35);expect(new Set(carriers.map(c=>c.id)).size).toBe(carriers.length);
  expect(carrierRegions.length).toBeGreaterThanOrEqual(250);
  for(const c of carriers){if(c.icon)expect(c.icon).toMatch(/^data:image\//);else expect(c.reference).toBe(true);expect(c.regions.length).toBeGreaterThan(0);for(const code of c.regions)expect(carrierRegions.some(r=>r.code===code)).toBe(true)}
 });
});
