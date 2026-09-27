import {describe,it,expect} from "vitest";
import {removePlainBackground} from "@/lib/logo-image";
import {parseEditableNote,serializePublicNote} from "@/lib/public-note";
import {chineseNote} from "@/lib/public-note-compat";
describe("logo tools",()=>{
 function pixels(){const d=new Uint8ClampedArray(10*10*4).fill(255);for(let y=2;y<8;y++)for(let x=2;x<8;x++){const p=(y*10+x)*4;d[p]=20;d[p+1]=100;d[p+2]=200}return d}
 it("only removes the edge-connected neutral background",()=>{const d=pixels();d.set([255,255,255,255],(5*10+5)*4);expect(removePlainBackground(d,10,10)).toBe(true);expect(d[3]).toBe(0);expect(d[(5*10+5)*4+3]).toBe(255)});
 it("preserves alpha, colored backgrounds, full white and edge-touching artwork",()=>{const a=pixels();a[3]=0;expect(removePlainBackground(a,10,10)).toBe(false);expect(removePlainBackground(new Uint8ClampedArray(400).fill(255),10,10)).toBe(false);const b=pixels();b[0]=0;expect(removePlainBackground(b,10,10)).toBe(false);const c=pixels();for(let x=0;x<10;x++)c[x*4]=0;expect(removePlainBackground(c,10,10)).toBe(false)});
 it("round trips vendor and built-in overrides in Chinese raw notes",()=>{const logo={logo:"https://example.com/logo.png",logoOriginal:"https://example.com/original.png",logoWebsite:"www.example.com"};const input={planDataMod:{providerLogo:logo,networkRouteLogos:{telecom:logo},networkRouteEntries:[{carrier:"ntt",text:"AS2914",...logo}]},keep:"yes"};const chinese=chineseNote(input);expect(chinese).toContain("厂商图标");expect(chinese).toContain("原始Logo");expect(JSON.parse(serializePublicNote(parseEditableNote(chinese)))).toMatchObject(input)});
});
