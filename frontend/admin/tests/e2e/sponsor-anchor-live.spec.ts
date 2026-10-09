import {test,expect,Page} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
const origin="https://127.0.0.1:18477";
test.use({ignoreHTTPSErrors:true});
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
async function setup(page:Page, timing={shrinkDuration:800,stayDuration:60000,fadeDuration:500}) {
 const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:["sponsor","footer"].includes(d.key)}]))};
 Object.assign(config.features.sponsor,timing,{desktopTop:"9999px",sponsors:[{name:"Test sponsor",url:"https://example.com",logo:origin+"/sponsor-fixture.svg"}]});
 await page.addInitScript(()=>{localStorage.setItem("inline","0");localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")});
 const now=Date.now(),servers=Array.from({length:24},(_,i)=>createServer({id:i+1,name:"Anchor QA "+i,last_active:new Date(now).toISOString()}));
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:24,servers})));
 await page.route("**/*",r=>{
  const u=new URL(r.request().url());
  if(u.pathname==="/api/v1/setting")return r.fulfill({json:{success:true,data:{config:{language:"zh-CN",site_name:"Sponsor anchor test",custom_code:"",appearance_config:JSON.stringify(config)}}}});
  if(u.pathname==="/api/v1/server-group")return r.fulfill({json:{success:true,data:[]}});
  if(u.pathname==="/api/v1/profile")return r.fulfill({json:{success:false}});
  if(u.pathname.includes("/service"))return r.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{}}}});
  if(u.pathname==="/sponsor-fixture.svg")return r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="48"><rect width="280" height="48" fill="#286"/><text x="10" y="32" fill="white" font-size="24">SPONSOR</text></svg>'});
  if(u.origin!==origin)return r.abort();return r.continue();
 });
}
async function checkCentered(page:Page) {
 await expect(page.locator("#bmWrap")).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>{
  const row=document.querySelector(".server-overview-controls")!,b=row.getBoundingClientRect();
  const left=Math.max(b.left,...Array.from(row.querySelectorAll(":scope > section > *")).map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height).map(r=>r.right));
  const right=row.querySelector(":scope > div:last-child")!.getBoundingClientRect().left;
  const capsule=document.querySelector("#bmWrap")!.getBoundingClientRect();
  return Math.max(Math.abs(capsule.x+capsule.width/2-(left+right)/2),Math.abs(capsule.y+capsule.height/2-(b.y+b.height/2)),
   Math.max(0,left+11-capsule.left,capsule.right-right+11,capsule.height-b.height-32));
 })).toBeLessThan(1.1);
}
test("sponsor stays centered throughout resize, shrink, scroll and header changes",async({page,baseURL})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await setup(page);await page.goto(origin+"/");
 for(const width of [768,1024,1366,1920,2560,3840]){
  await page.setViewportSize({width,height:1000});await checkCentered(page);
  await page.screenshot({path:"test-results/sponsor-anchor-"+width+".png"});
 }
 await page.evaluate(()=>{(document.querySelector(".header-top") as HTMLElement).style.paddingTop="80px";document.documentElement.style.fontSize="20px"});
 await checkCentered(page);await page.evaluate(()=>window.scrollTo(0,120));await checkCentered(page);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 await expect(page.locator("#bmWrap")).toHaveClass(/bm-mobile-visible/);
 await expect.poll(async()=>{const b=await page.locator("#bmWrap").boundingBox();return Math.abs(844-b!.y-b!.height)}).toBeLessThan(1);
 await page.setViewportSize({width:1366,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await checkCentered(page);
 await expect(page.locator("#bmWrap")).toHaveCount(1);expect(errors).toEqual([]);
});
test("hover pauses stay; fade stays centered; navigating disposes",async({page})=>{
 await setup(page,{shrinkDuration:300,stayDuration:2500,fadeDuration:500});await page.goto(origin+"/");
 await checkCentered(page);await page.locator("#bmWrap").hover();await page.waitForTimeout(3000);
 await checkCentered(page);await expect(page.locator("#bmWrap")).not.toHaveClass(/bm-pc-hidden/);
 await page.mouse.move(0,0);await expect(page.locator("#bmWrap")).toHaveClass(/bm-pc-hidden/);
 await checkCentered(page);await expect(page.locator("#bmWrap")).toHaveCSS("display","none");
 await page.getByText("Anchor QA 0",{exact:true}).click();await expect(page).toHaveURL(/server\/1$/);
 // URL changes before React commits; wait for detail UI before testing disposal.
 await expect(page.locator(".server-detail-overview")).toBeVisible();
 await expect(page.locator("#bmWrap")).toBeHidden();
 await page.goBack({waitUntil:"commit"});await checkCentered(page);
});
for(const width of [320,390,454,640]) test("mobile sponsor rapid fling stays visible and footer uses SVG "+width,async({page},info)=>{
 await page.setViewportSize({width,height:844});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await setup(page);await page.goto(origin+"/");await expect(page.locator("[data-footer-region]")).toBeVisible();
 const wrap=page.locator("#bmWrap");
 await expect(page.locator(".nz-brand-footer svg.nz-footer-icon")).toHaveCount(1);
 await expect(page.locator(".nz-powered svg.nz-footer-icon")).toHaveCount(1);
 await expect(page.locator(".nz-powered svg.nz-footer-icon")).toHaveAttribute("fill","currentColor");
 await expect(page.locator(".nz-brand-footer i,.nz-powered i")).toHaveCount(0);
 for(let i=0;i<6;i++){
  await page.evaluate(()=>scrollTo(0,0));await expect(wrap).not.toHaveClass(/bm-mobile-visible/);
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await expect(wrap).toHaveClass(/bm-mobile-visible/);
  await page.waitForTimeout(60);await expect(wrap).toHaveClass(/bm-mobile-visible/);
 }
 await page.waitForTimeout(700);await expect(wrap).toHaveAttribute("aria-hidden","false");
 await expect.poll(async()=>{const b=await wrap.boundingBox();return Math.abs(844-b!.y-b!.height)}).toBeLessThan(1);
 // Async content growth at the end must not require a second slow swipe.
 await page.evaluate(()=>{const el=document.createElement("div");el.id="late-test-row";el.style.height="300px";document.querySelector("[data-footer-region]")!.before(el)});
 await expect(wrap).not.toHaveClass(/bm-mobile-visible/);
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await expect(wrap).toHaveClass(/bm-mobile-visible/);
 await page.evaluate(()=>document.getElementById("late-test-row")!.remove());await expect(wrap).toHaveClass(/bm-mobile-visible/);
 await page.setViewportSize({width,height:780});await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
 await expect(wrap).toHaveClass(/bm-mobile-visible/);
 await expect.poll(()=>page.evaluate(()=>{
  const footer=document.querySelector(".nz-footer-region > footer")!.getBoundingClientRect();
  const sponsor=document.querySelector("#bmWrap")!.getBoundingClientRect();
  return sponsor.top-footer.bottom;
 })).toBeLessThanOrEqual(12);
 const gap=await page.evaluate(()=>document.querySelector("#bmWrap")!.getBoundingClientRect().top-document.querySelector(".nz-footer-region > footer")!.getBoundingClientRect().bottom);
 expect(gap).toBeGreaterThanOrEqual(0);
 await page.waitForTimeout(400);await page.screenshot({path:info.outputPath("footer-"+width+".png")});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
