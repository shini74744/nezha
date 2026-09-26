import {test,expect,Page} from "@playwright/test";
import fs from "node:fs";
const manifest=JSON.parse(fs.readFileSync(new URL("../../src/lib/dashboard-appearance-manifest.json",import.meta.url),"utf8"));
const provided={version:1,enabled:true,features:Object.fromEntries(manifest.map((d:any)=>[d.key,{...d.defaults}]))};
async function setup(page:Page,enabled=false){
 let state:any={config:structuredClone(provided),custom_code:"",archived_code:"",revision:"first"};state.config.enabled=enabled;
 const updates:any[]=[],errors:string[]=[];let conflict=false;
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{site_name:"哪吒监控",language:"zh-CN",dashboard_appearance_config:JSON.stringify(state.config)},version:"test"};
  if(path==="/api/v1/online-user")data={count:2,value:[{ip:"1.2.3.4:443",user_id:1,connected_at:"2026-09-25T14:06:52.049Z"},{ip:"[2602:fa02:33:103::a]:443",user_id:1,connected_at:"2026-09-25T14:06:52.049Z"}]};
  if(path==="/api/v1/setting/dashboard-appearance"){
   if(route.request().method()==="PATCH"){const body=route.request().postDataJSON();updates.push(body);if(conflict)return route.fulfill({json:{success:false,error:"dashboard appearance changed; reload settings"}});state={...state,config:body.config,revision:"second",archived_code:body.source_code??state.archived_code}}
   data=state;
  }
  await route.fulfill({json:{success:true,data}});
 });
 await page.route("https://cdn.jsdelivr.net/**",r=>r.fulfill({contentType:"text/css",body:""}));
 await page.route("https://images.xxapi.cn/**",r=>r.abort());
 await page.goto("/dashboard/settings/dashboard-appearance");
 await expect(page.getByRole("heading",{name:"后台美化设置",exact:true})).toBeVisible();
 return{updates,errors,conflict:()=>{conflict=true}};
}
test("independent settings save, native branding, disable cleanup and layout",async({page})=>{
 const {updates,errors}=await setup(page);
 await expect(page.locator("h2")).toHaveCount(7);
 const a=await page.getByRole("tab",{name:"美化设置",exact:true}).boundingBox(),b=await page.getByRole("tab",{name:"后台美化设置",exact:true}).boundingBox();
 expect(Math.abs(a!.y-b!.y)).toBeLessThan(3);
 await page.getByRole("switch",{name:"启用后台美化",exact:true}).click();
 await page.getByRole("button",{name:"保存后台美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);
 await expect(page.locator("html")).toHaveAttribute("data-nz-dashboard","true");
 await expect(page.locator("header")).toContainText("哪吒云监控");
 await expect(page.locator('img[src*="animated-man"]')).toHaveCount(0);
 await expect(page.locator("[data-nz-dashboard-font]")).toHaveCount(1);
 await expect(page.locator("footer")).toBeHidden();
 await page.getByRole("heading",{name:"后台美化设置",exact:true}).click();
 await expect(page.locator(".nz-dashboard-word")).toHaveCount(1);
 await expect(page.locator(".nz-dashboard-shatter")).toHaveCount(20);
 await expect(page.locator(".nz-dashboard-word")).toHaveCount(0,{timeout:3000});
 await page.evaluate(()=>window.scrollTo(0,600));
 await expect(page.getByRole("button",{name:"返回顶部",exact:true})).toHaveClass("nz-show");
 await page.getByRole("button",{name:"返回顶部",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
 await page.screenshot({path:"test-results/dashboard-editor.png"});
 await page.getByRole("switch",{name:"启用后台美化",exact:true}).click();
 await page.getByRole("button",{name:"保存后台美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(2);
 await expect(page.locator("html")).not.toHaveAttribute("data-nz-dashboard");
 await expect(page.locator("[data-nz-dashboard-font]")).toHaveCount(0);await expect(page.locator("[data-nz-dashboard-style]")).toHaveCount(0);
 expect(errors).toEqual([]);
});
test("old code static import preserves all provided parameters and archives source",async({page})=>{
 const {updates}=await setup(page);const old:any={};
 for(const [key,f]of Object.entries(provided.features) as any){if(key==="utilities")continue;const {enabled,...rest}=f;old[key]=rest}
 old.externalScripts=["https://cdn.jsdelivr.net/gh/shini74744/xjs@main/26.4.18htping.js","https://cdn.jsdelivr.net/gh/shini74744/xjs@main/26.4.18shijianhuansuan.js"];
 const source="<script>window.NZ_DASHBOARD_CONFIG="+JSON.stringify(old)+";</script>";
 await page.getByText("读取以前的仪表板自定义代码",{exact:true}).click();await page.getByLabel("原仪表板自定义代码").fill(source);
 await page.getByRole("button",{name:"读取旧代码配置"}).click();
 await page.getByRole("button",{name:"保存后台美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0].source_code).toBe(source);expect(updates[0].remaining_custom_code).toBe("");expect(updates[0].config).toEqual(provided);
});
test("IP tools and timezone conversion survive navigation without duplicate links",async({page})=>{
 const {errors}=await setup(page,true);
 await page.goto("/dashboard/settings/online-user");
 await expect(page.locator("time")).toHaveText(["2026-09-25 22:06:52","2026-09-25 22:06:52"]);
 await expect(page.getByRole("link",{name:"Tcpingv4",exact:true})).toHaveAttribute("href","https://www.itdog.cn/tcping/1.2.3.4%3A443");
 await expect(page.getByRole("link",{name:"Tcpingv6",exact:true})).toHaveAttribute("href","https://www.itdog.cn/tcping_ipv6/%5B2602%3Afa02%3A33%3A103%3A%3Aa%5D%3A443");
 await expect(page.getByRole("link",{name:"Ping0v6",exact:true})).toHaveAttribute("href","https://ping0.cc/ip/2602%3Afa02%3A33%3A103%3A%3Aa");
 await page.getByRole("checkbox",{name:"Select all",exact:true}).click();
 await expect(page.locator("[data-dashboard-ping]")).toHaveCount(2);expect(errors).toEqual([]);
});
test("stale save preserves input, unsafe or unknown script stays unexecuted",async({page})=>{
 const s=await setup(page);s.conflict();await page.getByRole("switch",{name:"启用后台美化",exact:true}).click();await page.getByRole("button",{name:"保存后台美化设置",exact:true}).click();
 await expect(page.getByRole("switch",{name:"启用后台美化",exact:true})).toBeChecked();
 await page.getByText("读取以前的仪表板自定义代码",{exact:true}).click();
 await page.getByLabel("原仪表板自定义代码").fill('<script>window.NZ_DASHBOARD_CONFIG={font:{family:(window.UNSAFE=1)}};</script>');
 await page.getByRole("button",{name:"读取旧代码配置"}).click();
 expect(await page.evaluate(()=>(window as any).UNSAFE)).toBeUndefined();expect(s.updates).toHaveLength(1);
});
