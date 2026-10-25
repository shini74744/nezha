import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
const anchor=Date.parse("2026-10-26T00:00:00+08:00");
async function setup(page:Page,theme:string){
 const origin="https://127.0.0.1:"+(theme==="default"?"18477":"18478");
 const state={mode:"normal",requests:[] as string[],sockets:[] as WebSocketRoute[],tick:()=>{}};
 await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");localStorage.setItem("doraemon-sky","light")});
 let count=0;
 const send=(ws:WebSocketRoute)=>{const now=Date.now()+count++*3000;ws.send(JSON.stringify({now,online:1,servers:[createServer({id:7,name:"图表查看测试",last_active:new Date(now).toISOString(),state:{cpu:10+count,net_out_speed:2**20,net_in_speed:2**19,disk_io_available:true,disk_read_speed:1024,disk_write_speed:2048} as any})]}))};
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{state.sockets.push(ws);send(ws)});
 state.tick=()=>state.sockets.forEach(send);
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/"))return route.continue();
  state.requests.push(route.request().method()+" "+u.pathname+u.search);
  let data:any=[];
  if(u.pathname==="/api/v1/profile")data={id:7};
  else if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"图表查看测试",show_network_in_detail:false,appearance_config:'{"version":1,"enabled":false,"features":{}}',doraemon_appearance_config:'{"version":1,"enabled":false,"features":{}}'}};
  else if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  else if(u.pathname.endsWith("/metrics")){
   if(state.mode==="error")return route.fulfill({status:503,json:{success:false}});
   const metric=u.searchParams.get("metric")!,period=u.searchParams.get("period"),step=period==="7d"?1800000:period==="30d"?7200000:30000;
   const length=state.mode==="empty"?0:state.mode==="single"?1:period==="1d"?2881:337;
   data={data_points:Array.from({length},(_,i)=>({ts:anchor+i*step,value:metric.includes("speed")?1048576+i*100:10+i%60}))};
  }else if(u.pathname.endsWith("/connectivity"))data={server_id:7,state:"complete",online:true,can_run:false,results:[],groups:[]};
  else if(u.pathname.endsWith("/bgp"))data={server_id:7,online:true,can_run:false,state:"complete",available_families:[],topologies:[],history:[]};
  else if(u.pathname.endsWith("/streaming"))data={server_id:7,online:true,can_run:false,state:"complete",results:[]};
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/server/7");
 await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6);
 return state;
}
for(const theme of ["default","doraemon"])for(const width of [390,1440]){
 test("detailed history ranges and actual points "+theme+" "+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});const state=await setup(page,theme);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.getByText("1 天",{exact:true}).click();
  const entry=page.getByRole("button",{name:"网络速率详细查看"});await entry.scrollIntoViewIfNeeded();await expect(entry).toBeEnabled();await entry.click();
  const dialog=page.getByRole("dialog"),readout=dialog.locator("[data-detail-readout]");
  await expect(dialog).toBeVisible();await expect(dialog).toContainText("30 秒");await expect(dialog.locator(".recharts-line-curve")).toHaveCount(2);
  await expect(dialog).toContainText("2881 / 2881");
  const requests=state.requests.filter(x=>x.includes("/metrics")).length;
  await dialog.getByRole("button",{name:"近 1 小时",exact:true}).click();await expect(dialog).toContainText("121 / 121");
  await dialog.getByLabel("定位时间",{exact:true}).fill("2026-10-26T12:00:14");
  await dialog.getByRole("button",{name:"定位",exact:true}).click();
  await expect(readout).toContainText("2026-10-26 12:00:00");await expect(readout).toContainText("最近的实际采样点");
  await dialog.getByRole("button",{name:"上一点"}).click();await expect(readout).toContainText("2026-10-26 11:59:30");
  await dialog.getByRole("button",{name:"下一点"}).click();await expect(readout).toContainText("2026-10-26 12:00:00");
  await dialog.getByLabel("开始时间",{exact:true}).fill("2026-10-26T10:00");await dialog.getByLabel("结束时间",{exact:true}).fill("2026-10-26T10:10");
  await dialog.getByRole("button",{name:"查看范围",exact:true}).click();await expect(dialog).toContainText("21 / 21");
  const hit=dialog.locator(".chart-detail-hitarea");await hit.scrollIntoViewIfNeeded();await hit.focus();await page.keyboard.press("Home");await expect(readout).toContainText("2026-10-26 10:00:00");
  await page.keyboard.press("ArrowRight");await expect(readout).toContainText("2026-10-26 10:00:30");
  await page.keyboard.press("Escape");await expect(dialog).toBeVisible();await expect(dialog.getByRole("button",{name:"解除锁定"})).toBeDisabled();
  expect(state.requests.filter(x=>x.includes("/metrics")).length).toBe(requests);
  expect(state.requests.filter(x=>!x.startsWith("GET ")&&x!=="POST /api/v1/refresh-token")).toEqual([]);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.screenshot({path:info.outputPath("detailed-history.png")});
  await dialog.getByRole("button",{name:"Close",exact:true}).click();await expect(entry).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
 });
 test("live snapshot and scrolling "+theme+" "+width,async({page},info)=>{
  await page.setViewportSize({width,height:760});const state=await setup(page,theme);for(let i=0;i<10;i++)state.tick();
  await page.locator(".server-charts .chart-detail-open").first().click();
  const dialog=page.getByRole("dialog"),readout=dialog.locator("[data-detail-readout]"),hit=dialog.locator(".chart-detail-hitarea");
  await expect(dialog).toBeVisible();const text=(await readout.textContent())!;for(let i=0;i<5;i++)state.tick();
  await expect(readout).toHaveText(text);
  await dialog.getByRole("button",{name:"更新查看快照"}).click();await expect(readout).not.toHaveText(text);
  await hit.scrollIntoViewIfNeeded();const box=await hit.boundingBox();expect(box).toBeTruthy();
  await page.mouse.click(box!.x+box!.width*.3,box!.y+50);
  await expect(readout).toContainText("已锁定");const locked=(await readout.textContent())!;
  await page.mouse.move(box!.x+box!.width*.7,box!.y+60);await expect(readout).toHaveText(locked);
  if(width>640){
   await dialog.getByRole("button",{name:"拖选放大",exact:true}).click();
   await page.mouse.move(box!.x+box!.width*.2,box!.y+50);await page.mouse.down();await page.mouse.move(box!.x+box!.width*.7,box!.y+50,{steps:10});await page.mouse.up();
   await expect(dialog.getByRole("button",{name:"拖选放大",exact:true})).toBeVisible();
   expect(await dialog.locator(".chart-detail-navigation").innerText()).not.toContain("16 / 16");
  } else {
   // Native touch dispatch tests scroll arbitration, not just a synthetic DOM event.
   await dialog.evaluate(el=>el.scrollTop=0);await hit.scrollIntoViewIfNeeded();const b=(await hit.boundingBox())!;
   const cdp=await page.context().newCDPSession(page);await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true});
   const before=await dialog.evaluate(el=>el.scrollTop);
   await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:b.x+b.width/2,y:b.y+160}]});
   for(let i=1;i<=5;i++)await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:b.x+b.width/2,y:b.y+160-i*20}]});
   await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
   await expect.poll(()=>dialog.evaluate(el=>el.scrollTop)).toBeGreaterThan(before);
   expect(await hit.evaluate(el=>getComputedStyle(el).touchAction)).toContain("pan-y");
  }
  await dialog.screenshot({path:info.outputPath("live-snapshot.png")});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 });
}
for(const theme of ["default","doraemon"])test("history granularity, errors and single record "+theme,async({page})=>{
 const state=await setup(page,theme);
 for(const [label,interval] of [["7 天","30 分钟"],["30 天","2 小时"]]){
  await page.getByText(label,{exact:true}).click();const entry=page.getByRole("button",{name:"CPU 使用率详细查看"});await entry.scrollIntoViewIfNeeded();await expect(entry).toBeEnabled();await entry.click();
  await expect(page.getByRole("dialog")).toContainText(interval);
  await page.getByRole("dialog").getByRole("button",{name:"Close"}).click();
 }
 state.mode="single";await page.getByText("1 天",{exact:true}).click();const entry=page.getByRole("button",{name:"CPU 使用率详细查看"});await entry.scrollIntoViewIfNeeded();await expect(entry).toBeEnabled();await entry.click();
 await expect(page.getByRole("dialog")).toContainText("1 / 1");
 await expect(page.getByRole("button",{name:"上一点"})).toBeDisabled();await expect(page.getByRole("button",{name:"下一点"})).toBeDisabled();
 await page.getByRole("dialog").getByRole("button",{name:"Close"}).click();
});
for(const mode of ["empty","error"])test("unavailable history disables entry "+mode,async({page})=>{
 const state=await setup(page,"default");state.mode=mode;await page.getByText("1 天",{exact:true}).click();
 for(const entry of await page.locator(".server-charts .chart-detail-open").all())await expect(entry).toBeDisabled();
});
test("320px mobile dialog stays within viewport",async({page},info)=>{
 await page.setViewportSize({width:320,height:740});await setup(page,"doraemon");
 await page.locator(".server-charts .chart-detail-open").first().click();const dialog=page.getByRole("dialog");
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 expect(await dialog.boundingBox()).toMatchObject({x:0,y:0,width:320,height:740});
 await dialog.screenshot({path:info.outputPath("narrow-mobile.png")});
});
