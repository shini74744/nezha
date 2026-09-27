import {describe,it,expect} from "vitest";
import {parseEditableNote,serializePublicNote} from "@/lib/public-note";
import {chineseNote} from "@/lib/public-note-compat";
import {safeLogoSource} from "../../../shared/other-routes";
import {carrierColorStyle,safeCarrierColor} from "../../../shared/carrier-colors";
describe("carrier customization",()=>{
 it("round trips colors and a logo larger than the old limit",()=>{
  const logo="data:image/png;base64,"+"A".repeat(100000);
  const input={planDataMod:{networkRouteColors:{telecom:"#ffcc00",other:"#222222"},
   networkRouteEntries:[{carrier:"custom",text:"ISP",color:"#123456",logo}]}};
  const note=parseEditableNote(chineseNote(input));
  expect(JSON.parse(serializePublicNote(note))).toMatchObject(input);
  expect(safeLogoSource(logo)).toBe(logo);
 });
 it("rejects executable image sources and CSS injection",()=>{
  expect(safeLogoSource("data:image/svg+xml;base64,PHN2Zz4=")).toBe("");
  expect(safeLogoSource("javascript:alert(1)")).toBe("");
  expect(safeCarrierColor("red;background:url(x)")).toBeUndefined();
  expect(carrierColorStyle("#ffffff")?.color).toBe("#000000");
  expect(carrierColorStyle("#000000")?.color).toBe("#ffffff");
  expect(carrierColorStyle(undefined)).toBeUndefined();
 });
});
