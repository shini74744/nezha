
import {test,expect,Page} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
async function setup(page:Page,theme:string,timing:Record<string,number>={}){
 const origin=theme==="doraemon"?"https://127.0.0.1:18478":"https://127.0.0.1:18477";
 const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:d.key==="sponsor"}]))};
 Object.assign(config.features.sponsor,{shrinkDuration:2000,stayDuration:60000,fadeDuration:120,...timing,sponsors:[0,1,2].map(i=>({name:"Sponsor "+i,url:"https://example.com",logo:origin+"/motion-logo.svg"}))});
 await page.addInitScript(()=>{localStorage.setItem("statisticsView","closed");localStorage.setItem("showMap","0");});
 const now=Date.now();
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:1,servers:[createServer({id:1,name:"Motion fixture",last_active:new Date(now).toISOString()})]})));
 await page.route("**/*",r=>{
  const u=new URL(r.request().url());let data:any;
  if(u.pathname==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"Motion fixture",custom_code:"",appearance_config:JSON.stringify(config)}};
  else if(u.pathname==="/api/v1/profile")return r.fulfill({json:{success:false}});
  else if(u.pathname==="/api/v1/server-group")data=["1111","2222","33333"].map((name,i)=>({group:{id:i+1,name},servers:[1]}));
  else if(u.pathname.startsWith("/api/"))data=[];
  else if(u.pathname==="/motion-logo.svg")return r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="48"><rect width="180" height="48" fill="#285"/><text x="10" y="32" fill="white" font-size="24">SPONSOR</text></svg>'});
  if(data!==undefined)return r.fulfill({json:{success:true,data}});
  if(u.origin!==origin)return r.abort();return r.continue();
 });
 await page.goto(origin,{waitUntil:"domcontentloaded"});
 await expect(page.locator("[data-group-switch] button")).toHaveCount(4);
 await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLImageElement>("#bmWrap img")).every(i=>i.complete&&i.naturalWidth>0));
 return page.locator("#bmWrap");
}
for(const theme of ["default","doraemon"])for(const width of [1024,1320,1920])test("sponsor motion and theme isolation "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const node=await setup(page,theme);
 // Doraemon intentionally ignores Official appearance settings.
 if(theme==="doraemon"){await expect(node).toHaveCount(0);await expect(page.locator(".nz-sponsor-fit")).toHaveCount(0);expect(errors).toEqual([]);return;}
 await expect(node).toBeVisible();
 const frames=await node.evaluate(n=>new Promise<any[]>(resolve=>{
  const rows:any[]=[],start=performance.now(),item=n.querySelector(".bm-item")!,logo=n.querySelector(".bm-logo")!,inner=n.querySelector(".bottom-marquee")!;
  const slot=n.closest("[data-native-sponsor-slot]")!,bar=slot.parentElement!,left=bar.querySelector(":scope > section")!,right=bar.lastElementChild!;
  const sample=()=>{
   const box=n.getBoundingClientRect(),s=slot.getBoundingClientRect(),l=left.getBoundingClientRect(),r=right.getBoundingClientRect();
   rows.push({t:performance.now()-start,w:box.width,x:box.x,right:box.right,center:box.x+box.width/2,slotCenter:s.x+s.width/2,leftRight:l.right,rightLeft:r.x,font:getComputedStyle(item).fontSize,line:getComputedStyle(item).lineHeight,logo:getComputedStyle(logo).height,inner:getComputedStyle(inner).height});
   if(performance.now()-start<2400)requestAnimationFrame(sample);else resolve(rows);
  };requestAnimationFrame(sample);
 }));
 await info.attach("motion-frames",{body:JSON.stringify(frames),contentType:"application/json"});
 expect(frames.length).toBeGreaterThan(20);
 expect(new Set(frames.map(s=>s.font))).toEqual(new Set(["14px"]));
 expect(new Set(frames.map(s=>s.line))).toEqual(new Set(["42px"]));
 expect(new Set(frames.map(s=>s.logo))).toEqual(new Set(["28px"]));
 expect(new Set(frames.map(s=>s.inner))).toEqual(new Set(["42px"]));
 expect(frames.filter((s,i)=>i>0&&s.w>frames[i-1].w+.3),"no backwards size steps").toEqual([]);
 const early=frames.find(s=>s.t>=400)!;
 expect(early.w,"must visibly shrink during the first 400 ms").toBeLessThan(frames[0].w-1);
 expect(frames.at(-1)!.w).toBeLessThan(frames[0].w*.98);
 expect(frames.filter(s=>s.x<s.leftRight-1||s.right>s.rightLeft+1)).toEqual([]);
 expect(frames.every(s=>Math.abs(s.center-s.slotCenter)<1)).toBe(true);
 await page.locator(".server-overview-controls").screenshot({path:info.outputPath("compact-motion.png")});
 expect(errors).toEqual([]);
});
test("sponsor stay pauses on hover and still fades",async({page})=>{
 await page.setViewportSize({width:1320,height:900});
 const node=await setup(page,"default",{shrinkDuration:300,stayDuration:500,fadeDuration:120});
 await node.hover();
 await page.waitForTimeout(1000);
 await expect(node).toBeVisible();await expect(node).toHaveCSS("opacity","1");
 await page.mouse.move(0,0);
 await expect(node).not.toBeVisible({timeout:2500});
});
test("reduced motion immediately uses the compact pose",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.setViewportSize({width:1320,height:900});
 const node=await setup(page,"default");
 await expect(node).toHaveClass(/bm-compact/);
 await expect(node).toHaveCSS("animation-name","none");
 const before=await node.boundingBox();await page.waitForTimeout(400);
 const after=await node.boundingBox();
 expect(Math.abs(before!.width-after!.width)).toBeLessThan(.3);
});
