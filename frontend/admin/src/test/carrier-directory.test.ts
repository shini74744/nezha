import {describe,it,expect} from "vitest";
import {carriers,curatedCarriers,carrierCoverage,findCarrier} from "../../../shared/carriers";
import {parseEditableNote,serializePublicNote} from "@/lib/public-note";
describe("global reference directory",()=>{
 it("covers regions separately from logos, without fake source-site icons",()=>{
  expect(carrierCoverage).toBeGreaterThanOrEqual(220);expect(curatedCarriers.length).toBeGreaterThanOrEqual(120);
  expect(carriers.filter(c=>c.reference).length).toBeGreaterThan(1800);
  for(const c of curatedCarriers){expect(c.icon).toMatch(/^data:image\//);expect(c.assetSource).not.toContain("/img/icons/");}
  for(const id of ["hgc","hkbn","csl","three-hk","smartone-telecommunications","cmhk"])expect(findCarrier(id)?.regions).toContain("HK");
  for(const iso of ["AF","AR","NZ","KE","FJ","AD","IS","HK","MO"])expect(carriers.some(c=>c.regions.includes(iso))).toBe(true);
 });
 it("round-trips reference selections and optional logo overrides",()=>{
  const item=carriers.find(c=>c.reference&&c.regions.includes("AD"))!;
  const entry={carrier:item.id,country:"AD",text:"Andorra line",logo:"https://example.com/logo.png"};
  const note=parseEditableNote(JSON.stringify({planDataMod:{networkRouteEntries:[entry]}}));
  expect(JSON.parse(serializePublicNote(note)).planDataMod.networkRouteEntries).toEqual([entry]);
 });
});
