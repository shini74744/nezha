import { test, expect } from "@playwright/test";
import { createServer } from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
for(const theme of ["default","doraemon"])for(const width of [390,1440])test("return list keeps 120 card nodes and scroll "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const origin="https://127.0.0.1:"+(theme==="default"?"18477":"18478"), now=Date.now();
 const servers=Array.from({length:120},(_,i)=>createServer({id:i+1,name:"导航测试 "+(i+1),last_active:new Date(now).toISOString()}));
 let delayed=false,blockedReads=0;
 await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");sessionStorage.clear();localStorage.setItem("doraemon-sky","light")});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,servers,online:120})));
 await page.route("**/*",async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  if(!url.pathname.startsWith("/api/"))return route.continue();
  if(delayed && ["/api/v1/service","/api/v1/server-group"].includes(url.pathname)){blockedReads++;await new Promise(r=>setTimeout(r,5000));}
  let data:any=[];
  if(url.pathname==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"导航测试",custom_code:"",statistics_split:true}};
  if(url.pathname==="/api/v1/profile")return route.fulfill({status:401,json:{success:false}});
  if(url.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  if(url.pathname.endsWith("/metrics"))data={data_points:[]};
  if(url.pathname.endsWith("/last-report"))data=null;
  return route.fulfill({json:{success:true,data}});
 });
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(origin+"/");
 const cards=page.locator(theme==="default"?"[data-server-card]":"[data-dora-card]");
 await expect(cards).toHaveCount(120);
 if(theme==="doraemon")await expect(page.getByText("导航测试",{exact:true}).first()).toBeVisible();
 await page.waitForTimeout(700);
 await cards.nth(35).scrollIntoViewIfNeeded();
 await page.evaluate(()=>{(window as any).__savedList=document.querySelector(".server-card-list");(window as any).__savedCard=document.querySelector(".server-card-list")?.children[35];});
 const top=await page.evaluate(()=>window.scrollY);
 if(theme==="default")await cards.nth(35).click();else await cards.nth(35).getByRole("link",{name:"查看服务器 导航测试 36",exact:true}).click();
 await expect(page.locator(".server-info")).toBeVisible();
 await expect(cards.nth(35)).toBeHidden();
 delayed=true;
 const cdp=await page.context().newCDPSession(page);await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
 // An in-page back action lets the browser measure the first visible paint,
 // without including Playwright polling latency in the timing.
 await page.evaluate(()=>{
  (window as any).__returnStart=performance.now();
  const tick=()=>{
   if((window as any).__savedCard?.getBoundingClientRect().height>0)requestAnimationFrame(()=>{(window as any).__returnMs=performance.now()-(window as any).__returnStart});
   else requestAnimationFrame(tick);
  };requestAnimationFrame(tick);
  history.back();
 });
 await expect(cards.nth(35)).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).__returnMs)).toBeGreaterThan(0);
 const result=await page.evaluate(()=>({ms:(window as any).__returnMs,sameList:(window as any).__savedList===document.querySelector(".server-card-list"),sameCard:(window as any).__savedCard===document.querySelector(".server-card-list")?.children[35],top:scrollY}));
 expect(result.sameList).toBe(true);expect(result.sameCard).toBe(true);
 expect(Math.abs(result.top-top)).toBeLessThan(4);
 await info.attach("return-performance",{body:JSON.stringify({...result,width,theme,blockedReads}),contentType:"application/json"});
 console.log("RETURN_PERFORMANCE",JSON.stringify({...result,width,theme}));
 // Dev builds include React diagnostics; all runs must still beat the 5s blocked API.
 expect(result.ms).toBeLessThan(Number(process.env.NAVIGATION_MAX_MS || 4000));
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:1});
 await page.screenshot({path:info.outputPath("returned-list.png")});
 // A second trip must restore the new position, not the previous position.
 delayed=false;await cards.nth(75).scrollIntoViewIfNeeded();
 // Physical clicks can scroll the target into view; preserve the position at navigation, not before Playwright's actionability scroll.
 await page.evaluate(()=>document.addEventListener("click",()=>{(window as any).__secondNavigationTop=scrollY},{capture:true,once:true}));
 if(theme==="default")await cards.nth(75).click();else await cards.nth(75).getByRole("link",{name:"查看服务器 导航测试 76",exact:true}).click();
 const secondTop=await page.evaluate(()=>(window as any).__secondNavigationTop as number);
 expect(secondTop).toBeGreaterThan(top+100);
 await expect(page.locator(".server-info")).toBeVisible();
 await page.locator(".server-info .server-name").click();
 await expect(cards.nth(75)).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(secondTop,0);
 expect(errors).toEqual([]);
});
