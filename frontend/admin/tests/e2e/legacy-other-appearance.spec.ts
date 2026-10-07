import {test,expect} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
const origin="https://127.0.0.1:18486";
test.use({baseURL:origin,ignoreHTTPSErrors:true});
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
for(const scenario of [{width:1366,mobile:false},{width:390,mobile:false},{width:1920,mobile:true}]){
 test("legacy footer IP "+JSON.stringify(scenario),async({browser,baseURL})=>{
  expect(baseURL).toBe(origin);
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:scenario.width,height:800},userAgent:scenario.mobile?"Mozilla/5.0 Android Mobile":"Mozilla/5.0 Desktop Chrome"});
  const page=await context.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:["footerIP","nameColor"].includes(d.key)}]))};
  const now=Date.now(),servers=[createServer({id:11,name:"原版离线名称",last_active:new Date(now-86400000).toISOString()})];
  await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:0,servers})));
  await page.route("**/*",async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==="/api/v1/setting")return route.fulfill({json:{success:true,data:{config:{language:"zh-CN",site_name:"原版校验",custom_code:"",appearance_config:JSON.stringify(config)}}}});
   if(u.pathname==="/api/v1/server-group")return route.fulfill({json:{success:true,data:[]}});
   if(u.pathname==="/api/v1/profile")return route.fulfill({json:{success:false}});
   if(u.pathname.includes("/service"))return route.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{}}}});
   if(u.origin!==origin)return route.fulfill({contentType:"text/html",body:"<p>IP test fixture</p>"});
   return route.continue();
  });
  await page.goto("/");const box=page.locator("[data-native-footer-ip]");
  await expect(box).toHaveCount(1);
  await page.evaluate(()=>{document.body.style.minHeight="2000px";window.scrollTo(0,2000)});
  if(scenario.mobile){await expect(box).toHaveCSS("display","none")}
  else{
   await expect(box).toHaveCSS("opacity","1");
   await expect(box).toHaveCSS("transition-property","opacity, transform");
   await expect(box).toHaveCSS("transition-duration","0.5s, 0.5s");
   await expect(box.locator("iframe")).toHaveCSS("background-color","rgb(255, 255, 255)");
   await expect(box.locator("iframe")).toHaveCSS("box-shadow","rgba(0, 0, 0, 0.2) 0px 4px 10px 0px");
   await expect(box).toHaveCSS("transform",new RegExp(", 0\\)$"));
   await page.screenshot({path:"test-results/legacy-footer-"+scenario.width+".png"});
   await page.evaluate(()=>window.scrollTo(0,0));
   await expect(box).toHaveCSS("opacity","0");
   await expect(box).toHaveCSS("transform",new RegExp(", 20\\)$"));
  }
  config.enabled=false;await page.reload();await expect(box).toHaveCount(0);
  expect(errors).toEqual([]);await context.close();
 });
}
