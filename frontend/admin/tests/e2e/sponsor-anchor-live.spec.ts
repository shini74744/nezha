import {test,expect,Page} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
const origin="http://127.0.0.1:18476";
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
async function setup(page:Page, timing={shrinkDuration:800,stayDuration:60000,fadeDuration:500}) {
 const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:d.key==="sponsor"}]))};
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
 expect(baseURL).toBe(origin);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await setup(page);await page.goto("/");
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
 await setup(page,{shrinkDuration:300,stayDuration:700,fadeDuration:500});await page.goto("/");
 await checkCentered(page);await page.locator("#bmWrap").hover();await page.waitForTimeout(1200);
 await checkCentered(page);await expect(page.locator("#bmWrap")).not.toHaveClass(/bm-pc-hidden/);
 await page.mouse.move(0,0);await expect(page.locator("#bmWrap")).toHaveClass(/bm-pc-hidden/);
 await checkCentered(page);await expect(page.locator("#bmWrap")).toHaveCSS("display","none");
 await page.getByText("Anchor QA 0",{exact:true}).click();await expect(page).toHaveURL(/server\/1$/);
 await expect(page.locator("#bmWrap")).toBeHidden();await page.goBack();await checkCentered(page);
});
