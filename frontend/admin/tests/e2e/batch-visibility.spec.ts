import { test, expect } from "@playwright/test";
import { createServer } from "../../../user/src/test/fixtures";

for (const width of [360,390,430,1366]) test("batch visibility selected only "+width, async ({page}) => {
 await page.setViewportSize({width,height:950});
 let servers=[11,12,13].map(id=>({id,name:"批量测试"+id,host:{version:"2.3.6"},display_index:0,user_id:1,uuid:"fixture-"+id,public_note:"",note:"keep",enable_ddns:false,hide_for_guest:id===12,hide_for_display:false}));
 const writes:any[]=[];
 await page.route("**/api/v1/**",async r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{site_name:"批量设置测试",language:"zh-CN"},version:"test"};
  if(path==="/api/v1/server")data=servers;
  if(path==="/api/v1/batch-visibility/server"){
   const body=r.request().postDataJSON();writes.push(body);
   const {ids,...flags}=body;servers=servers.map(s=>ids.includes(s.id)?{...s,...flags}:s);data={updated:ids.length};
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");
 const batch=page.getByRole("button",{name:"批量设置",exact:true});await expect(batch).toBeDisabled();
 for(const id of [11,12])await page.getByRole("row").filter({has:page.getByText("批量测试"+id,{exact:true})}).getByRole("checkbox").check();
 await expect(batch).toBeEnabled();await batch.scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/batch-toolbar-"+width+".png"});
 await batch.click();const dialog=page.getByRole("dialog");
 await expect(dialog).toContainText("2 台服务器");await expect(dialog).not.toContainText("批量测试13");
 const apply=dialog.getByRole("button",{name:"应用到 2 台服务器"});await expect(apply).toBeDisabled();
 await dialog.getByRole("combobox",{name:"普通隐藏",exact:true}).click();await page.getByRole("option",{name:"开启隐藏",exact:true}).click();
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:"test-results/batch-dialog-"+width+".png"});
 await apply.click();await expect(dialog).toHaveCount(0);
 expect(writes).toEqual([{ids:[11,12],hide_for_display:true}]);
 expect(servers[1].hide_for_guest).toBe(true);expect(servers[2].hide_for_display).toBe(false);
 await batch.click();await expect(apply).toBeDisabled();
 await dialog.getByRole("combobox",{name:"普通隐藏",exact:true}).click();await page.getByRole("option",{name:"关闭隐藏",exact:true}).click();
 await dialog.getByRole("combobox",{name:"对游客隐藏",exact:true}).click();await page.getByRole("option",{name:"关闭隐藏",exact:true}).click();
 await apply.click();await expect(dialog).toHaveCount(0);
 expect(writes[1]).toEqual({ids:[11,12],hide_for_guest:false,hide_for_display:false});
 expect(servers[0].note).toBe("keep");expect(servers[1].hide_for_guest).toBe(false);
 await batch.click();await dialog.getByRole("button",{name:"取消",exact:true}).click();expect(writes).toHaveLength(2);
});

for(const width of [390,1366])for(const role of [0,2])test("authenticated bypass ordinary hiding "+width+" role"+role,async({page})=>{
 await page.setViewportSize({width,height:950});
 await page.addInitScript(()=>{localStorage.setItem("inline","0");localStorage.setItem("showMap","0")});
 const servers=[createServer({id:1,name:"普通隐藏机器",hide_for_display:true}),createServer({id:2,name:"其他机器"})];
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now:Date.now(),servers})));
 await page.route("**/api/v1/**",r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"signed-in",role};
  if(path==="/api/v1/setting")data={config:{site_name:"已登录测试",language:"zh-CN"}};
  if(path==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  if(path==="/api/v1/server-traffic")data={};
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto("/");const cards=page.locator("[data-server-name]");await expect(cards).toHaveCount(2);
 const chicken=page.getByRole("button",{name:"页面插画",exact:true});
 for(let round=0;round<2;round++){for(let i=0;i<5;i++)await chicken.click();await expect(cards).toHaveCount(2)}
 await page.reload();await expect(cards).toHaveCount(2);
});

test("batch visibility failure stays editable and prevents duplicate submissions",async({page})=>{
 await page.setViewportSize({width:360,height:950});
 let writes=0;
 await page.route("**/api/v1/**",async r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"};
  if(path==="/api/v1/server")data=[{id:11,name:"重试测试",host:{},uuid:"fixture",hide_for_guest:false,hide_for_display:false}];
  if(path==="/api/v1/batch-visibility/server"){
   writes++;await new Promise(resolve=>setTimeout(resolve,600));
   return r.fulfill({json:writes===1?{success:false,error:"所选服务器无权修改"}:{success:true,data:{updated:1}}});
  }
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");await page.getByRole("checkbox",{name:"Select row"}).check();
 await page.getByRole("button",{name:"批量设置",exact:true}).click();
 const dialog=page.getByRole("dialog");
 await dialog.getByRole("combobox",{name:"普通隐藏",exact:true}).click();await page.getByRole("option",{name:"开启隐藏",exact:true}).click();
 await dialog.getByRole("button",{name:"应用到 1 台服务器"}).click();
 await expect(dialog.getByRole("button",{name:"保存中…"})).toBeDisabled();
 await expect(page.getByText("所选服务器无权修改",{exact:true})).toBeVisible();await expect(dialog).toBeVisible();expect(writes).toBe(1);
 await dialog.getByRole("button",{name:"应用到 1 台服务器"}).click();await expect(dialog).toHaveCount(0);expect(writes).toBe(2);
});
