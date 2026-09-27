import {it,expect} from "vitest";
import {parseEditableNote,serializePublicNote,validatePublicNote} from "@/lib/public-note";
import {chineseNote} from "@/lib/public-note-compat";
import {logoPlacement} from "../../../shared/logo-layout";
it("round trips independent desktop and mobile layout through Chinese raw notes",()=>{
 const n={planDataMod:{providerLogo:{logo:"/api/v1/logo/assets/"+"a".repeat(64)+".png",logoLibraryId:"provider-1",logoLayout:{desktop:{x:12,y:-8,scale:125},mobile:{x:-3,y:4,scale:75}}}}};
 const raw=chineseNote(n);expect(raw).toContain("电脑端");expect(raw).toContain("左右偏移");
 const parsed=parseEditableNote(raw);expect(validatePublicNote(parsed).valid).toBe(true);expect(JSON.parse(serializePublicNote(parsed))).toEqual(n);
});
it("validates layout inputs and clamps unsafe legacy values at render time",()=>{
 expect(validatePublicNote({planDataMod:{providerLogo:{logoLayout:{mobile:{scale:999}}}}}).valid).toBe(false);
 expect(logoPlacement({desktop:{x:999,y:NaN,scale:-1}},"desktop")).toEqual({x:150,y:0,scale:25});
 expect(logoPlacement(undefined,"mobile")).toEqual({x:0,y:0,scale:100});
});
