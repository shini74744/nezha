import {test,expect} from "@playwright/test";
async function safe(page:any){
 return page.evaluate(()=>{
  const n=document.querySelector(".footer-background") as HTMLElement;
  if(!n)return false;if(getComputedStyle(n).display==="none")return true;
  const b=n.getBoundingClientRect();
  if(b.left<0||b.right>document.documentElement.clientWidth+1)return false;
  return [...document.querySelectorAll(".header-top > section")].every(el=>{
   const a=el.getBoundingClientRect();
   return !a.width||!a.height||b.bottom<=a.top||b.top>=a.bottom||b.right<=a.left-7||b.left>=a.right+7;
  });
 });
}
test("counter scales in free space and never covers header contents",async({page,baseURL})=>{
 test.skip(process.env.E2E_REAL_BACKEND!=="1","Requires isolated backend");
 expect(baseURL).toBe("http://127.0.0.1:18476");test.setTimeout(60000);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("https://counter.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60" fill="#35786a"/><text x="18" y="40" fill="white" font-size="30">0012345</text></svg>'}));
 await page.goto("/");const image=page.locator(".footer-background");
 await expect(image).toHaveCount(1);const measurements:any[]=[];
 for(const width of [768,820,1024,1366,1920,2560,3840,390,320,767]){
  await page.setViewportSize({width,height:900});
  await expect.poll(()=>safe(page)).toBe(true);
  if(width>=1920){
   await expect.poll(async()=>Math.abs((await image.boundingBox())!.width-240*width/1366)<1).toBe(true);
   const b=(await image.boundingBox())!;expect(b.x+b.width).toBeCloseTo(width);expect(b.y).toBe(0);
  }
  if(width<768){await expect(image).toHaveCSS("top","8px");expect(parseFloat(await image.evaluate(e=>getComputedStyle(e).width))).toBeLessThanOrEqual(170)}
  measurements.push({width,display:await image.evaluate(e=>getComputedStyle(e).display),box:await image.boundingBox()});
  if([390,1366,1920].includes(width))await page.screenshot({path:"test-results/counter-safe-"+width+".png"});
 }
 await page.setViewportSize({width:1920,height:900});
 await page.locator(".header-handles").evaluate(el=>{(el as HTMLElement).style.width="900px"});
 await expect.poll(()=>safe(page)).toBe(true);
 await page.locator(".header-top > section").first().evaluate(el=>{el.append(document.createTextNode(" 加长的标题和翻译内容 ".repeat(8)))});
 await expect.poll(()=>safe(page)).toBe(true);
 await page.setViewportSize({width:390,height:900});await expect.poll(()=>safe(page)).toBe(true);
 await page.evaluate(()=>document.body.style.minHeight="2500px");
 await page.evaluate(()=>window.scrollTo(0,100));await expect(image).toHaveCSS("display","none");
 await page.reload();await page.setViewportSize({width:3840,height:900});await page.evaluate(()=>window.scrollTo(0,0));
 await expect.poll(()=>safe(page)).toBe(true);
 expect(errors).toEqual([]);console.log(JSON.stringify(measurements));
});

test("mobile counter fits the gap between brand and online badge",async({page,baseURL})=>{
 expect(baseURL).toBe("http://127.0.0.1:18476");
 await page.route("**/api/v1/setting",async route=>{
  const response=await route.fetch(),body=await response.json();
  body.data.config.site_name="哪吒云监控";
  const c=JSON.parse(body.data.config.appearance_config);
  c.features.hideControls={enabled:true,search:true,language:true,theme:true};
  body.data.config.appearance_config=JSON.stringify(c);
  await route.fulfill({json:body});
 });
 await page.route("https://counter.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60" fill="#35786a"/></svg>'}));
 await page.setViewportSize({width:390,height:844});await page.goto("/");
 const image=page.locator(".footer-background");
 await expect(image).toBeVisible();await expect.poll(()=>safe(page)).toBe(true);
 await page.screenshot({path:"test-results/counter-mobile-gap.png"});
 await page.setViewportSize({width:844,height:390});await expect.poll(()=>safe(page)).toBe(true);
 await page.setViewportSize({width:390,height:844});await expect(image).toBeVisible();await expect.poll(()=>safe(page)).toBe(true);
});