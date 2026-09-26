import {test,expect} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
const manifest=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
for(const mobile of [false,true])test("visitor runtime honors endpoints and visibility "+mobile,async({page,baseURL})=>{
 expect(baseURL).toBe("http://127.0.0.1:18476");
 await page.setViewportSize({width:mobile?390:1366,height:900});
 if(mobile)await page.addInitScript(()=>Object.defineProperty(navigator,"userAgent",{get:()=>"iPhone"}));
 const config={version:1,enabled:true,features:Object.fromEntries(manifest.map((d:any)=>[d.key,{...d.defaults,enabled:d.key==="visitorIP"}]))};
 const f=config.features.visitorIP;Object.assign(f,{ipApiUrls:["https://custom-ip.test/json"],fallbackUrl:"https://fill-ip.test/json",queryTimeout:700,fallbackTimeout:600,checkTimeout:500,switchTimeout:400,checkNodes:[{name:"Custom A",url:"https://node-a.test/ping"},{name:"Custom B",url:"https://node-b.test/ping"},{name:"Custom C",url:"https://node-c.test/ping"}]});
 const requests:string[]=[],errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now:Date.now(),online:40,servers:Array.from({length:40},(_,i)=>createServer({id:i+1,name:"QA "+i,last_active:new Date().toISOString()}))})));
 await page.route("**/*",r=>{
  const u=new URL(r.request().url());
  if(u.hostname.endsWith(".test")){requests.push(u.hostname);if(u.hostname==="custom-ip.test")return r.fulfill({json:{ip:"203.0.113.9",country:"Japan",city:"Tokyo"}});if(u.hostname==="fill-ip.test")return r.fulfill({json:{ip:"203.0.113.9",asn:"AS64500",org:"AS64500 Example Net"}});return r.fulfill({status:204})}
  if(u.pathname==="/api/v1/setting")return r.fulfill({json:{success:true,data:{config:{language:"zh-CN",custom_code:"",appearance_config:JSON.stringify(config)}}}});
  if(u.pathname==="/api/v1/profile")return r.fulfill({json:{success:true,data:{id:1,role:0,username:"QA"}}});
  if(u.pathname==="/api/v1/server-group")return r.fulfill({json:{success:true,data:[]}});
  if(u.pathname.includes("/service"))return r.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{}}}});
  if(u.origin!==baseURL)return r.abort();return r.continue();
 });
 await page.goto("/");await expect(page.locator("#ip-base")).toContainText("Japan · Tokyo");
 if(mobile){expect(requests).toEqual(["custom-ip.test"]);await expect(page.locator("#ip-net")).toBeEmpty();await expect(page.locator("#ip-base")).not.toContainText("AS64500")}
 else{
  await expect(page.locator("#ip-base")).toContainText("AS64500 Example Net");await expect(page.locator("#ip-net")).toContainText("Custom");
  const initial=(await page.locator("#ip-net").textContent())!;const names=["Custom A","Custom B","Custom C"];let index=names.findIndex(n=>initial.includes(n));
  for(let i=0;i<3;i++){await page.waitForTimeout(250);await page.locator("#ip-net").click();index=(index+1)%3;await expect(page.locator("#ip-net")).toContainText(names[index]);}
 }
 Object.assign(f,{showRegion:false,showASN:false,showOrganization:false,showDownlink:false,networkEnabled:false});requests.length=0;
 await page.reload();await expect(page.locator("#ip-base")).toHaveText("203.0.113.9");await expect(page.locator("#ip-net")).toBeEmpty();
 await page.waitForTimeout(200);expect(requests).toEqual(["custom-ip.test"]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
