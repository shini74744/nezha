import {describe,it,expect,vi} from "vitest";
import {bodyDescentSample,inkCenterOffset,observeBadgeText} from "@/lib/badge-ink-alignment";

describe("glyph centre, independent from the icon and the line box",()=>{
 it.each([
  ["2000Mbps","2000Mbxs"],["10Gbps","10Gbxs"],["gypqj","xxxxx"],
  ["中文2TB/月","中文2TB/月"],["IPv4/IPv6","IPv4/IPv6"],
  ["📡爱尔兰IP","📡爱尔兰IP"],["",""],
 ])("uses the font body instead of Latin tails for %s",(label,expected)=>{
  expect(bodyDescentSample(label)).toBe(expected);
 });
 it("keeps the icon centre fixed while moving only the text body",()=>{
  const frame=9,baseline=10,ascent=7;
  const old=inkCenterOffset(frame,baseline,baseline,ascent,2);
  const body=inkCenterOffset(frame,baseline,baseline,ascent,0);
  expect(body-old).toBe(1);
  expect(baseline+body-ascent).toBe(frame-(ascent/2));
 });
 it.each([
  [9,10,10,7,2,1.5],
  [9,12,12,7,2,-0.5],
  [9,10,10,7,0,2.5],
  [15,10,22,7,2,1.5],
  [18,20,20,14,4,3],
 ])("centres actual first/last glyph edges", (center,first,last,ascent,descent,expected)=>{
  const offset=inkCenterOffset(center,first,last,ascent,descent);
  expect(offset).toBe(expected);
  expect(((first+offset-ascent)+(last+offset+descent))/2).toBe(center);
 });
 it("shares listeners and releases them after the last badge unmounts",()=>{
  const add=vi.spyOn(window,"addEventListener"),remove=vi.spyOn(window,"removeEventListener");
  const a=document.createElement("span"),b=document.createElement("span");
  const stopA=observeBadgeText(a),stopB=observeBadgeText(b);
  expect(add.mock.calls.filter(([type])=>type==="resize")).toHaveLength(1);
  stopA();
  expect(remove.mock.calls.filter(([type])=>type==="resize")).toHaveLength(0);
  stopB();
  expect(remove.mock.calls.filter(([type])=>type==="resize")).toHaveLength(1);
  add.mockRestore();remove.mockRestore();
 });
});
