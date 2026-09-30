import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
const asset="/api/v1/logo/assets/"+"d".repeat(64)+".svg";
for(const width of [360,390,430,1366])for(const variant of ["priced-long","short","no-expiry-long"])
test("offline logo uses only existing space "+width+" "+variant,async({page})=>{
 let logo=false;const now=Date.now(),name=variant==="short"?"MAC MINI M4":"杜蕾斯7欧荷兰-机票托管";
 const note=()=>({...(variant==="priced-long"?{billingDataMod:{amount:"9欧",cycle:"Year",startDate:"2026-09-01T00:00:00+08:00",endDate:"2027-09-01T00:00:00+08:00"}}:{}),planDataMod:{...(variant==="priced-long"?{trafficVol:"无限TB/月",bandwidth:"10Gbps",linkTags:[{name:"123131",url:"example.com"}]}:{}),...(logo?{providerLogo:{logo:asset}}:{})}});
 await page.setViewportSize({width,height:900});
 await page.addInitScript(()=>{localStorage.setItem("inline","0");localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:0,servers:[createServer({id:11,name,last_active:"2020-01-01T00:00:00Z",public_note:JSON.stringify(note())})]})));
 await page.route("**/api/v1/**",r=>{const p=new URL(r.request().url()).pathname;let data:any=[];
  if(p===asset)return r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="purple"/></svg>'});
  if(p==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"离线 Logo 回归"}};
  if(p.includes("/service"))data={services:{},cycle_transfer_stats:{}};
  if(p==="/api/v1/server-traffic")data={};return r.fulfill({json:{success:true,data}});
 });
 const snapshot=()=>page.locator("[data-server-card]").evaluate(el=>{const c=el.getBoundingClientRect();return {size:[c.width,c.height],items:[...el.querySelectorAll("[data-server-name],[data-server-status],[data-server-flag],[data-billing-price],[data-billing-expiry],[data-expiry-progress],[data-server-link-tags]")].map(e=>{const r=e.getBoundingClientRect();return [r.x-c.x,r.y-c.y,r.width,r.height]})}});
 await page.goto("/");await expect(page.locator("[data-server-name]")).toHaveText(name);await page.evaluate(()=>document.fonts.ready);const before=await snapshot();
 logo=true;await page.reload();const image=page.locator("[data-provider-logo]");await expect(image).toHaveCount(1);await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);await page.evaluate(()=>document.fonts.ready);
 expect(await snapshot()).toEqual(before);
 const box=page.locator("[data-provider-logo-box]");
 if(width>=1024){
  await expect(image).toBeVisible();
  if(variant==="priced-long")await expect(box).toHaveAttribute("data-desktop-logo-placement","left");
  const r=(await image.boundingBox())!,c=(await page.locator("[data-server-card]").boundingBox())!;
  expect(r.width).toBeGreaterThan(0);expect(r.height).toBeGreaterThan(0);expect(r.x).toBeGreaterThanOrEqual(c.x);expect(r.y).toBeGreaterThanOrEqual(c.y);expect(r.x+r.width).toBeLessThanOrEqual(c.x+c.width);expect(r.y+r.height).toBeLessThanOrEqual(c.y+c.height);
  const obstacles=await page.locator("[data-server-card]").evaluate(el=>[...el.querySelectorAll("[data-server-name],[data-server-status],[data-server-flag],[data-billing-price],[data-billing-expiry],[data-expiry-progress],[data-server-link-tags]")].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}).filter(r=>r.w&&r.h));
  for(const o of obstacles)expect(r.x<o.x+o.w&&r.x+r.width>o.x&&r.y<o.y+o.h&&r.y+r.height>o.y).toBe(false);
 }else expect(await box.getAttribute("data-desktop-logo-placement")).toBeNull();
 await page.locator("[data-server-card]").screenshot({path:"test-results/offline-logo-slot-"+width+"-"+variant+".png"});
});

for(const width of [390,1366])test("reset day help is collapsed behind question mark "+width,async({page})=>{
 await page.setViewportSize({width,height:950});
 const server={id:11,name:"提示检查机器",host:{version:"2.3.6"},display_index:0,user_id:1,uuid:"fixture",public_note:JSON.stringify({planDataMod:{linkTags:[{name:"",url:""}]}}),note:"",enable_ddns:false,hide_for_guest:false};
 await page.route("**/api/v1/**",r=>{const p=new URL(r.request().url()).pathname;let data:any=[];if(p==="/api/v1/profile")data={id:1,username:"admin",role:0};if(p==="/api/v1/setting")data={config:{site_name:"验证",language:"zh-CN"},version:"test"};if(p==="/api/v1/server")data=[server];return r.fulfill({json:{success:true,data}})});
 await page.goto("/dashboard");await page.getByRole("button",{name:"编辑服务器",exact:true}).click();const dialog=page.getByRole("dialog");
 await expect(dialog.getByLabel("标签名称 1",{exact:true})).not.toHaveAttribute("placeholder");await expect(dialog.getByLabel("标签网址 1",{exact:true})).not.toHaveAttribute("placeholder");
 const help=page.getByText(/每月该日北京时间 00:00 开始新周期/);await expect(help).toHaveCount(0);
 await dialog.getByRole("button",{name:"流量重置日说明",exact:true}).click();await expect(help).toBeVisible();
 await page.screenshot({path:"test-results/reset-day-help-"+width+".png"});
 await page.keyboard.press("Escape");await expect(help).toHaveCount(0);
});
