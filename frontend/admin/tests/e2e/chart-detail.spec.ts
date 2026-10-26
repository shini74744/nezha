import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
const anchor=Date.parse("2026-10-26T00:00:00+08:00");
async function setup(page:Page,theme:string,guest=false){
 await page.clock.setFixedTime(new Date(anchor+86400000));
 const origin="https://127.0.0.1:"+(theme==="default"?"18477":"18478");
 const state={mode:"normal",requests:[] as string[],sockets:[] as WebSocketRoute[],tick:()=>{}};
 await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");localStorage.setItem("doraemon-sky","light")});
 let count=0;
 const send=(ws:WebSocketRoute)=>{const now=anchor+86400000+count*3000;ws.send(JSON.stringify({now,online:1,servers:[createServer({id:7,name:"图表查看测试",last_active:new Date(now).toISOString(),state:{cpu:10+count,net_out_speed:2**20,net_in_speed:2**19,disk_io_available:true,disk_read_speed:1024,disk_write_speed:2048} as any})]}))};
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{state.sockets.push(ws);send(ws)});
 state.tick=()=>{count++;state.sockets.forEach(send)};
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/"))return route.continue();
  state.requests.push(route.request().method()+" "+u.pathname+u.search);
  let data:any=[];
  if(u.pathname==="/api/v1/profile"){ if(guest)return route.fulfill({status:200,json:{error:"ApiErrorUnauthorized"}}); data={id:7}; }
  else if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"图表查看测试",show_network_in_detail:false,appearance_config:'{"version":1,"enabled":false,"features":{}}',doraemon_appearance_config:'{"version":1,"enabled":false,"features":{}}'}};
  else if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  else if(u.pathname.endsWith("/online-history")){
   if(state.mode==="online-error")return route.fulfill({status:503,json:{success:false,error:"unavailable"}});
   const days=Number(u.searchParams.get("days")||1),end=anchor+86400000,start=end-days*86400000;
   const periods=[{start:new Date(end-21600000).toISOString(),end:new Date(end).toISOString(),ongoing:true}];
   const daily=Array.from({length:days+1},(_,i)=>({date:new Date(start+i*86400000+28800000).toISOString().slice(0,10),online_seconds:i===days-1?21600:0}));
   data={server_id:7,server_name:"图表查看测试",days,max_days:30,timezone:"Asia/Shanghai",window_start:new Date(start).toISOString(),window_end:new Date(end).toISOString(),total_online_seconds:21600,online_rate:21600/(days*864),currently_online:true,last_active:new Date(end).toISOString(),periods,daily};
  } else if(u.pathname.endsWith("/metrics")){
   if(state.mode==="error")return route.fulfill({status:503,json:{success:false}});
   const metric=u.searchParams.get("metric")!,period=u.searchParams.get("period"),step=period==="7d"?1800000:period==="30d"?7200000:30000;
   const length=state.mode==="sparse"?2:state.mode==="empty"?0:state.mode==="single"?1:period==="1d"?2881:337;
   data={data_points:Array.from({length},(_,i)=>({ts:state.mode==="sparse"?anchor+86400000-3600000+i*30000:anchor+i*step,value:metric.includes("speed")?1048576+i*100:10+i%60}))};
  }else if(u.pathname.endsWith("/connectivity"))data={server_id:7,state:"complete",online:true,can_run:false,results:[],groups:[]};
  else if(u.pathname.endsWith("/bgp"))data={server_id:7,online:true,can_run:false,state:"complete",available_families:[],topologies:[],history:[]};
  else if(u.pathname.endsWith("/streaming"))data={server_id:7,online:true,can_run:false,state:"complete",results:[]};
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/server/7");
 await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6);
 await expect(page.locator(".server-charts")).toHaveCSS("display","grid");
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
 await expect.poll(() => dialog.boundingBox()).toMatchObject({x:0,y:0,width:320,height:740});
 await dialog.screenshot({path:info.outputPath("narrow-mobile.png")});
});


for(const theme of ["default","doraemon"])for(const width of [390,1440])test("online menu, equal pill insets and recovery "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const state=await setup(page,theme);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const trigger=page.getByRole("button",{name:"实时",exact:true});
 for(const zoom of [0.75,1,1.25,1.5]){
  await page.evaluate(z=>document.body.style.zoom=String(z),zoom);
  await expect.poll(()=>trigger.evaluate(el=>{
   const root=el.closest(".w-fit")!,indicator=root.querySelector(".active-indicator-fade-in")!;
   const box=root.getBoundingClientRect(),pill=indicator.getBoundingClientRect();
   return Math.abs((pill.top-box.top)-(box.bottom-pill.bottom));
  })).toBeLessThan(1.1);
 }
 await page.evaluate(()=>document.body.style.zoom="1");
 await trigger.click();await expect(page.getByRole("menuitem",{name:"在线率",exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe("hidden");
 await page.getByRole("menuitem",{name:"在线率",exact:true}).click();
 const dialog=page.getByRole("dialog");
 await expect(dialog).toBeVisible();await expect(dialog).toContainText("25.0%");
 await expect(dialog.getByTestId(width<768?"summary-mobile":"summary-desktop")).toBeVisible();
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await dialog.getByText("7 天",{exact:true}).click();await expect(dialog).toContainText("3.6%");
 await dialog.getByText("30 天",{exact:true}).click();await expect(dialog).toContainText("0.8%");
 await expect.poll(() => dialog.getByTestId("days-selector").evaluate(el => { const active=[...el.children].find(n=>n.textContent==="30 天")!; return Math.abs(active.getBoundingClientRect().left-el.querySelector(".active-indicator-fade-in")!.getBoundingClientRect().left); })).toBeLessThan(1.1);
 await dialog.screenshot({path:info.outputPath("online-history.png")});
 await dialog.getByRole("button",{name:"Close",exact:true}).click();
 await trigger.click();await page.getByRole("menuitem",{name:"实时图表",exact:true}).click();
 await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6);
 state.mode="online-error";await trigger.click();await page.getByRole("menuitem",{name:"在线率",exact:true}).click();
 await expect(dialog.getByRole("button",{name:"重试",exact:true})).toBeVisible({timeout:30000});
 state.mode="normal";await dialog.getByRole("button",{name:"重试",exact:true}).click();await expect(dialog).toContainText("25.0%");
 expect(errors).toEqual([]);
 expect(state.requests.filter(x=>!x.startsWith("GET ")&&x!=="POST /api/v1/refresh-token")).toEqual([]);
});

for(const theme of ["default","doraemon"])test("sparse rolling chart windows "+theme,async({page})=>{
 const state=await setup(page,theme);state.mode="sparse";
 for(const [label,days] of [["1 天",1],["7 天",7],["30 天",30]] as const){
  await page.getByText(label,{exact:true}).click();
  const button=page.getByRole("button",{name:"CPU 使用率详细查看",exact:true});
  await expect(button).toBeEnabled();await button.click();
  const dialog=page.getByRole("dialog");
  const start=await dialog.getByLabel("开始时间",{exact:true}).inputValue(),end=await dialog.getByLabel("结束时间",{exact:true}).inputValue();
  expect(Date.parse(end+"+08:00")-Date.parse(start+"+08:00")).toBe(days*86400000);
  expect(Date.parse(end+"+08:00")).toBe(anchor+86400000);
  await expect(dialog).toContainText("2 / 2");
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
 }
});

for(const theme of ["default","doraemon"])for(const width of [390,1440])
test("guest online history accepts dashboard unauthorized envelope "+theme+" "+width,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await setup(page,theme,true);
 await page.getByRole("button",{name:"实时",exact:true}).click();
 await page.getByRole("menuitem",{name:"在线率",exact:true}).click();
 const dialog=page.getByRole("dialog");
 await expect(dialog).toContainText("25.0%");
 expect(state.requests.some(x=>x.endsWith("/online-history?days=1"))).toBe(true);
 expect(state.requests.some(x=>/online-history\?days=(7|30)$/.test(x))).toBe(false);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});


for(const theme of ["default","doraemon"])for(const width of [390,1440])
test("realtime hour shortcuts load history and restore complete ranges "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const state=await setup(page,theme);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 for(const title of ["CPU 使用率","内存","磁盘","进程数","网络速率","连接数"]){
  const entry=page.getByRole("button",{name:title+"详细查看",exact:true});await entry.scrollIntoViewIfNeeded();await entry.click();
  const dialog=page.getByRole("dialog"),plot=dialog.locator("[data-detail-plot]");
  await expect(dialog.getByRole("button",{name:"恢复全部",exact:true})).toBeDisabled();
  const before=state.requests.filter(x=>x.includes("/metrics?")).length;
  for(const hours of [1,6,24]){
   const button=dialog.getByRole("button",{name:"近 "+hours+" 小时",exact:true});await button.click();
   await expect(button).toHaveAttribute("aria-pressed","true");
   await expect.poll(async()=>Number(await plot.getAttribute("data-window-end"))-Number(await plot.getAttribute("data-window-start"))).toBe(hours*3600000);
   await expect(dialog).toContainText("30 秒");
  }
  const fetched=state.requests.filter(x=>x.includes("/metrics?")).length-before;
  expect(fetched).toBe(["内存","网络速率","连接数"].includes(title)?2:1);
  await dialog.getByRole("button",{name:"近 1 小时",exact:true}).click();
  await dialog.getByRole("button",{name:"恢复全部",exact:true}).click();
  expect(Number(await plot.getAttribute("data-window-end"))-Number(await plot.getAttribute("data-window-start"))).toBe(86400000);
  await expect(dialog.getByRole("button",{name:"恢复全部",exact:true})).toBeDisabled();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  if(title==="内存")await dialog.screenshot({path:info.outputPath("history-presets.png")});
  await dialog.getByRole("button",{name:"返回实时快照",exact:true}).click();
  await expect(dialog).toContainText("打开时的实时快照");
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
 }
 expect(errors).toEqual([]);
});
test("realtime history loading, failure, retry and empty range are explicit",async({page})=>{
 const state=await setup(page,"default");await page.getByRole("button",{name:"内存详细查看",exact:true}).click();
 const dialog=page.getByRole("dialog");
 state.mode="error";await dialog.getByRole("button",{name:"近 1 小时",exact:true}).click();
 await expect(dialog.getByRole("alert")).toContainText("读取失败");
 await expect(dialog).toContainText("打开时的实时快照");
 state.mode="normal";await dialog.getByRole("button",{name:"重试",exact:true}).click();
 await expect(dialog).toContainText("已加载的历史记录");await expect(dialog.getByRole("button",{name:"近 1 小时",exact:true})).toHaveAttribute("aria-pressed","true");
 state.mode="empty";await dialog.getByRole("button",{name:"刷新历史记录",exact:true}).click();
 await expect(dialog).toContainText("这个范围没有记录。");
});
