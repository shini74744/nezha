import {test,expect,Page} from "@playwright/test";
import {setupNativeLayout,origin} from "./native-layout-fixture";
test.use({ignoreHTTPSErrors:true});
const legacy=process.env.LEGACY_UI_ORIGIN;
const selectors={header:".header-top",brand:".header-logo",handles:".header-handles",overview:".server-overview-controls",quote:"#message",counter:"[data-native-counter],body > .footer-background",side:"#illustration",network:"#canvas-nest"};
async function measure(page:Page){
 return page.evaluate((selectors)=>{
  const values:Record<string,any>={};
  for(const [key,selector]of Object.entries(selectors)){
   const e=document.querySelector(selector);if(!e||!e.getClientRects().length){values[key]=null;continue}
   const r=e.getBoundingClientRect(),s=getComputedStyle(e);
   values[key]={x:r.x,y:r.y,width:r.width,height:r.height,position:s.position,fontSize:s.fontSize};
  }
  return values;
 },selectors);
}
for(const width of [320,390,768,1366,1920])for(const theme of ["light","dark"])test("legacy appearance geometry parity "+width+" "+theme,async({browser},info)=>{
 test.skip(!legacy,"Set LEGACY_UI_ORIGIN to the isolated pre-component build");
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900},isMobile:width<=640,hasTouch:width<=640,...(width<=640?{userAgent:"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36"}:{})});
 const pages=[],errors:string[]=[];
 for(const old of [true,false]){
  const page=await context.newPage();pages.push(page);
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem("vite-ui-theme",t),theme);
  await setupNativeLayout(page,{
   sponsor:{shrinkDuration:0},counter:{imageUrl:origin+"/sponsor-fixture.svg"},sideImage:{imageUrl:origin+"/sponsor-fixture.svg"},
   quote:{dayUrls:[origin+"/quote"],nightUrl:origin+"/quote"},font:{selection:7},
   network:{count:10},snow:{interval:100,count:4,mobileCount:2}
  },["sponsor","footer","quote","counter","sideImage","clock","snow","network","font"]);
  if(old)await page.route("**/*",async route=>{
   const u=new URL(route.request().url());
   if(u.origin===origin&&!u.pathname.startsWith("/api/")&&!["/quote","/sponsor-fixture.svg"].includes(u.pathname))
    return route.fulfill({response:await route.fetch({url:legacy+u.pathname+u.search})});
   return route.fallback();
  });
  await page.goto(origin);
  await expect(page.locator(".server-overview-controls")).toBeVisible();
  await expect(page.locator("#canvas-nest")).toHaveCount(width<=640?0:1);
  await expect(page.locator(selectors.counter)).toHaveCount(1);
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(800);
  await page.screenshot({path:info.outputPath(old?"legacy-top.png":"native-top.png")});
 }
 const [old,current]=await Promise.all(pages.map(measure));
 await info.attach("geometry",{body:JSON.stringify({old,current},null,2),contentType:"application/json"});
 for(const key of Object.keys(selectors)){
  expect(!!current[key],key+" visibility").toBe(!!old[key]);
  if(!old[key])continue;
  for(const axis of ["x","y","width","height"])expect(Math.abs(current[key][axis]-old[key][axis]),key+" "+axis).toBeLessThanOrEqual(key==="overview"?2:1);
  if(key!=="overview")expect(current[key].position,key+" positioning").toBe(old[key].position);
 }
 for(const page of pages){await page.evaluate(()=>scrollTo(0,300));await page.waitForTimeout(650);}
 const states=await Promise.all(pages.map(page=>page.locator(selectors.counter).evaluate(e=>({display:getComputedStyle(e).display,opacity:getComputedStyle(e).opacity,transform:getComputedStyle(e).transform}))));
 expect(states[1].display==="none").toBe(states[0].display==="none");expect(states[1].opacity).toBe(states[0].opacity);expect(states[1].transform).toBe(states[0].transform);
 if(width<=640){
  for(const page of pages){await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(700)}
  const footer=await Promise.all(pages.map(p=>p.evaluate(()=>{const b=document.querySelector("#bmWrap")!.getBoundingClientRect(),f=document.querySelector("[data-footer-region] > footer")!.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,gap:b.y-f.bottom,bottom:b.bottom,viewport:innerHeight}})));
  await info.attach("footer",{body:JSON.stringify(footer),contentType:"application/json"});
  for(const key of ["x","y","width","height","gap","bottom"] as const)expect(Math.abs(footer[1][key]-footer[0][key]),"footer "+key).toBeLessThanOrEqual(1);
 } else {
  const capsules=await Promise.all(pages.map(p=>p.evaluate(()=>{const e=document.querySelector("#bmWrap")!,r=e.getBoundingClientRect(),s=getComputedStyle(e.querySelector(".bottom-marquee")!);return{x:r.x,y:r.y,width:r.width,height:r.height,bg:s.backgroundColor,shadow:s.boxShadow}})));
  await info.attach("sponsor",{body:JSON.stringify(capsules),contentType:"application/json"});
  for(const key of ["x","y","width","height"] as const)expect(Math.abs(capsules[1][key]-capsules[0][key]),"sponsor "+key).toBeLessThanOrEqual(1);
  expect(capsules[1].bg).toBe(capsules[0].bg);expect(capsules[1].shadow).toBe(capsules[0].shadow);
 }
 expect(errors).toEqual([]);
 await context.close();
});
