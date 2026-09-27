import {describe,it,expect} from "vitest";
import {parseEditableNote,serializePublicNote,detectPublicNoteMode,validatePublicNote,publicNoteRawText} from "@/lib/public-note";
import {readRoutes,patchRoutes,chineseNote} from "@/lib/public-note-compat";
const old={billingDataMod:{startDate:"2026-06-15T00:00:00+08:00",cycle:"月",autoRenewal:"1"},planDataMod:{trafficVol:"5TB/月",trafficType:"0",IPv4:"1",IPv6:"0",networkRoute:"163PP/CN2,CMI/CMIN2,10099/9929专线",extra:"三网顶级优化",unknown:{keep:true}},customRoot:"keep"};
describe("bilingual public note editor",()=>{
 it("reads the supplied legacy example without dropping custom fields",()=>{
  const n=parseEditableNote(JSON.stringify(old));
  expect(n.billingDataMod?.cycle).toBe("Month");expect(n.planDataMod?.trafficType).toBe("0");
  expect(validatePublicNote(n).valid).toBe(true);
  expect(readRoutes(n.planDataMod)).toEqual({telecom:"163PP/CN2",mobile:"CMI/CMIN2",unicom:"10099/9929专线",other:""});
  expect(n.customRoot).toBe("keep");expect(n.planDataMod?.unknown).toEqual({keep:true});
 });
 it("round trips edits through Chinese text and legacy storage",()=>{
  let n=parseEditableNote(JSON.stringify(old));n=patchRoutes(n,"telecom","自定义电信线路");
  n.planDataMod!.resetDay="15";
  const raw=chineseNote(n);expect(raw).toContain('"流量": "5TB/月"');expect(raw).toContain('"中国电信": "自定义电信线路"');
  const p=parseEditableNote(raw),saved=JSON.parse(serializePublicNote(p));
  expect(saved.planDataMod.networkRoute).toBe("自定义电信线路,CMI/CMIN2,10099/9929专线");
  expect(saved.customRoot).toBe("keep");expect(saved.planDataMod.unknown).toEqual({keep:true});
  expect(saved.planDataMod.resetDay).toBe("15");expect(saved.planDataMod.trafficType).toBe("0");
  expect(readRoutes(saved.planDataMod).telecom).toBe("自定义电信线路");
 });
 it("retains ambiguous and unfamiliar routes in other, including Chinese commas",()=>{
  expect(readRoutes({networkRoute:"CMI/CN2，精品BGP｜9929;AS4134"})).toEqual({telecom:"AS4134",mobile:"",unicom:"9929",other:"CMI/CN2,精品BGP"});
 });
 it("does not guess trafficType 0; supports explicit Chinese directions and flags",()=>{
  const n=parseEditableNote(JSON.stringify({账单信息:{付费周期:"月",自动续费:true},套餐信息:{流量:"5TB/月",流量统计方向:"上传",IPv4:true,IPv6:false,流量重置日:15}}));
  expect(n.planDataMod).toMatchObject({trafficType:"3",IPv4:"1",IPv6:"0",resetDay:"15"});
  expect(n.billingDataMod).toMatchObject({cycle:"Month",autoRenewal:"1"});
 });
 it("blocks unsafe conversions instead of clearing the raw note",()=>{
  for(const raw of ["plain text","{broken",'{"planDataMod":null}','{"planDataMod":{"trafficVol":{}}}','{"套餐信息":{},"planDataMod":{"trafficVol":"1TB"}}']){
   expect(()=>parseEditableNote(raw)).toThrow();expect(detectPublicNoteMode(raw)).toBe("raw");
   expect(publicNoteRawText(raw)).toBe(raw);
  }
 });
 it("preserves empty and unknown content and validates reset day",()=>{
  expect(detectPublicNoteMode("")).toBe("structured");expect(parseEditableNote("")).toEqual({});
  expect(detectPublicNoteMode('{"unknown":1}')).toBe("raw");
  for(const day of ["0","32","1.5","abc"])expect(validatePublicNote({planDataMod:{resetDay:day}}).valid).toBe(false);
  for(const day of ["","1","15","31"])expect(validatePublicNote({planDataMod:{resetDay:day}}).valid).toBe(true);
 });
 it("allows clearing a carrier without restoring it from legacy networkRoute",()=>{
  const n=patchRoutes(parseEditableNote(JSON.stringify(old)),"mobile","");
  const next=parseEditableNote(serializePublicNote(n));
  expect(readRoutes(next.planDataMod).mobile).toBe("");expect(next.planDataMod?.networkRoute).not.toContain("CMI");
 });
});
