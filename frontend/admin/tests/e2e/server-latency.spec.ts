import {test,expect,type Page} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
async function setup(page:Page,mode="both",defaultView="connectivity",offline=false,fixture="complete",families=["IPv4"],snapshots=false){
 const origin="https://127.0.0.1:18477",now=Date.now();
 const rows=(historical=false)=>families.flatMap(family=>["电信","联通","移动"].flatMap((carrier,c)=>["广东","广西","海南"].map((name,i)=>({id:"t"+c+i+(family==="IPv6"?"@IPv6":""),family,name,group:"华南",icon:carrier,host:"example.com:80",status:i===2?"timeout":"ok",delay_ms:i===2?undefined:(historical?11:35)+c*25+i*10+(family==="IPv6"?100:0),samples:i===2?[{status:"timeout"}]:[{status:"ok",delay_ms:35}]}))));
 const server=createServer({id:7,name:"延迟测试节点",network_display_mode:mode as any,network_default_view:defaultView as any,connectivity_disabled:mode==="latency"||mode==="hidden",last_active:offline?"0001-01-01T00:00:00Z":new Date(now).toISOString()});
 let posts=0;
 await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");localStorage.setItem("vite-ui-theme","dark")});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,servers:[server],online:offline?0:1})));
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(!u.pathname.startsWith("/api/"))return route.continue();
  let data:any=[];
  if(route.request().method()==="POST")posts++;
  if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"测试",show_network_in_detail:true,appearance_config:'{"version":1,"enabled":false,"features":{}}',custom_code:""}};
  if(u.pathname==="/api/v1/profile")data={id:1,role:0,username:"qa"};
  if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  if(u.pathname.endsWith("/metrics"))data={data_points:[]};
  if(u.pathname.endsWith("/last-report"))data={server_id:7,tsdb_enabled:true,history_days:30,last_report_at:now-3600000,snapshot:{at:now-3600000,host:server.host,state:server.state},metrics:{cpu:12},recent:{cpu:[]}};
  if(u.pathname.endsWith("/connectivity"))data={server_id:7,online:!offline,can_run:true,state:"idle",rounds:5,results:[]};
  if(u.pathname.endsWith("/latency"))data={server_id:7,online:!offline,can_run:true,state:"complete",rounds:3,finished_at:now,scheduled_at:snapshots?now-1000:undefined,available_families:families,history:snapshots?[{finished_at:now,scheduled_at:now-1000},{finished_at:now-7200000,scheduled_at:now-7201000},{finished_at:now-14400000,scheduled_at:now-14401000}]:[],results:rows()};
  if(u.pathname.endsWith("/latency")&&!["complete","ipv6-failure","manual-after-auto","historical-ipv6"].includes(fixture)){
   data.state=fixture==="running"?"running":fixture==="pending"?"idle":"complete";
   data.finished_at=fixture==="pending"||fixture==="running"?undefined:now;
   data.results=data.results.map((r:any)=>({...r,status:fixture==="zero"?"ok":fixture==="running"?"running":fixture==="pending"?"pending":"timeout",delay_ms:fixture==="zero"?0:undefined,samples:[]}));
  }
  if(u.pathname.endsWith("/latency")&&fixture==="manual-after-auto"){
   data.scheduled_at=undefined;
   data.history=[...data.history.slice(1),{finished_at:now,scheduled_at:0}];
  }
  if(u.pathname.endsWith("/latency")&&fixture==="historical-ipv6"){
   data.available_families=["IPv4"];data.results=data.results.filter((r:any)=>r.family==="IPv4");
  }
  if(u.pathname.endsWith("/latency")&&fixture==="ipv6-failure"){
   data.results=data.results.map((r:any)=>r.family==="IPv6"?{...r,status:"timeout",delay_ms:undefined,samples:[{status:"timeout"}]}:r);
  }
  if(u.pathname.endsWith("/latency")&&fixture==="upgrade"){
   data.state="idle";data.finished_at=undefined;
   data.results=rows().map((r:any)=>r.family==="IPv4"?{...r,checked_at:now}:{...r,status:"pending",delay_ms:undefined,samples:[]});
  }
  if(u.pathname.includes("/latency/snapshots/")){const at=Number(u.pathname.split("/").pop());data={state:"complete",rounds:3,finished_at:at,scheduled_at:at-1000,results:rows(at!==now)}}
  if(u.pathname.includes("/latency/history/"))data=[{at:now-3600000,status:"ok",delay_ms:42}];
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/server/7");return {posts:()=>posts,setFixture:(value:string)=>{fixture=value}};
}
for(const width of [320,390,768,1440])for(const offline of [false,true])test("independent latency view "+width+" "+offline,async({page},info)=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const state=await setup(page,"both","latency",offline),tabs=page.locator(".server-info-tab");
 await tabs.getByRole("button",{name:"延迟",exact:true}).click();
 const latency=page.locator("[data-server-latency]");await expect(latency).toBeVisible();await expect(page.locator("[data-server-connectivity]")).toHaveCount(0);
 await expect(latency.getByRole("button",{name:/广东/})).toContainText("35 ms");
 await latency.getByRole("button",{name:"联通",exact:true}).click();
 await expect(latency.getByRole("button",{name:/广东/})).toContainText("60 ms");
 await latency.getByRole("button",{name:/广东/}).click();await expect(latency.getByRole("region",{name:"延迟记录"})).toContainText("42 ms");
 expect(await latency.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await latency.screenshot({path:info.outputPath("latency.png")});
 const geometry=()=>tabs.getByRole("button").evaluateAll(buttons=>buttons.map(button=>{
  const r=button.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100);
 }));
 const stableGeometry=await geometry();
 await tabs.getByRole("button",{name:"延迟",exact:true}).click();await expect(page.locator("[data-server-connectivity]")).toBeVisible();await expect(latency).toHaveCount(0);
 await expect.poll(geometry).toEqual(stableGeometry);
 await tabs.getByRole("button",{name:"连通性",exact:true}).click();await expect(latency).toBeVisible();
 await expect.poll(geometry).toEqual(stableGeometry);
 expect(state.posts()).toBe(0);expect(errors).toEqual([]);
});
for(const mode of ["connectivity","latency","hidden"])test("single or hidden page "+mode,async({page})=>{
 const state=await setup(page,mode,mode==="connectivity"?"latency":"connectivity");
 const tabs=page.locator(".server-info-tab");
 if(mode==="hidden"){await expect(tabs.getByRole("button",{name:/^(连通性|延迟)$/})).toHaveCount(0)}else{
  const label=mode==="latency"?"延迟":"连通性";await tabs.getByRole("button",{name:label,exact:true}).click();await tabs.getByRole("button",{name:label,exact:true}).click();await expect(tabs.getByRole("button",{name:label,exact:true})).toBeVisible();
  await expect(page.locator(mode==="latency"?"[data-server-latency]":"[data-server-connectivity]")).toBeVisible();
 }
 expect(state.posts()).toBe(0);
});

for(const width of [390,1440])test("fastest carrier only after a valid result "+width,async({page},info)=>{
 test.setTimeout(90000);
 await page.setViewportSize({width,height:900});
 const state=await setup(page,"both","latency",false,"pending");
 const panel=page.locator("[data-server-latency]");
 const open=async()=>{await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();await expect(panel).toBeVisible()};
 await open();
 await expect(panel.locator("[data-latency-carrier]")).toHaveCount(0);
 await expect(panel.getByRole("button",{name:/广东/})).toContainText("未检测");
 await panel.screenshot({path:info.outputPath("fastest-before-detection.png")});
 for(const carrier of ["电信","联通","移动"]){
  await panel.getByRole("button",{name:carrier,exact:true}).click();
  await expect(panel.getByRole("button",{name:/广东/}).locator("[data-latency-carrier]")).toHaveText(carrier);
 }
 for(const fixture of ["running","timeout","zero","complete"]){
  state.setFixture(fixture);await page.reload();await open();
  const cell=panel.getByRole("button",{name:/广东/});
  if(fixture==="running"||fixture==="timeout"){
   await expect(panel.locator("[data-latency-carrier]")).toHaveCount(0);
   await expect(cell).toContainText(fixture==="running"?"检测中":"超时");
  }else{
   await expect(cell.locator("[data-latency-carrier]")).toHaveText("电信");
   await expect(cell).toContainText(fixture==="zero"?"0 ms":"35 ms");
   if(fixture==="complete")await expect(panel.getByRole("button",{name:/海南/}).locator("[data-latency-carrier]")).toHaveCount(0);
  }
  expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 }
 expect(state.posts()).toBe(0);
});

for(const width of [320,390,768,1440])test("dual stack immutable snapshot layout "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const state=await setup(page,"both","latency",false,"complete",["IPv4","IPv6"],true);
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]"),cell=panel.getByRole("button",{name:/广东/});
 await expect(cell).toContainText("35 ms");
 await panel.getByRole("button",{name:"IPv6",exact:true}).click();await expect(cell).toContainText("135 ms");
 const timeline=panel.getByRole("navigation",{name:"延迟历史快照"});
 await expect(timeline.getByRole("button")).toHaveCount(3);
 await timeline.getByRole("button").nth(1).click();await expect(cell).toContainText("111 ms");
 await expect(panel.locator("[data-latency-summary]")).toContainText("检测时间");
 await panel.getByRole("button",{name:"IPv4",exact:true}).click();await expect(cell).toContainText("11 ms");
 await cell.click();await expect(panel.getByRole("region",{name:"延迟记录"})).toContainText("当前为所选快照");
 await expect(panel.getByRole("region",{name:"延迟记录"})).not.toContainText("42 ms");
 await panel.screenshot({path:info.outputPath("dual-snapshot.png")});
 expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 expect(await panel.locator("[data-latency-header]").evaluate(e=>{
  const box=e.getBoundingClientRect();
  return [...e.children].every(child=>{const r=child.getBoundingClientRect();return r.width>0&&r.left>=box.left-1&&r.right<=box.right+1});
 })).toBe(true);
 const snapshotsBox=await panel.locator("[data-latency-snapshots]").boundingBox(),filterBox=await panel.locator('[aria-label="运营商筛选"]').boundingBox();
 const summaryBox=await panel.locator("[data-latency-summary]").boundingBox();
 if(width>=640){
  expect(snapshotsBox!.x).toBeGreaterThanOrEqual(filterBox!.x+filterBox!.width);
  expect(Math.abs((snapshotsBox!.y+snapshotsBox!.height/2)-(filterBox!.y+filterBox!.height/2))).toBeLessThan(2);
 }else{
  expect(snapshotsBox!.x).toBeGreaterThanOrEqual(summaryBox!.x+summaryBox!.width);
  expect(snapshotsBox!.y+snapshotsBox!.height).toBeLessThanOrEqual(filterBox!.y+1);
  expect(Math.abs((snapshotsBox!.y+snapshotsBox!.height/2)-(summaryBox!.y+summaryBox!.height/2))).toBeLessThan(2);
  expect(await timeline.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
  expect(await timeline.evaluate(e=>[...e.children].every(c=>c.getBoundingClientRect().width<=e.clientWidth+1))).toBe(true);
 }
 if(width===1440){
  const items=await panel.locator("[data-latency-summary] p").evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width}}));
  expect(Math.abs(items[0].y-items[1].y)).toBeLessThan(2);
  expect(items[1].x).toBeGreaterThan(items[0].x+items[0].width);
 }
 await timeline.getByRole("button").first().click();await expect(cell).toContainText("35 ms");
 await panel.getByRole("button",{name:"IPv6",exact:true}).click();await expect(cell).toContainText("135 ms");
 await expect(panel.getByRole("button",{name:"本地检测",exact:true})).toHaveCount(0);
 expect(state.posts()).toBe(0);expect(errors).toEqual([]);
});
for(const family of ["IPv4","IPv6"])test("single family availability "+family,async({page})=>{
 const state=await setup(page,"both","latency",false,"complete",[family]);
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]");
 await expect(panel.getByRole("button",{name:family,exact:true})).toHaveAttribute("aria-pressed","true");
 await expect(panel.getByRole("button",{name:family==="IPv4"?"IPv6":"IPv4",exact:true})).toHaveCount(0);
 await expect(panel.getByRole("button",{name:/广东/})).toContainText(family==="IPv6"?"135 ms":"35 ms");
 expect(state.posts()).toBe(0);
});
test("expired snapshot does not silently display latest",async({page})=>{
 const state=await setup(page,"both","latency",false,"complete",["IPv4"],true);
 await page.route("**/latency/snapshots/*",r=>r.fulfill({status:400,json:{success:false,error:"expired"}}));
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]");
 await panel.getByRole("navigation",{name:"延迟历史快照"}).getByRole("button").nth(1).click();
 await expect(panel.getByRole("alert")).toContainText("快照不存在");
 await expect(panel.getByRole("button",{name:/广东/})).toHaveCount(0);
 await panel.getByRole("button",{name:"返回最新",exact:true}).click();
 await expect(panel.getByRole("button",{name:/广东/})).toContainText("35 ms");
 expect(state.posts()).toBe(0);
});

test("adding IPv6 preserves IPv4 last check time without inventing IPv6 history",async({page})=>{
 const state=await setup(page,"both","latency",false,"upgrade",["IPv4","IPv6"]);
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]");
 await expect(panel.locator("[data-latency-summary]")).not.toContainText("暂无记录");
 await expect(panel.getByRole("button",{name:/广东/})).toContainText("35 ms");
 await panel.getByRole("button",{name:"IPv6",exact:true}).click();
 await expect(panel.locator("[data-latency-summary]")).toContainText("暂无记录");
 await expect(panel.getByRole("button",{name:/广东/})).toContainText("未检测");
 await expect(panel.locator("[data-latency-carrier]")).toHaveCount(0);
 expect(state.posts()).toBe(0);
});

test("IPv6 failure never reuses successful IPv4 results",async({page})=>{
 const state=await setup(page,"both","latency",false,"ipv6-failure",["IPv4","IPv6"]);
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]"),cell=panel.getByRole("button",{name:/广东/});
 await expect(cell).toContainText("35 ms");
 await panel.getByRole("button",{name:"IPv6",exact:true}).click();
 await expect(cell).toContainText("超时");
 await expect(cell).not.toContainText("35 ms");
 await expect(panel.locator("[data-latency-summary]")).toContainText("0/3");
 await expect(panel.locator("[data-latency-carrier]")).toHaveCount(0);
 await panel.getByRole("button",{name:"IPv4",exact:true}).click();
 await expect(cell).toContainText("35 ms");
 await expect(panel.locator("[data-latency-summary]")).toContainText("2/3");
 expect(state.posts()).toBe(0);
});

for(const width of [390,1440])test("manual results never enter snapshot history "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 const state=await setup(page,"both","latency",false,"complete",["IPv4","IPv6"]);
 const open=async()=>page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 await open();
 const panel=page.locator("[data-server-latency]");
 await expect(panel.getByRole("button",{name:/广东/})).toContainText("35 ms");
 await expect(panel.locator("[data-latency-snapshots]")).toHaveCount(0);
 await panel.getByRole("button",{name:"立即检测",exact:true}).click();
 await expect.poll(state.posts).toBe(1);
 await expect(panel.locator("[data-latency-snapshots]")).toHaveCount(0);
 await panel.screenshot({path:info.outputPath("manual-no-history.png")});
});
for(const width of [390,1440])test("only automatic snapshots survive a later manual result "+width,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 const state=await setup(page,"both","latency",false,"manual-after-auto",["IPv4","IPv6"],true);
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]"),nav=panel.getByRole("navigation",{name:"延迟历史快照"}),cell=panel.getByRole("button",{name:/广东/});
 await expect(cell).toContainText("35 ms");
 await expect(nav.getByRole("button")).toHaveCount(2);
 await expect(nav.locator('[aria-pressed="true"]')).toHaveCount(0);
 await expect(nav).not.toContainText("手动检测");
 await nav.getByRole("button").first().click();await expect(cell).toContainText("11 ms");
 await panel.getByRole("button",{name:"IPv6",exact:true}).click();await expect(cell).toContainText("111 ms");
 await expect(nav.getByRole("button").first()).toHaveAttribute("aria-pressed","true");
 await panel.getByRole("button",{name:"IPv4",exact:true}).click();await expect(cell).toContainText("11 ms");
 await panel.screenshot({path:info.outputPath("automatic-history.png")});
 expect(state.posts()).toBe(0);
});
test("historical IPv6 stays viewable after the live node becomes IPv4-only",async({page})=>{
 const state=await setup(page,"both","latency",false,"historical-ipv6",["IPv4","IPv6"],true);
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]"),cell=panel.getByRole("button",{name:/广东/}),nav=panel.getByRole("navigation",{name:"延迟历史快照"});
 await expect(panel.getByRole("button",{name:"IPv6",exact:true})).toHaveCount(0);
 await nav.getByRole("button").nth(1).click();await expect(cell).toContainText("11 ms");
 await panel.getByRole("button",{name:"IPv6",exact:true}).click();await expect(cell).toContainText("111 ms");
 await expect(nav.getByRole("button").nth(1)).toHaveAttribute("aria-pressed","true");
 await panel.getByRole("button",{name:"IPv4",exact:true}).click();await expect(cell).toContainText("11 ms");
 expect(state.posts()).toBe(0);
});

for(const width of [390,1440])test("empty automatic history is not a request error "+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 const errors:string[]=[];page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
 await setup(page,"both","latency",false,"complete",["IPv4","IPv6"]);
 await page.route("**/latency/history/*",r=>r.fulfill({json:{success:true}}));
 await page.locator(".server-info-tab").getByRole("button",{name:"延迟",exact:true}).click();
 const panel=page.locator("[data-server-latency]");
 await panel.getByRole("button",{name:/广东/}).click();
 await expect(panel.getByRole("region",{name:"延迟记录"})).toContainText("暂无历史记录");
 await expect(panel.getByRole("alert")).toHaveCount(0);
 await expect(panel.locator("[data-latency-snapshots]")).toHaveCount(0);
 expect(errors.filter(e=>e.includes("Query data cannot be undefined"))).toEqual([]);
});
