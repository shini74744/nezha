import {test,expect,Page} from "@playwright/test";
import {setupNativeLayout,origin} from "./native-layout-fixture";
test.use({ignoreHTTPSErrors:true});
async function centered(page:Page){
 await expect(page.locator("#bmWrap")).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>{
  const slot=document.querySelector("[data-native-sponsor-slot]")!.getBoundingClientRect(),capsule=document.querySelector("#bmWrap")!.getBoundingClientRect();
  return Math.max(Math.abs(capsule.x+capsule.width/2-slot.x-slot.width/2),Math.abs(capsule.y+capsule.height/2-slot.y-slot.height/2),slot.x-capsule.x,capsule.right-slot.right);
 })).toBeLessThan(1.1);
}
test("native sponsor stays aligned during every scroll frame and resize",async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await setupNativeLayout(page);await page.goto(origin);
 for(const width of [768,1024,1366,1920,2560,3840]){await page.setViewportSize({width,height:900});await centered(page)}
 await page.setViewportSize({width:1366,height:900});await centered(page);
 const drift=await page.evaluate(async()=>{
  const deltas:number[]=[];for(let frame=0;frame<50;frame++){
   scrollTo(0,frame<25?frame*12:(50-frame)*12);
   await new Promise(requestAnimationFrame);
   const a=document.querySelector("[data-native-sponsor-slot]")!.getBoundingClientRect(),b=document.querySelector("#bmWrap")!.getBoundingClientRect();
   deltas.push(Math.abs(a.y+a.height/2-b.y-b.height/2));
  }return Math.max(...deltas);
 });expect(drift).toBeLessThan(1);
 await page.evaluate(()=>{(document.querySelector(".header-top") as HTMLElement).style.paddingTop="80px";document.documentElement.style.fontSize="20px";scrollTo(0,0)});await centered(page);
 await page.screenshot({path:info.outputPath("native-sponsor-desktop.png")});expect(errors).toEqual([]);
});
test("hover pauses stay; native sponsor fades and route changes remount once",async({page})=>{
 await setupNativeLayout(page,{sponsor:{shrinkDuration:300,stayDuration:2500,fadeDuration:500}});await page.goto(origin);await centered(page);
 await expect(page.locator("#bmWrap .bottom-marquee")).toHaveCSS("height","42px");
 await page.waitForTimeout(500);await centered(page);
 await page.locator("#bmWrap").hover();await page.waitForTimeout(3000);await expect(page.locator("#bmWrap")).not.toHaveClass(/bm-pc-hidden/);
 await page.mouse.move(0,0);await expect(page.locator("#bmWrap")).toHaveClass(/bm-pc-hidden/);await expect(page.locator("#bmWrap")).toHaveCSS("display","none");
 await page.getByText("Anchor QA 0",{exact:true}).click();await expect(page.locator(".server-detail-overview")).toBeVisible();await expect(page.locator("#bmWrap")).toHaveCount(0);
 await page.goBack({waitUntil:"commit"});await centered(page);await expect(page.locator("#bmWrap")).toHaveCount(1);
});
for(const width of [320,390,454,640])test("mobile sponsor remains attached to footer through rapid flings "+width,async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.setViewportSize({width,height:844});await setupNativeLayout(page);await page.goto(origin);
 const wrap=page.locator("#bmWrap");await expect(page.locator("[data-footer-region] #bmWrap")).toHaveCount(1);await expect(wrap).toHaveCSS("position","relative");
 await expect(page.locator(".nz-brand-footer svg.nz-footer-icon")).toHaveCount(1);
 const measure=()=>page.evaluate(()=>{
  const a=document.querySelector(".nz-footer-region > footer")!.getBoundingClientRect(),el=document.querySelector("#bmWrap")!,b=el.getBoundingClientRect(),shift=new DOMMatrix(getComputedStyle(el).transform).m42;return {gap:b.top-shift-a.bottom,bottom:b.bottom};
 });
 for(let i=0;i<6;i++){
  await page.evaluate(()=>scrollTo(0,0));await expect(wrap).not.toBeInViewport();expect((await measure()).gap).toBeGreaterThanOrEqual(0);expect((await measure()).gap).toBeLessThanOrEqual(12);
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await expect(wrap).toBeInViewport();
 }
 await page.evaluate(()=>{const el=document.createElement("div");el.id="late-test-row";el.style.height="300px";document.querySelector("[data-footer-region]")!.before(el)});
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await expect(wrap).toBeInViewport();
 await page.setViewportSize({width,height:780});await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await expect(wrap).toBeInViewport();
 expect((await measure()).gap).toBeLessThanOrEqual(12);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath("native-footer-"+width+".png")});expect(errors).toEqual([]);
});