import {describe,it,expect} from "vitest";
import {defaults,normalize,validate} from "@/appearance/config";
describe("per-theme card settings",()=>{
 it.each([0,0.65,1])("migrates legacy opacity %s without changing input",opacity=>{
  const raw={version:1 as const,enabled:true,features:{background:{enabled:true,opacity,blur:8}}};
  const before=JSON.stringify(raw),c=normalize(raw);
  expect(c.enabled).toBe(true);expect(c.features.background.lightOpacity).toBe(opacity);
  expect(c.features.background.darkOpacity).toBe(opacity);
  expect(c.features.background.lightBlur).toBe(8);expect(c.features.background.darkBlur).toBe(8);
  expect(JSON.stringify(raw)).toBe(before);expect(validate(c)).toBe("");
 });
 it("keeps explicit theme zeroes and migrates only missing settings",()=>{
  const c=normalize({version:1,enabled:true,features:{background:{enabled:true,opacity:0.7,blur:6,lightOpacity:0,darkBlur:0}}});
  expect(c.features.background).toMatchObject({lightOpacity:0,darkOpacity:0.7,lightBlur:6,darkBlur:0});
  expect(normalize(JSON.stringify(c))).toEqual(c);
 });
 it("accepts independent endpoints and rejects invalid values",()=>{
  const c=defaults();Object.assign(c.features.background,{lightOpacity:0,darkOpacity:1,lightBlur:0,darkBlur:30});
  expect(validate(c)).toBe("");
  for(const [key,values] of Object.entries({lightOpacity:[-0.1,1.1,NaN],darkOpacity:[-0.1,1.1,Infinity],lightBlur:[-1,31],darkBlur:[-1,31]})){
   for(const value of values){const invalid=structuredClone(c);invalid.features.background[key]=value;expect(validate(invalid)).not.toBe("");}
  }
 });
});
