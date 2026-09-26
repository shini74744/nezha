import {describe,it,expect} from "vitest";
import {defaults,normalize,validate} from "@/appearance/config";
import {parseMediaLines,inTimeRange,matchesRegion,selectBackground,validateBackground} from "@/appearance/background-config";
const image=(name:string)=>({type:"image" as const,src:"https://example.test/"+name+".png"});
function fixture(){const f=defaults().features.background;f.desktopMedia=[image("desktop")];f.mobileMedia=[image("mobile")];f.chinaMedia=[image("region")];f.regionMobileMedia=[];f.scheduleRules=[{name:"night",enabled:true,start:"22:30",end:"06:15",desktopMedia:[image("night")],mobileMedia:[]}];return f}
describe("background policy",()=>{
 it("accepts newline mixed URLs and retains known endpoint media types",()=>{
  expect(parseMediaLines("https://x.test/a.jpg\nhttps://x.test/b.webm\nhttps://x.test/api\n\n",[{src:"https://x.test/api",type:"video"}])).toEqual([{src:"https://x.test/a.jpg",type:"image"},{src:"https://x.test/b.webm",type:"video"},{src:"https://x.test/api",type:"video"}]);
  expect(parseMediaLines("https://x.test/random")[0].type).toBe("auto");
 });
 it("handles cross-midnight, exclusive ending and full-day windows",()=>{
  expect(inTimeRange(23*60,"22:30","06:15")).toBe(true);
  expect(inTimeRange(6*60+14,"22:30","06:15")).toBe(true);
  expect(inTimeRange(6*60+15,"22:30","06:15")).toBe(false);
  expect(inTimeRange(11*60,"22:30","06:15")).toBe(false);
  expect(inTimeRange(800,"00:00","00:00")).toBe(true);
 });
 it("selects desktop/mobile, priorities and schedule fallback",()=>{
  const f=fixture(),night=new Date("2026-09-25T15:00:00Z"),day=new Date("2026-09-25T04:00:00Z");
  expect(selectBackground(f,false,false,day).media).toEqual([image("desktop")]);
  expect(selectBackground(f,true,false,day).media).toEqual([image("mobile")]);
  expect(selectBackground(f,true,false,night).media).toEqual([image("night")]);
  expect(selectBackground(f,false,true,night).media).toEqual([image("region")]);
  f.priority="schedule-first";expect(selectBackground(f,false,true,night).media).toEqual([image("night")]);
  f.scheduleRules[0].enabled=false;expect(selectBackground(f,false,true,night).media).toEqual([image("region")]);
 });
 it("matches custom nested API paths, countries and ASN without requiring both",()=>{
  const f=fixture();f.regionOrgPath="asn.org";f.regionCountryPath="data.country";f.regionCountries=["CN"];
  expect(matchesRegion(f,{asn:{org:"AS9808 China Mobile"},data:{country:"JP"}})).toBe(true);
  expect(matchesRegion(f,{data:{country:"cn"}})).toBe(true);
  expect(matchesRegion(f,{data:{country:"JP"}})).toBe(false);
  f.regionEnabled=false;expect(matchesRegion(f,{data:{country:"CN"}})).toBe(false);
 });
 it("upgrades old night and mobile regional settings without losing custom resources",()=>{
  const c=defaults(),f=c.features.background;c.enabled=true;
  delete f.scheduleRules;delete f.regionMobileMedia;f.nightStart=23;f.nightEnd=5;f.nightImages=["https://x.test/old.png"];f.chinaMedia=[image("custom-region")];
  const upgraded=normalize(c).features.background;
  expect(upgraded.scheduleRules[0]).toMatchObject({start:"23:00",end:"05:00",desktopMedia:[{type:"image",src:"https://x.test/old.png"}]});
  expect(upgraded.regionMobileMedia).toEqual([image("custom-region")]);
  expect(validate(normalize(c))).toBe("");
 });
 it("rejects invalid timezone, time and unsafe URLs; accepts extensionless media",()=>{
  const f=fixture();f.desktopMedia=[{type:"auto",src:"https://x.test/api"}];expect(()=>validateBackground(f)).not.toThrow();
  f.timezone="Bad/Timezone";expect(()=>validateBackground(f)).toThrow();f.timezone="Asia/Shanghai";
  f.scheduleRules[0].start="24:00";expect(()=>validateBackground(f)).toThrow();f.scheduleRules[0].start="22:30";
  f.desktopMedia[0].src="javascript:alert(1)";expect(()=>validateBackground(f)).toThrow();
 });
});
