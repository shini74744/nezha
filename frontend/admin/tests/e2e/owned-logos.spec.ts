import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
const origin=process.env.E2E_BASE_URL!;test.use({ignoreHTTPSErrors:true});
for(const width of [390,1366])for(const inline of ["0","1"])test("owned logos "+width+" inline="+inline,async({page})=>{
 const external:string[]=[];page.on("request",r=>{if(r.resourceType()==="image"&&r.url().startsWith("http")&&new URL(r.url()).origin!==origin)external.push(r.url())});
 const small=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=12;c.height=16;const x=c.getContext("2d")!;x.fillStyle="green";x.fillRect(0,0,12,16);return c.toDataURL().split(",")[1]});
 const png="/api/v1/logo/assets/"+"a".repeat(64)+".png",svg="/api/v1/logo/assets/"+"b".repeat(64)+".svg";
 const now=Date.now();const servers=[png,svg].map((logo,i)=>createServer({id:11+i,name:i?"矢量厂商":"小图厂商",last_active:new Date(now).toISOString(),public_note:JSON.stringify({planDataMod:{providerLogo:{logo},networkRouteEntries:[{carrier:"custom",text:"站内线路",logo}]}})}));
 await page.setViewportSize({width,height:800});await page.addInitScript(inline=>{localStorage.setItem("inline",inline);localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")},inline);
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:2,servers})));
 await page.route("**/*",async r=>{
 const u=new URL(r.request().url());if(u.pathname===png)return r.fulfill({contentType:"image/png",body:Buffer.from(small,"base64")});
 if(u.pathname===svg)return r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 131 177"><path d="M15 10h100v157H15Z" fill="#1ed760"/></svg>'});
 if(u.pathname==="/api/v1/setting")return r.fulfill({json:{success:true,data:{config:{language:"zh-CN",site_name:"Logo校验",custom_code:""}}}});
 if(u.pathname==="/api/v1/server-group")return r.fulfill({json:{success:true,data:[]}});
 if(u.pathname==="/api/v1/profile")return r.fulfill({json:{success:false}});
 if(u.pathname==="/api/v1/server-traffic")return r.fulfill({json:{success:true,data:{}}});
 if(u.pathname.includes("/service"))return r.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{}}}});
 if(u.origin!==origin)return r.abort();return r.continue();
 });await page.goto("/");const logos=page.locator("[data-provider-logo]");await expect(logos).toHaveCount(2);
 for(const img of await logos.all()){await expect.poll(()=>img.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);const r=await img.boundingBox(),box=await img.locator("..").boundingBox();expect(Math.abs(r!.x+r!.width/2-box!.x-box!.width/2)).toBeLessThan(1);expect(r!.height).toBeLessThanOrEqual(width<1024?48:28)}
 const p=await page.locator('[data-provider-logo][src="'+png+'"]').boundingBox();expect(p!.width).toBe(12);expect(p!.height).toBe(16);expect(external).toEqual([]);
 for(const heading of await page.locator("[data-server-identity]").all()){
  const values=await heading.evaluate(el=>{const name=el.querySelector("[data-server-name]")!.getBoundingClientRect(),flag=el.querySelector("[data-server-flag]")!.getBoundingClientRect(),status=el.querySelector("[data-server-status]")!.getBoundingClientRect(),logo=el.querySelector("[data-provider-logo-box]")!.getBoundingClientRect(),card=el.closest("[data-server-card]")!,cpu=card.querySelector('[data-metric-label="cpu"]')?.getBoundingClientRect(),mem=card.querySelector('[data-metric-label="memory"]');let right=0;if(mem){const range=document.createRange();range.selectNodeContents(mem);right=range.getBoundingClientRect().right}return {name:name.y,flag:flag.y+flag.height/2,status:status.y+status.height/2,left:logo.left,right:logo.right,bottom:logo.bottom,cpuLeft:cpu?.left,cpuTop:cpu?.top,memoryRight:right}});
  expect(Math.abs(values.flag-values.name-8)).toBeLessThan(1);expect(Math.abs(values.status-values.name-8)).toBeLessThan(1);
  if(width<1024&&values.cpuLeft!==undefined){expect(Math.abs(values.left-values.cpuLeft)).toBeLessThan(1);expect(Math.abs(values.right-values.memoryRight)).toBeLessThan(1);expect(values.bottom).toBeLessThan(values.cpuTop!)}
 }

 await page.screenshot({path:"test-results/owned-logos-"+width+"-"+inline+".png",fullPage:true});
});
