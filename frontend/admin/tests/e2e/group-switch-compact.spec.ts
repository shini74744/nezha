import {test,expect,Page} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
const defs=JSON.parse(fs.readFileSync(new URL("../../../user/src/appearance/manifest.json",import.meta.url),"utf8"));
async function setup(page:Page,theme:string,dark:boolean,many=false,empty=false){
 const origin=theme==="doraemon"?"https://127.0.0.1:18478":"https://127.0.0.1:18477";
 const now=Date.now(),servers=[createServer({id:1,name:"分组节点一",last_active:new Date(now).toISOString()}),createServer({id:2,name:"分组节点二",last_active:new Date(now).toISOString()})];
 const config={version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,{...d.defaults,enabled:d.key==="background"}]))};
 Object.assign(config.features.background,{nightEnabled:false,regionApi:"",desktopLoadEffect:"none",mobileLoadEffect:"none",desktopMedia:[{type:"image",src:origin+"/wallpaper.jpg"}],mobileMedia:[{type:"image",src:origin+"/wallpaper.jpg"}],chinaMedia:[],rules:[]});
 await page.addInitScript(({dark})=>{localStorage.setItem("language","zh-CN");localStorage.setItem("vite-ui-theme",dark?"dark":"light");localStorage.setItem("doraemon-ui-theme",dark?"dark":"light");localStorage.setItem("showMap","0");localStorage.setItem("inline","0")},{dark});
 const errors:string[]=[],writes:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,servers,online:2})));
 await page.route("**/*",r=>{
  const u=new URL(r.request().url());let data:any;
  if(u.pathname.startsWith("/api/")&&r.request().method()!=="GET")writes.push(u.pathname);
  if(u.pathname==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"分组样式检查",custom_code:"",appearance_config:JSON.stringify(config)},version:"test"};
  else if(u.pathname==="/api/v1/profile")return r.fulfill({json:{success:false}});
  else if(u.pathname==="/api/v1/server-group")data=empty?[]:(many?Array.from({length:12},(_,i)=>({group:{id:i+1,name:i===11?"最后一个很长的服务器分组名称":"分组"+(i+1)},servers:[i%2+1]})):[{group:{id:1,name:"1111"},servers:[1]}]);
  else if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  else if(u.pathname.startsWith("/api/"))data=[];
  if(data!==undefined)return r.fulfill({json:{success:true,data}});
  if(u.pathname==="/wallpaper.jpg")return r.fulfill({contentType:"image/jpeg",body:fs.readFileSync("/srv/nezha-builder/qa/dashboard-light-background.jpg")});
  if(u.origin!==origin)return r.abort();return r.continue();
 });
 await page.goto(origin);return {origin,errors,writes};
}
for(const theme of ["default","doraemon"])for(const dark of [false,true])for(const width of [320,390,1440]){
 test("compact groups "+theme+" "+dark+" "+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});const state=await setup(page,theme,dark);
  const group=page.locator("[data-group-switch]");await expect(group).toBeVisible();
  await expect(group).toHaveCSS("height","34px");
  const all=group.getByRole("button",{name:"全部",exact:true}),one=group.getByRole("button",{name:"1111"});
  await expect(all).toHaveAttribute("aria-pressed","true");
  await expect(page.getByText("分组节点二",{exact:true})).toBeVisible();
  await one.click();await expect(one).toHaveAttribute("aria-pressed","true");
  await expect(page.getByText("分组节点二",{exact:true})).toHaveCount(0);
  await expect(page.getByText("分组节点一",{exact:true})).toBeVisible();
  await all.focus();await page.keyboard.press("Enter");
  await expect(all).toHaveAttribute("aria-pressed","true");
  await expect(page.getByText("分组节点二",{exact:true})).toBeVisible();
  await expect.poll(()=>group.locator("[data-group-indicator]").evaluate(e=>Math.round(e.getBoundingClientRect().height))).toBe(30);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for(const label of ["切换地区地图","切换卡片列表布局"]){
   const b=await page.getByRole("button",{name:label}).boundingBox();expect(b!.width).toBeGreaterThanOrEqual(32);
  }
  await page.locator(".server-overview-controls").screenshot({path:info.outputPath("compact-groups.png")});
  expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
 });
}
for(const theme of ["default","doraemon"]){
 test("many groups scroll and preserve selection "+theme,async({page},info)=>{
  await page.setViewportSize({width:390,height:900});const state=await setup(page,theme,false,true);
  const group=page.locator("[data-group-switch]");await expect(group).toBeVisible();
  await expect.poll(()=>group.locator("[data-group-scroll]").evaluate(e=>e.scrollWidth-e.clientWidth)).toBeGreaterThan(0);
  await group.hover();await page.mouse.wheel(0,160);
  await expect.poll(()=>group.locator("[data-group-scroll]").evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
  const last=group.getByRole("button",{name:"最后一个很长的服务器分组名称"});
  await last.focus();await page.keyboard.press("Space");
  await expect(last).toHaveAttribute("aria-pressed","true");
  await expect(page.getByText("分组节点一",{exact:true})).toHaveCount(0);
  await page.reload();await expect(group.getByRole("button",{pressed:true})).toHaveText("最后一个很长的服务器分组名称");
  await expect.poll(async()=>{const pos=(await last.boundingBox())!,box=(await group.boundingBox())!;return pos.x+pos.width-box.x-box.width}).toBeLessThanOrEqual(1);
  const pos=await last.boundingBox(),box=await group.boundingBox();expect(pos!.x).toBeGreaterThanOrEqual(box!.x-1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator(".server-overview-controls").screenshot({path:info.outputPath("many-groups.png")});
  expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
 });
 test("no empty group control "+theme,async({page})=>{
  await setup(page,theme,false,false,true);
  await expect(page.getByText("分组节点一",{exact:true})).toBeVisible();
  await expect(page.locator("[data-group-switch]")).toHaveCount(0);
 });
}

for(const theme of ["default","doraemon"]) test("touch groups "+theme,async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
 const page=await context.newPage();await setup(page,theme,false,true);
 const group=page.locator("[data-group-switch]");await expect(group).toBeVisible();
 const box=(await group.boundingBox())!,x=box.x+box.width-12,y=box.y+box.height/2;
 const cdp=await context.newCDPSession(page);
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-i*22,y}]});
 await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
 await expect.poll(()=>group.locator("[data-group-scroll]").evaluate(e=>e.scrollLeft)).toBeGreaterThan(10);
 await group.locator("[data-group-scroll]").evaluate(e=>{e.scrollLeft=0});
 await group.getByRole("button",{name:"分组1",exact:true}).tap();
 await expect(group.getByRole("button",{name:"分组1",exact:true})).toHaveAttribute("aria-pressed","true");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await context.close();
});

for(const theme of ["default","doraemon"])for(const width of [390,1440])test("three groups plus pinned All menu "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});await setup(page,theme,false,true);
 const root=page.locator("[data-group-switch]"),scroller=root.locator("[data-group-scroll]"),all=root.getByRole("button",{name:"全部",exact:true});
 await expect(root).toBeVisible();
 const size=await scroller.evaluate(e=>({viewport:e.clientWidth,cell:e.querySelector("button")!.getBoundingClientRect().width}));
 expect(size.viewport).toBeLessThanOrEqual(3*size.cell+5);
 const before=(await all.boundingBox())!;
 await root.hover();await page.mouse.wheel(0,220);await expect.poll(()=>scroller.evaluate(e=>e.scrollLeft)).toBeGreaterThan(100);
 expect((await all.boundingBox())!.x).toBe(before.x);
 await all.click();const menu=page.getByRole("menu");await expect(menu).toBeVisible();
 await expect(menu.getByRole("menuitemradio")).toHaveCount(13);
 await page.screenshot({path:info.outputPath("group-menu.png")});
 await menu.getByRole("menuitemradio",{name:"最后一个很长的服务器分组名称"}).click();
 const last=root.getByRole("button",{name:"最后一个很长的服务器分组名称"});
 await expect(last).toHaveAttribute("aria-pressed","true");await expect(menu).toHaveCount(0);
 await expect.poll(async()=>{const a=(await last.boundingBox())!,b=(await scroller.boundingBox())!;return a.x>=b.x-1&&a.x+a.width<=b.x+b.width+1}).toBe(true);
 await all.click();await expect(all).toHaveAttribute("aria-pressed","true");await expect(menu).toHaveCount(0);
 await all.click();await expect(menu).toBeVisible();await page.keyboard.press("Escape");await expect(menu).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
