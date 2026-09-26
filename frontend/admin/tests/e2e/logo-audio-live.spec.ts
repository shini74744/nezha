import {test,expect} from "@playwright/test";
import fs from "node:fs";
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
for(const width of [390,1920])test("logo sound toggle at width "+width,async({page,baseURL})=>{
 expect(baseURL).toBe("http://127.0.0.1:18476");
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:["background","video"].includes(d.key)}]))};
 Object.assign(config.features.background,{regionEnabled:false,scheduleEnabled:false,desktopMedia:[{type:"video",src:baseURL+"/fixture.mp4"}],mobileMedia:[]});
 await page.addInitScript(()=>{
  HTMLMediaElement.prototype.play=function(){return Promise.resolve()};
  document.addEventListener("error",e=>{if(e.target instanceof HTMLVideoElement)e.stopImmediatePropagation()},true);
 });
 await page.route("**/fixture.mp4",r=>r.fulfill({contentType:"video/mp4",body:Buffer.from([0])}));
 await page.route("**/api/v1/setting",r=>r.fulfill({json:{success:true,data:{config:{language:"zh-CN",site_name:"声音测试",custom_code:"",appearance_config:JSON.stringify(config)}}}}));
 await page.setViewportSize({width,height:900});await page.goto("/");
 const logo=page.locator(".header-logo");await expect(logo).toHaveAttribute("aria-label","开启背景声音");
 await expect(page.locator(".nz-background-sound")).toHaveCount(0);
 await logo.click();await expect(logo).toHaveAttribute("aria-label","关闭背景声音");
 expect(await page.locator("video").evaluate((v:HTMLVideoElement)=>v.muted)).toBe(false);
 await logo.click();await expect(logo).toHaveAttribute("aria-label","开启背景声音");
 expect(await page.locator("video").evaluate((v:HTMLVideoElement)=>v.muted)).toBe(true);
 expect(page.url()).toBe(baseURL+"/");expect(errors).toEqual([]);
 await page.screenshot({path:"test-results/logo-audio-"+width+".png"});
});