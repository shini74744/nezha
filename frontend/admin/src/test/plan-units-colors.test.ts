import {describe,it,expect} from "vitest";
import {splitPlanValue,formatPlanValue,planValueUnits} from "../../../shared/plan-value-units";
import {extraNotes,extraNoteColor,extraNotePalette,reconcileExtraColors} from "../../../shared/extra-note-colors";
import {defaultCarrierColors,carrierColorStyle} from "../../../shared/carrier-colors";
import {parseEditableNote,serializePublicNote,publicNoteRawText} from "@/lib/public-note";
describe("numeric plan units",()=>{
 it("offers only requested bandwidth and currency units",()=>{
  expect(planValueUnits.bandwidth).toEqual(["Mbps","Gbps","Tbps"]);
  expect(planValueUnits.amount).toEqual(["CNY","USD","EUR"]);
 });
 it.each([["500mbps","500","Mbps"],["1.5 Gbps","1.5","Gbps"],[".5Tbps",".5","Tbps"]])("reads bandwidth %s",(raw,amount,unit)=>expect(splitPlanValue("bandwidth",raw)).toEqual({amount,unit}));
 it.each([["90刀","90","USD"],["$12","12","USD"],["12美刀","12","USD"],["10人民币","10","CNY"],["￥20","20","CNY"],["€2.5","2.5","EUR"],["20欧元","20","EUR"]])("reads currency %s",(raw,amount,unit)=>expect(splitPlanValue("amount",raw)).toEqual({amount,unit}));
 it.each(["无限流量","1GiB/月","custom","-5","1e5","500MBps"])("preserves unknown bandwidth %s",raw=>expect(splitPlanValue("bandwidth",raw)).toBeNull());
 it("supports traffic units and valid canonical decimals",()=>{
  expect(splitPlanValue("traffic","500G")).toEqual({amount:"500",unit:"GB"});
  expect(splitPlanValue("traffic","1.5TB/Month")).toEqual({amount:"1.5",unit:"TB"});
  expect(splitPlanValue("traffic","无限流量")).toBeNull();
  expect(formatPlanValue("traffic",".5","TB")).toBe("0.5TB/月");
  expect(formatPlanValue("traffic","1.","GB")).toBe("1GB/月");
  expect(formatPlanValue("bandwidth","500","Gbps")).toBe("500Gbps");
  expect(formatPlanValue("amount","90","EUR")).toBe("90EUR");
  expect(formatPlanValue("amount","0","USD")).toBe("0");
  expect(formatPlanValue("amount","-1","EUR")).toBe("-1");
  expect(formatPlanValue("amount","","CNY")).toBe("");
 });
});
describe("note and link colors",()=>{
 it("uses distinct default colors and safely ignores invalid CSS",()=>{
  expect(extraNotes("1, 2，3,,4,5,")).toEqual(["1","2","3","4","5"]);
  expect(new Set(extraNotePalette.slice(0,5)).size).toBe(5);
  for(const color of extraNotePalette)expect(Object.values(defaultCarrierColors)).not.toContain(color);
  expect(extraNoteColor(["url(javascript:x)"],0)).toBe(extraNotePalette[0]);
  expect(carrierColorStyle("#ffffff")?.color).toBe("#000000");
  expect(carrierColorStyle("#111827")?.color).toBe("#ffffff");
 });
 it("retains colors with retained or reordered notes and duplicate occurrences",()=>{
  const colors=["#111111","#222222","#333333"];
  expect(reconcileExtraColors("a,b,c","c,a",colors)).toEqual(["#333333","#111111"]);
  expect(reconcileExtraColors("a,b,c","new,a,b,c",colors)).toEqual(["",...colors]);
  expect(reconcileExtraColors("a,a,b","a,b,a",colors)).toEqual(["#111111","#333333","#222222"]);
  expect(reconcileExtraColors("a,b,c","a,renamed,c",colors)).toEqual(colors);
  expect(reconcileExtraColors("a","b",undefined)).toBeUndefined();
 });
 it("roundtrips colors and unknown data in Chinese and canonical note modes",()=>{
  const note={planDataMod:{extra:"a,b",extraColors:["#111111",""],linkTags:[{name:"Site",url:"example.com",color:"#ffffff",keep:1}],custom:2},unknown:{x:3}};
  const raw=publicNoteRawText(JSON.stringify(note));
  expect(raw).toContain("补充说明颜色");expect(raw).toContain("标签颜色");
  const parsed=parseEditableNote(raw),saved=JSON.parse(serializePublicNote(parsed));
  expect(saved).toMatchObject(note);
 });
});
