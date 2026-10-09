import {test,expect} from "@playwright/test";
import {setupNativeLayout,origin} from "./native-layout-fixture";
test.use({ignoreHTTPSErrors:true});
for(const width of [320,390,768,1366,1920])for(const theme of ["light","dark"])test("native layout and effects "+width+" "+theme,async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.setViewportSize({width,height:900});
 await page.addInitScript(t=>localStorage.setItem("vite-ui-theme",t),theme);
 await setupNativeLayout(page,{
  sponsor:{shrinkDuration:0},counter:{imageUrl:origin+"/sponsor-fixture.svg"},quote:{dayUrls:[origin+"/quote"],nightUrl:origin+"/quote"},font:{selection:7},
  visitorIP:{ipApiUrls:[origin+"/visitor"],checkNodes:[{name:"Test",url:origin+"/probe"}],fallbackUrl:""},
  snow:{interval:100,count:4,mobileCount:2}
 },["sponsor","footer","quote","counter","visitorIP","clock","snow","heart","fragments","stars","font"]);
 await page.goto(origin);await expect(page.locator(".header-top [data-native-counter]")).toHaveCount(1);
 expect((await page.locator(".header-top").boundingBox())!.y).toBe(width>=768?32:16);
 if(width>640){await expect(page.locator("#message")).toHaveCSS("position","absolute");expect((await page.locator("#message").boundingBox())!.y).toBe(0);}
 if(width>=768){
  const counter=page.locator("[data-native-counter]");await expect(counter).toHaveCSS("position","fixed");
  const box=await counter.boundingBox();expect(box!.y).toBe(0);expect(Math.abs(box!.x+box!.width-await page.evaluate(()=>document.documentElement.clientWidth))).toBeLessThanOrEqual(1);
 }else await expect(page.locator("[data-native-counter]")).toHaveCSS("position","fixed");
 await expect(page.locator("#bmWrap .bottom-marquee")).toHaveCSS("background-image","none");
 await expect(page.locator("#bmWrap .bottom-marquee")).toHaveCSS("background-color","rgba(0, 0, 0, 0)");
 await expect(page.locator("[data-native-clock]")).toHaveCount(3);
 await expect(page.locator("#ip-base")).toContainText("203.0.113.9");
 if(width<=640){await expect(page.locator("#message,#ip-net")).toHaveCount(0);await expect(page.locator("#bmWrap")).not.toBeInViewport()}
 else await expect(page.locator("#message")).toHaveText("Native quote fixture");
 await expect(page.locator(".snowflake")).toHaveCount(width<=768?2:4);
 expect(await page.evaluate(()=>{
  const image=document.querySelector(".footer-background")!.getBoundingClientRect();
  return [...document.querySelectorAll(".header-top > section")].every(el=>{const b=el.getBoundingClientRect();return !image.width||image.right<=b.left||image.left>=b.right||image.bottom<=b.top||image.top>=b.bottom});
 })).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.mouse.click(12,200);await expect(page.locator(".heart")).toHaveCount(1);
 expect(await page.locator(".heart").evaluate(e=>getComputedStyle(e).pointerEvents)).toBe("none");
 await page.screenshot({path:info.outputPath("native-layout.png")});
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
 await expect(page.locator("#ip-bar")).toHaveClass(/ip-hidden/);
 if(width<=640)await expect(page.locator("#bmWrap")).toBeInViewport();
 await page.evaluate(()=>scrollTo(0,0));await expect(page.locator("#ip-bar")).not.toHaveClass(/ip-hidden/);
 expect(errors).toEqual([]);
});

for(const width of [320,1440])for(const offset of [-1000,2000])test("counter extreme padding cannot displace header "+width+" "+offset,async({page})=>{
 await page.setViewportSize({width,height:900});
 await setupNativeLayout(page,{counter:{imageUrl:origin+"/sponsor-fixture.svg",desktopRight:offset,mobileOffset:Math.min(1000,offset)}},["counter"]);
 await page.goto(origin);await expect(page.locator("[data-native-counter]")).toHaveCount(1);
 await expect(page.locator(".header-handles")).toBeVisible();
 expect(await page.evaluate(()=>{
  const handles=document.querySelector(".header-handles")!.getBoundingClientRect();
  const logo=document.querySelector(".header-logo")!.getBoundingClientRect();
  return document.documentElement.scrollWidth<=innerWidth+1&&handles.right<=innerWidth&&logo.left>=0&&logo.right<=handles.left;
 })).toBe(true);
});
