import {test,expect} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
const origin="http://127.0.0.1:18476";
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
for(const inline of ["0","1"])test("offline notes retain legacy layout, view "+inline,async({page,baseURL})=>{
 expect(baseURL).toBe(origin);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:["traffic","nameColor"].includes(d.key)}]))};
 const note=JSON.stringify({billingDataMod:{startDate:"2026-09-01",endDate:"2026-10-01",amount:"9EUR",cycle:"Month"},planDataMod:{bandwidth:"100Mbps",trafficVol:"10T/月",IPv4:"1",networkRoute:"CMI",extra:"保留备注"}});
 const now=Date.now(),servers=[createServer({id:11,name:"在线节点",last_active:new Date(now).toISOString()}),
  createServer({id:12,name:"离线节点-长名称",public_note:note}),createServer({id:13,name:"离线无备注"})];
 await page.addInitScript(v=>{localStorage.setItem("inline",v);localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")},inline);
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:1,servers})));
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==="/api/v1/setting")return route.fulfill({json:{success:true,data:{config:{language:"zh-CN",custom_code:"",appearance_config:JSON.stringify(config)}}}});
  if(u.pathname==="/api/v1/server-group")return route.fulfill({json:{success:true,data:[]}});
  if(u.pathname==="/api/v1/profile")return route.fulfill({json:{success:false}});
  if(u.pathname.includes("/service"))return route.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{"7":{name:"quota",max:1000,from:"2026-09-01",to:"2026-10-01",transfer:{"11":200,"12":6000,"13":0}}}}}});
  if(u.origin!==origin)return route.abort();
  return route.continue();
 }); for(const width of [1366,1920,390]){
  await page.setViewportSize({width,height:900});await page.goto("/");
  await expect(page.getByText("离线节点-长名称",{exact:true})).toBeVisible();
  await expect(page.locator("[data-native-traffic='11']")).toBeVisible();
  await expect(page.locator("[data-native-traffic='12'],[data-native-traffic='13']")).toHaveCount(0);
  await expect(page.getByText("保留备注",{exact:true})).toBeVisible();
  const card=page.getByText("离线节点-长名称",{exact:true}).locator("xpath=ancestor::div[contains(@class,'cursor-pointer')][1]");
  expect((await card.boundingBox())!.height).toBeLessThan(240);
  await page.screenshot({path:"test-results/offline-"+inline+"-"+width+".png",fullPage:true});
 }
 expect(errors).toEqual([]);
});