import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";

for(const width of [360,390,430,1366])for(const allHidden of [false,true])test("ordinary hidden guest toggle "+width+" "+allHidden,async({page})=>{
 await page.setViewportSize({width,height:950});
 await page.addInitScript(()=>{localStorage.setItem("inline","0");localStorage.setItem("showMap","0")});
 const now=Date.now(),note=JSON.stringify({billingDataMod:{amount:"$99",cycle:"Year"},planDataMod:{providerLogo:{logo:"/api/v1/logo/assets/"+"a".repeat(64)+".svg"}}});
 const servers=[createServer({id:1,name:"公开机器",last_active:new Date(now).toISOString(),hide_for_display:allHidden}),createServer({id:2,name:"普通隐藏机器",last_active:new Date(now).toISOString(),hide_for_display:true,public_note:note})];
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{
  ws.send(JSON.stringify({now,servers}));
  setTimeout(()=>ws.send(JSON.stringify({now:now+2000,servers:servers.map(({public_note:_publicNote,...s})=>({...s,name:s.id===1?"公开机器更新":s.name}))})),200);
 });
 await page.route("**/api/v1/**",r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")return r.fulfill({json:{success:false,error:"unauthorized"}});
  if(path.includes("/logo/assets/"))return r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="green"/></svg>'});
  if(path==="/api/v1/setting")data={config:{site_name:"访客折叠测试",language:"zh-CN"}};
  if(path==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  if(path==="/api/v1/server-traffic")data={};
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto("/");
 const names=page.locator("[data-server-name]");
 await expect(names).toHaveCount(allHidden?0:1);
 await expect(names.filter({hasText:"普通隐藏机器"})).toHaveCount(0);
 const toggle=page.getByRole("button",{name:"页面插画",exact:true});
 await expect(toggle).toBeVisible();await expect(toggle).toHaveAttribute("aria-pressed","false");
 for(let i=0;i<4;i++)await toggle.click();await expect(names).toHaveCount(allHidden?0:1);
 await toggle.click();await expect(names).toHaveCount(2);
 await expect(names.filter({hasText:"公开机器更新"})).toBeVisible();
 const hidden=page.locator("[data-server-card]").filter({has:page.getByText("普通隐藏机器",{exact:true})});
 await expect(hidden).toContainText("$99/年");
 await expect(hidden.locator("[data-provider-logo]")).toBeVisible();
 await page.screenshot({path:"test-results/display-hidden-"+width+"-"+allHidden+".png"});
 for(let i=0;i<5;i++)await toggle.click();await expect(names).toHaveCount(allHidden?0:1);
 if(width===1366){
  await toggle.focus();
  for(let i=0;i<5;i++)await page.keyboard.press("Enter");
  await expect(names).toHaveCount(2);
  await page.keyboard.down("Enter");
  for(let i=0;i<8;i++)await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(names).toHaveCount(2);
 }
 await page.reload();await expect(page.getByRole("button",{name:"页面插画",exact:true})).toHaveAttribute("aria-pressed","false");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [360,390,430,1366])test("ordinary hidden checkbox saves independently "+width,async({page})=>{
 await page.setViewportSize({width,height:950});
 let server:any={id:11,name:"设置测试机器",host:{version:"2.3.6"},display_index:0,user_id:1,uuid:"fixture",public_note:"",note:"keep",enable_ddns:false,hide_for_guest:true,hide_for_display:false},saves=0;
 await page.route("**/api/v1/**",r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{site_name:"设置测试",language:"zh-CN"},version:"test"};
  if(path==="/api/v1/server")data=[server];
  if(path==="/api/v1/server/11"&&r.request().method()==="PATCH"){server={...server,...r.request().postDataJSON()};saves++}
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");
 const edit=page.getByRole("row").filter({has:page.getByText("设置测试机器",{exact:true})}).getByRole("button",{name:"编辑服务器",exact:true});
 await edit.click();const dialog=page.getByRole("dialog"),box=dialog.getByRole("checkbox",{name:"普通隐藏",exact:true});
 const row=dialog.locator("[data-server-visibility-options]");
 await row.scrollIntoViewIfNeeded();
 const checks=row.getByRole("checkbox");await expect(checks).toHaveCount(3);
 const bounds=await checks.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right}}));
 // The visibility row intentionally wraps on the narrowest phones. Preserve
 // reading order and containment instead of requiring desktop-only geometry.
 if(width>=390)expect(Math.max(...bounds.map(b=>b.y))-Math.min(...bounds.map(b=>b.y))).toBeLessThan(1);
 for(let i=1;i<bounds.length;i++){
  expect(bounds[i].y).toBeGreaterThanOrEqual(bounds[i-1].y-1);
  if(Math.abs(bounds[i].y-bounds[i-1].y)<1)expect(bounds[i].x).toBeGreaterThan(bounds[i-1].x);
 }
 expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:"test-results/visibility-row-"+width+".png"});
 const labels=row.locator("label");await labels.nth(0).click();await expect(checks.nth(0)).toBeChecked();
 await labels.nth(0).click();await expect(checks.nth(0)).not.toBeChecked();
 await expect(box).not.toBeChecked();await labels.nth(2).click();await expect(box).toBeChecked();
 await dialog.locator('button[type="submit"]').click();await expect(dialog).toHaveCount(0);
 expect(server.hide_for_display).toBe(true);expect(server.hide_for_guest).toBe(true);expect(server.note).toBe("keep");
 await page.reload();await edit.click();await expect(box).toBeChecked();await box.uncheck();
 await dialog.locator('button[type="submit"]').click();await expect(dialog).toHaveCount(0);
 expect(server.hide_for_display).toBe(false);expect(server.hide_for_guest).toBe(true);expect(saves).toBe(2);
});
