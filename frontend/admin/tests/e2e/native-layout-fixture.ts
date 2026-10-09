import {Page} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
export const origin="https://127.0.0.1:18477";
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
export async function setupNativeLayout(page:Page, options:Record<string,any>={}, keys=["sponsor","footer"]) {
 const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:keys.includes(d.key)}]))};
 Object.assign(config.features.sponsor,{shrinkDuration:800,stayDuration:60000,fadeDuration:500},{desktopTop:"9999px",sponsors:[{name:"Test sponsor",url:"https://example.com",logo:origin+"/sponsor-fixture.svg"}]});
 for(const [key,value]of Object.entries(options))Object.assign(config.features[key],value);
 await page.addInitScript(()=>{localStorage.setItem("inline","0");localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")});
 const now=Date.now(),servers=Array.from({length:24},(_,i)=>createServer({id:i+1,name:"Anchor QA "+i,last_active:new Date(now).toISOString()}));
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:24,servers})));
 await page.route("**/*",r=>{
  const u=new URL(r.request().url());
  if(u.pathname==="/api/v1/setting")return r.fulfill({json:{success:true,data:{config:{language:"zh-CN",site_name:"Sponsor anchor test",custom_code:"",appearance_config:JSON.stringify(config)}}}});
  if(u.pathname==="/api/v1/server-group")return r.fulfill({json:{success:true,data:[]}});
  if(u.pathname==="/api/v1/profile")return r.fulfill({json:{success:false}});
  if(u.pathname.includes("/service"))return r.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{}}}});
  if(u.pathname==="/quote")return r.fulfill({body:"Native quote fixture"});
  if(u.pathname==="/visitor")return r.fulfill({json:{ip:"203.0.113.9",country:"Japan",city:"Tokyo",org:"AS64500 Example"}});
  if(u.pathname==="/probe")return r.fulfill({status:204});
  if(u.pathname==="/sponsor-fixture.svg")return r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="48"><rect width="280" height="48" fill="#286"/><text x="10" y="32" fill="white" font-size="24">SPONSOR</text></svg>'});
  if(u.origin!==origin)return r.abort();return r.continue();
 });
}
