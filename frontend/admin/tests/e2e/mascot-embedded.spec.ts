import {test,expect} from "@playwright/test";
import fs from "node:fs";
const manifest=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
test("bundled Sakana JS CSS and embedded images load without CDN",async({page,baseURL})=>{
 expect(baseURL).toBe("http://127.0.0.1:18476");const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const config={version:1,enabled:true,features:Object.fromEntries(manifest.map((d:any)=>[d.key,{...d.defaults,enabled:d.key==="live2d"}]))};config.features.live2d.provider="sakana";
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now:Date.now(),online:0,servers:[]})));
 await page.route("**/*",r=>{
 const u=new URL(r.request().url());if(u.origin!==baseURL)return r.abort();
 if(u.pathname==="/api/v1/setting")return r.fulfill({json:{success:true,data:{config:{language:"zh-CN",custom_code:"",appearance_config:JSON.stringify(config)}}}});
 if(u.pathname.startsWith("/api/"))return r.fulfill({json:{success:true,data:[]}});
 return r.continue();
 });
 await page.goto("/");await expect(page.locator("#nz-sakana-widget .sakana-widget-img")).toBeVisible();
 expect(await page.locator(".sakana-widget-img").evaluate((el:HTMLElement)=>getComputedStyle(el).backgroundImage.startsWith('url("data:image/'))).toBe(true);
 await expect(page.locator(".sakana-widget-app")).toHaveCSS("position","relative");
 expect(errors).toEqual([]);
});
