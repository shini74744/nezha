import fs from "node:fs";
import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
async function setup(page:Page,theme:string) {
 const origin="https://127.0.0.1:"+(theme==="default"?"18477":"18478");
 const state={cpuFail:false,monitorFail:false,chunkFail:false,profileStatus:200,sockets:[] as WebSocketRoute[],metrics:[] as string[],moduleFailures:0};
 await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");localStorage.setItem("doraemon-sky","light");localStorage.setItem("statisticsView","uptime");localStorage.setItem("doraemon:statisticsView","uptime")});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{
  state.sockets.push(ws);const now=Date.now();
  ws.send(JSON.stringify({now,online:1,servers:[createServer({id:7,name:"恢复验证节点",last_active:new Date(now).toISOString(),public_note:JSON.stringify({billingDataMod:{amount:"12USD",cycle:"Month",endDate:"2026-11-25T00:00:00+08:00"},planDataMod:{bandwidth:"1Gbps",trafficVol:"2TB/月",extra:"中文标签,English",networkRoutes:{telecom:"163PP/CN2"}}})})]}));
 });
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/")){
   if(state.chunkFail&&/\/ServerDetailChart[-.][^/]+\.js$/.test(u.pathname)){state.moduleFailures++;return route.fulfill({status:503,body:"temporary"})}
   return route.continue();
  }
  if(u.pathname==="/api/v1/profile")return route.fulfill({status:state.profileStatus,json:{success:state.profileStatus===200,data:{id:7}}});
  let data:any=[];
  if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"恢复验证",custom_code:"",show_network_in_detail:false,appearance_config:'{"version":1,"enabled":false,"features":{}}',doraemon_appearance_config:'{"version":1,"enabled":false,"features":{}}'}};
  else if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  else if(u.pathname.endsWith("/metrics")){
   state.metrics.push(u.search);
   if(state.cpuFail&&u.searchParams.get("metric")==="cpu")return route.fulfill({status:503,json:{success:false}});
   data={data_points:Array.from({length:5},(_,i)=>({ts:Date.now()-(5-i)*60000,value:10+i*5}))};
  } else if(/\/server\/\d+\/service$/.test(u.pathname)){
   if(state.monitorFail)return route.fulfill({status:503,json:{success:false}});
   data=[{monitor_id:1,monitor_name:"测试线路",server_id:7,server_name:"恢复验证节点",created_at:[Date.now()-60000,Date.now()],avg_delay:[20,25],packet_loss:[0,0]}];
  } else if(u.pathname.endsWith("/connectivity")) data={server_id:7,state:"complete",online:true,can_run:false,results:[],groups:[]};
  else if(u.pathname.endsWith("/bgp"))data={server_id:7,online:true,can_run:false,state:"complete",available_families:[],topologies:[],history:[]};
  else if(u.pathname.endsWith("/streaming"))data={server_id:7,online:true,can_run:false,state:"complete",results:[]};
  return route.fulfill({json:{success:true,data}});
 });
 return {state,origin};
}
for(const theme of ["default","doraemon"])for(const width of [390,1440]) {
 test("history failures retry without hiding tabs "+theme+" "+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});const {state,origin}=await setup(page,theme);state.cpuFail=true;
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(origin+"/server/7");await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6);
  await page.getByText("1 天",{exact:true}).click();
  const alerts=page.locator(".server-charts [role=alert]");await expect(alerts).toHaveCount(1);
  await expect(page.locator(".server-info-tab")).toBeVisible();
  expect(state.metrics.some(s=>s.includes("metric=memory"))).toBe(true);
  state.cpuFail=false;await alerts.getByRole("button").click();await expect(alerts).toHaveCount(0);
  await expect(page.locator(".server-charts .recharts-area-curve").first()).toBeVisible();
  await page.getByRole("button",{name:"点击切换到磁盘读写"}).click();
  await expect.poll(()=>state.metrics.some(s=>s.includes("metric=disk_read_speed")&&s.includes("period=1d"))).toBe(true);
  await page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true}).click();
  await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(1);
  await page.getByRole("button",{name:/^测试线路/}).click();
  await expect(page.locator('[data-active="true"]').filter({hasText:"测试线路"})).toHaveCount(1);
  state.monitorFail=true;await page.getByText("7 天",{exact:true}).click();
  const network=page.locator("[data-server-network]");
  await expect(network.getByRole("alert")).toBeVisible();
  await expect(network.locator(".recharts-line-curve")).toHaveCount(0);
  await expect(network.getByText("1 天",{exact:true})).toBeVisible();
  state.monitorFail=false;await network.getByRole("alert").getByRole("button").click();
  await expect(network.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(network.locator('[data-active="true"]').filter({hasText:"测试线路"})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath("recovered.png")});expect(errors).toEqual([]);
 });
 test("blocked storage still opens both themes and details "+theme+" "+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});const {origin}=await setup(page,theme);
  await page.addInitScript(()=>{for(const key of ["localStorage","sessionStorage"])Object.defineProperty(window,key,{configurable:true,get(){throw new DOMException("blocked","SecurityError")}})});
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(origin+"/server/7");await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6);
  await page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true}).click();
  await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(1);
  await page.goto(origin+"/");await expect(page.getByText("恢复验证节点",{exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath("blocked-storage.png")});expect(errors).toEqual([]);
 });
}
for(const theme of ["default","doraemon"]) {
 test("failed chunk is local and reload recovers "+theme,async({page})=>{
  const {state,origin}=await setup(page,theme);state.chunkFail=true;
  await page.goto(origin+"/server/7");
  await expect(page.locator("[data-local-error]").first()).toBeVisible();
  await expect(page.locator(".server-info-tab")).toBeVisible();expect(state.moduleFailures).toBeLessThan(5);
  await page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true}).click();
  await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(1);
  await page.locator(".server-info-tab").getByRole("button",{name:"详情",exact:true}).click();
  state.chunkFail=false;await page.getByRole("button",{name:"刷新页面",exact:true}).click();
  await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6);
  await expect(page.locator("[data-local-error]")).toHaveCount(0);
 });
 test("connection and expired session recover "+theme,async({page})=>{
  const {state,origin}=await setup(page,theme);
  await page.goto(origin+"/server/7");await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6);
  const before=state.sockets.length;state.sockets[state.sockets.length-1].close({code:1012,reason:"test reconnect"});
  await expect.poll(()=>state.sockets.length).toBeGreaterThan(before);
  await page.getByText("7 天",{exact:true}).click();
  await expect.poll(()=>state.metrics.some(s=>s.includes("period=7d"))).toBe(true);
  state.profileStatus=401;
  await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange", {bubbles:true})));
  await expect.poll(()=>state.sockets.length).toBeGreaterThan(before+1);
  await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6);
  await expect(page.getByRole("button",{name:"7 天",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"7 天",exact:true})).toHaveAttribute("aria-pressed","false");
 });
}

for(const theme of ["default","doraemon"])for(const width of [390,900,1440])test("original metric card layout "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const {origin}=await setup(page,theme);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(origin+"/server/7");const grid=page.locator(".server-charts");
 await expect(grid.locator("[data-chart]")).toHaveCount(6);
 for(const period of ["实时","1 天"]){
  await page.getByText(period,{exact:true}).click();
  if(period === "实时" && !process.env.METRIC_BASELINE) await page.getByRole("menuitem",{name:"实时图表",exact:true}).click();
  await expect(grid.locator("[data-chart]")).toHaveCount(6);
  await expect(grid.getByRole("button",{name:/详细查看/})).toHaveCount(process.env.METRIC_BASELINE ? 0 : 6);
  for(const chart of await grid.locator("[data-chart]").all()){
   await chart.scrollIntoViewIfNeeded();
   await expect(chart.locator(".recharts-cartesian-grid")).toBeVisible();
  }
  const geometry=await grid.evaluate(el=>{
   const style=getComputedStyle(el),cards=[...el.children].map(child=>{
    const box=child.getBoundingClientRect(),plot=child.querySelector(".recharts-cartesian-grid")!.getBoundingClientRect();
    const axisNode=child.querySelector(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value");
    if(!axisNode)throw new Error("Missing time label");
    const axis=axisNode.getBoundingClientRect();
    const zero=[...child.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")].find(n=>parseFloat(n.textContent||"")===0)?.getBoundingClientRect();
    const detail=child.querySelector(".chart-detail-open")?.getBoundingClientRect();
    const labels=[...child.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value")].map(n=>{const r=n.getBoundingClientRect();return {x:r.x,right:r.right}});
    return {x:box.x,y:box.y,w:box.width,h:box.height,plotTop:plot.top,plotBottom:plot.bottom,zeroY:zero?.y ?? plot.bottom,axisY:axis.y,
      detail:detail?{x:detail.x,y:detail.y,w:detail.width,h:detail.height}:undefined,labels};

   });
   return {columns:style.gridTemplateColumns.split(" ").length,gap:parseFloat(style.rowGap),cards};
  });
  const columns=width<768?1:width<1024?2:3;
  expect(geometry.columns).toBe(columns);expect(geometry.cards).toHaveLength(6);
  const baselineFile=process.env.METRIC_BASELINE_DIR+"/"+theme+"-"+width+"-"+(period==="实时"?"live":"history")+".json";
  if(process.env.METRIC_BASELINE)fs.writeFileSync(baselineFile,JSON.stringify(geometry));
  const baseline=process.env.METRIC_BASELINE_DIR&&!process.env.METRIC_BASELINE?JSON.parse(fs.readFileSync(baselineFile,"utf8")):null;
  geometry.cards.forEach((box,i)=>{
   if(baseline)expect(Math.abs(box.h-baseline.cards[i].h),"unchanged card height").toBeLessThan(1);
   if(!process.env.METRIC_BASELINE){
    expect(box.detail).toBeTruthy();
    expect(Math.abs(box.detail!.x+box.detail!.w/2-(box.x+box.w/2))).toBeLessThan(1);
    expect(box.detail!.y+box.detail!.h).toBeLessThanOrEqual(box.y+box.h);
    for(const label of box.labels)expect(label.right<=box.detail!.x-2||label.x>=box.detail!.x+box.detail!.w+2,"time labels clear of detail button").toBe(true);
   }
   expect(box.w).toBeGreaterThan(100);expect(box.h).toBeGreaterThan(150);
   if(i%columns){
    const first=geometry.cards[i-i%columns];
    for(const key of process.env.METRIC_BASELINE ? ["y"] as const : ["y","plotTop","plotBottom","zeroY","axisY"] as const)
     expect(Math.abs(box[key]-first[key]),period+" card "+i+" "+key).toBeLessThan(1);
   }
   if(i>=columns)expect(box.y).toBeGreaterThanOrEqual(geometry.cards[i-columns].y+geometry.cards[i-columns].h+geometry.gap-1);
  });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await grid.screenshot({path:info.outputPath(period==="实时"?"cards-realtime.png":"cards-history.png")});
 }
 expect(errors).toEqual([]);
});
