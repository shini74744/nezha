import {describe,it,expect} from "vitest";
import {defaults,normalize,validate} from "@/lib/appearance-config";
describe("independent speed configuration",()=>{
 it.each([true,false])("inherits legacy shared settings (%s) without enabling a disabled group",flag=>{
  const c=normalize(JSON.stringify({version:1,enabled:true,features:{speed:{enabled:false,bits:flag,color:flag,animation:flag}}}));
  expect(c.features.speed).toMatchObject({enabled:false,bits:flag,color:flag,animation:flag,cardEnabled:true,overviewEnabled:true,overviewBits:flag,overviewColor:flag,overviewAnimation:flag});
  expect(validate(c)).toBe("");
  expect(normalize(JSON.stringify(c))).toEqual(c);
 });
 it("preserves explicitly independent values on repeated normalization",()=>{
  const c=defaults();Object.assign(c.features.speed,{bits:false,color:false,animation:false,cardEnabled:false,overviewEnabled:true,overviewBits:true,overviewColor:true,overviewAnimation:true});
  expect(normalize(c)).toEqual(c);
  const roundtrip=normalize(JSON.stringify(normalize(c)));
  expect(roundtrip.features.speed).toEqual(c.features.speed);
 });
 it.each(["cardEnabled","overviewEnabled","overviewBits","overviewColor","overviewAnimation"])("rejects malformed %s",key=>{
  const c=defaults();c.enabled=true;c.features.speed[key]="yes";
  expect(validate(c)).not.toBe("");expect(normalize(c).enabled).toBe(false);
 });
});
