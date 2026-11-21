import { test, expect } from "@playwright/test";
const base = process.env.MASCOT_TEST_ORIGIN || "http://127.0.0.1:18485";
async function setup(page: any, options: any = {}) {
 await page.route("https://images.test/plane.svg", (r: any) => r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><path d="M10 80L210 30L180 135L120 100Z" fill="#b6e4f5" stroke="#37216b" stroke-width="6"/></svg>'}));
 await page.goto(base + "/native-test.html");
 await page.waitForFunction(() => !!(window as any).setNativeConfig);
 await page.evaluate((options: any) => (window as any).setNativeConfig(["live2d","network","stars","sakura"], {
  live2d:{provider:"sakana",size:200,controls:true,autoMotion:false,character:"custom-plane",customCharacters:[{id:"custom-plane",name:"飞机",imageUrl:"https://images.test/plane.svg",scale:100}],...options},
  network:{count:99},stars:{interval:40},
 }), options);
 await expect(page.locator(".nz-sakana-artwork")).toBeVisible();
}
async function drag(page: any, dx = 120, dy = -60, release = true) {
 const r = await page.locator(".sakana-widget-img").boundingBox();
 await page.mouse.move(r!.x+r!.width/2,r!.y+r!.height/2);
 await page.mouse.down();
 await page.mouse.move(r!.x+r!.width/2+dx,r!.y+r!.height/2+dy,{steps:12});
 if(release)await page.mouse.up();
}
test("dragging has no per-movement layout reads and release needs no JS paint loop",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await setup(page);
 await page.evaluate(()=>{
  (window as any).__reads=0;
  const old=Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect=function(){if(this.classList.contains("sakana-widget-main"))(window as any).__reads++;return old.call(this)};
 });
 await drag(page);
 const img=page.locator(".sakana-widget-img");
 await expect.poll(()=>img.evaluate(e=>e.getAnimations().length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).__reads)).toBe(0);
 const report=await img.evaluate(async e=>{
  let writes=0;const observer=new MutationObserver(r=>writes+=r.length);observer.observe(e,{attributes:true,attributeFilter:["style"]});
  await new Promise(r=>setTimeout(r,500));observer.disconnect();
  return {writes,animation:e.getAnimations()[0]?.playState,willChange:getComputedStyle(e).willChange};
 });
 expect(report.writes).toBe(0);expect(report.willChange).toBe("transform");
 await expect.poll(()=>img.evaluate(e=>e.getAnimations().length),{timeout:2500}).toBe(0);
 await expect(img).toHaveCSS("transform","matrix(1, 0, 0, 1, 0, 0)");
 expect(errors).toEqual([]);
 console.log("motion-performance",JSON.stringify({layoutReads:0,releaseStyleWrites:report.writes}));
});
test("rapid reversal, recapture, pointer cancellation and blur recover",async({page})=>{
 await setup(page);
 for(let i=0;i<5;i++){await drag(page,i%2?160:100,-40);await page.waitForTimeout(80)}
 await drag(page,150,-80,false);
 await page.evaluate(()=>window.dispatchEvent(new Event("blur")));
 await page.mouse.up();
 await expect(page.locator(".sakana-widget-img")).toHaveCSS("transform","matrix(1, 0, 0, 1, 0, 0)");
 await drag(page,100,-40);
 await expect.poll(()=>page.locator(".sakana-widget-img").evaluate(e=>e.getAnimations().length)).toBe(1);
});
test("role changes, image scales, auto mode and close still work",async({page})=>{
 await setup(page,{autoMotion:true});
 await expect.poll(()=>page.locator(".sakana-widget-img").evaluate(e=>e.getAnimations().length),{timeout:6500}).toBe(1);
 await page.getByTitle("Next Character",{exact:true}).click();
 await expect(page.locator("#nz-sakana-widget")).toHaveAttribute("data-character","chisato");
 await expect(page.locator(".nz-sakana-artwork")).toHaveCount(0);
 await page.getByTitle("Next Character",{exact:true}).click();
 await page.getByTitle("Next Character",{exact:true}).click();
 await expect(page.locator("#nz-sakana-widget")).toHaveAttribute("data-character","custom-plane");
 await expect(page.locator(".nz-sakana-artwork")).toHaveCSS("background-size","contain");
 await drag(page,90,-50);
 await page.getByTitle("Close",{exact:true}).click();
 await expect(page.locator(".sakana-widget-app")).toHaveCount(0);
 await page.evaluate(()=>(window as any).setNativeConfig([]));
 await expect(page.locator("#nz-sakana-widget")).toHaveCount(0);
});
test("reduced motion disables rebound, and phone keeps the existing guard",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});await setup(page,{autoMotion:true});
 await drag(page);
 await expect.poll(()=>page.locator(".sakana-widget-img").evaluate(e=>e.getAnimations().length)).toBe(0);
 await expect(page.locator(".sakana-widget-img")).toHaveCSS("transform","matrix(1, 0, 0, 1, 0, 0)");
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator("#nz-sakana-widget")).toHaveCount(0);
 await page.setViewportSize({width:1440,height:900});
 await expect(page.locator(".nz-sakana-artwork")).toBeVisible();
});
test("touch pointer drag on tablet is captured and released safely",async({browser})=>{
 const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true,isMobile:false});
 const page=await context.newPage();await setup(page);
 const r=(await page.locator(".sakana-widget-img").boundingBox())!;
 const cdp=await context.newCDPSession(page);
 const x=r.x+r.width/2,y=r.y+r.height/2;
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1}]});
 for(let i=1;i<=8;i++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+i*12,y:y-i*4,id:1}]});
 await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
 await expect.poll(()=>page.locator(".sakana-widget-img").evaluate(e=>e.getAnimations().length)).toBe(1);
 await context.close();
});
