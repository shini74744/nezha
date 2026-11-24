import { describe, it, expect } from "vitest";
import { defaults, normalize, validate } from "../../../../appearance/admin/settings/appearance-config";
import { normalize as normalizeUser } from "../../../../appearance/site/config";
import { chooseFont, fontCSS } from "../../../../appearance/shared/appearance-options";
import fonts from "../../../../appearance/shared/font-styles.json";
import { normalizeThemeAppearance, appearanceEndpoint, appearancePayload } from "../../../../appearance/admin/settings/theme-appearance";

describe("font and effect configuration", () => {
 it.each([-1,0,1,2,3,4,5,6,7])("preserves old font selection %i", selection => {
  const raw = {version:1,enabled:true,features:{font:{enabled:true,selection},heart:{enabled:false},links:{enabled:true}}} as any;
  const c=normalize(raw), u=normalizeUser(raw);
  expect(validate(c)).toBe(""); expect(c).toEqual(u);
  expect(c.features.font.activeId).toBe(selection<0?"random":c.features.font.items[selection].id);
  expect(c.features.heart.enabled).toBe(false);
  expect(c.features.hideControls.login).toBe(false);
 });
 it("uses stable font IDs after reorder and does not mutate the source",()=>{
  const c=defaults();c.features.font.activeId="noto";const before=JSON.stringify(c.features.font);
  const copy=normalize(c);copy.features.font.items.reverse();
  expect(chooseFont(copy.features.font,.2)?.id).toBe("noto");
  expect(JSON.stringify(c.features.font)).toBe(before);
 });
 it("escapes custom CSS and falls back when the selected font is unavailable",()=>{
  const item={id:"custom",name:"Font",family:'x";}</style><script>alert(1)</script>',source:"file",url:'https://example.test/a");}body{color:red}.woff2',format:"woff2",builtin:""};
  const css=fontCSS(item,fonts);
  expect(css).not.toContain("</style>");
  expect(css).toContain('a\\");');
  expect(fontCSS(undefined,fonts)).toBe("");
 });
 it.each([
  ["font", (f:any)=>f.items.push({...f.items[0]})],
  ["font", (f:any)=>f.activeId="missing"],
  ["font", (f:any)=>f.items=[]],
  ["font", (f:any)=>{f.items[0].source="file";f.items[0].url=""}],
  ["font", (f:any)=>f.items[0].url="javascript:alert(1)"],
  ["font", (f:any)=>f.items[0].url="https://user:pass@example.test/a.woff2"],
  ["stars", (f:any)=>f.palette=[]],
  ["stars", (f:any)=>f.palette=["red;}</style>"]],
  ["stars", (f:any)=>f.interval=0],
  ["heart", (f:any)=>f.duration=10],
  ["heart", (f:any)=>f.size=10.5],
  ["sakura", (f:any)=>f.mobileCount=81],
  ["links", (f:any)=>f.textColor="red"],
 ])("rejects unsafe or invalid %s parameters", (key, mutate)=>{
  const c=defaults();(mutate as any)(c.features[key as string]);
  expect(validate(c)).not.toBe("");
 });
 it("round trips configured effects, colors, fonts and login visibility",()=>{
  const c=defaults();c.enabled=true;
  Object.assign(c.features.heart,{size:18,duration:700,fixedColor:"#123456",randomColor:false});
  Object.assign(c.features.stars,{palette:["#ffffff"],interval:100,duration:500});
  Object.assign(c.features.sakura,{count:12,mobileCount:5,wind:2,speed:.5,opacity:.6});
  c.features.hideControls.login=true;
  c.features.font.items.push({id:"custom",name:"自选字体",source:"file",family:"Example",url:"https://example.test/font.woff2",format:"woff2",builtin:""});
  c.features.font.activeId="custom";
  expect(validate(c)).toBe("");expect(normalize(JSON.stringify(c))).toEqual(c);expect(normalizeUser(JSON.stringify(c))).toEqual(c);
 });
 it("keeps Paper settings separate with a complete native feature set",()=>{
  const c=normalizeThemeAppearance("paper-dist");
  expect(validate(c)).toBe("");expect(c.enabled).toBe(true);expect(c.features.background.enabled).toBe(false);
  expect(c.features.links.enabled).toBe(true);expect(c.features.hideControls.theme).toBe(false);
  expect(c.features.speed).toMatchObject({enabled:true,bits:true,overviewBits:true,animation:false,overviewAnimation:false});
  expect(Object.keys(c.features)).toEqual(Object.keys(defaults().features));
  expect(appearanceEndpoint("paper-dist")).toBe("/api/v1/setting/appearance?theme=paper-dist");
  expect(appearancePayload("paper-dist",c)).toEqual(c);
  c.features.links.fontSize=20;
  expect(normalizeThemeAppearance("user-dist").features.links.fontSize).toBe(14);
 });
});
