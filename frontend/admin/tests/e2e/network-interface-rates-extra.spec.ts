import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
const anchor=Date.parse("2026-10-28T08:00:00+08:00");
const metric=(name:string,dir:string)=>"nic_"+Buffer.from(name).toString("hex")+"_"+dir+"_speed";
async function setup(page:Page,variant:string,theme="light",role:number|null=0){
 const origin=process.env[variant==="default"?"NIC_USER_URL":"NIC_DORAEMON_URL"]!;
 await page.clock.setFixedTime(new Date(anchor));
 await page.addInitScript(({theme})=>{
  localStorage.setItem("language","zh-CN");localStorage.setItem("vite-ui-theme",theme);
  localStorage.setItem("doraemon-ui-theme",theme);localStorage.setItem("doraemon-sky",theme);
 },{theme});
 const state={role,offline:false,mode:"normal",requests:[] as string[],sockets:[] as WebSocketRoute[],count:0,
  names:["eth0","eth1"],tick:()=>{},held:[] as (()=>void)[]};
 const send=(ws:WebSocketRoute)=>ws.send(JSON.stringify({now:anchor+state.count*3000,online:state.offline?0:1,servers:[createServer({
  id:7,name:"网卡速率测试",last_active:state.offline?"0001-01-01T00:00:00Z":new Date(anchor+state.count*3000).toISOString(),
  state:{cpu:12,net_out_speed:3*1024**2,net_in_speed:4*1024**2,tcp_conn_count:27,udp_conn_count:3,
   network_interfaces:state.names.map((name,i)=>({name,available:true,in_speed:(i?3:1)*1024**2,out_speed:(i?1:2)*1024**2}))} as any
 })]}));
 state.tick=()=>{state.count++;state.sockets.forEach(send)};
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{state.sockets.push(ws);send(ws)});
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/"))return route.continue();
  state.requests.push(route.request().method()+" "+u.pathname+u.search);
  let data:any=[];
  if(u.pathname==="/api/v1/profile"){
   if(state.role===null)return route.fulfill({json:{error:"ApiErrorUnauthorized"}});
   data={id:1,username:"fixture",role:state.role};
  } else if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"网卡速率测试",show_network_in_detail:false,
   appearance_config:'{"version":1,"enabled":false,"features":{}}',doraemon_appearance_config:'{"version":1,"enabled":false,"features":{}}'}};
  else if(u.pathname.endsWith("/last-report")){
   const saved=createServer({id:7,state:{net_in_speed:4*1024**2,net_out_speed:3*1024**2,
    network_interfaces:[{name:"eth0",in_speed:1024**2,out_speed:2*1024**2,available:true},{name:"eth1",in_speed:3*1024**2,out_speed:1024**2,available:true}]} as any});
   const metrics:any={cpu:12,memory:128,disk:256,swap:0,net_in_speed:4*1024**2,net_out_speed:3*1024**2,tcp_conn:27,udp_conn:3,process_count:90};
   for(const n of saved.state.network_interfaces!) {metrics[metric(n.name,"in")]=n.in_speed;metrics[metric(n.name,"out")]=n.out_speed}
   data={server_id:7,tsdb_enabled:true,history_days:30,snapshot_seconds:60,last_report_at:anchor,
    snapshot:{at:anchor,host:saved.host,state:saved.state},metrics,
    recent:Object.fromEntries(Object.entries(metrics).map(([key,value])=>[key,Array.from({length:8},(_,i)=>({ts:anchor-21000+i*3000,value}))]))};
  }
  else if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  else if(u.pathname.endsWith("/metrics")){
   const key=u.searchParams.get("metric")||"",nic=key.startsWith("nic_");
   if(nic&&state.mode==="error")return route.fulfill({status:503,json:{success:false}});
   if(nic&&state.mode==="slow")await new Promise<void>(resolve=>state.held.push(resolve));
   const value=key.includes("65746830")?2:key.includes("65746831")?7:10;
   data={data_points:Array.from({length:nic&&state.mode==="empty"?0:8},(_,i)=>({ts:anchor-210000+i*30000,value:(value+i/10)*1024**2}))};
  } else if(u.pathname.endsWith("/connectivity"))data={server_id:7,state:"complete",online:true,can_run:false,results:[],groups:[]};
  else if(u.pathname.endsWith("/bgp"))data={server_id:7,online:true,can_run:false,state:"complete",available_families:[],topologies:[],history:[]};
  else if(u.pathname.endsWith("/streaming"))data={server_id:7,online:true,can_run:false,state:"complete",results:[]};
  await route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/server/7");
 await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6);
 for(let i=0;i<4;i++)state.tick();
 return state;
}
async function select(page:Page,scope:any,name:string){
 await scope.getByRole("button",{name:/选择网卡，当前：/}).click();
 await page.getByRole("menuitemradio",{name,exact:true}).click();
}
const card=(page:Page)=>page.locator(".server-charts>div").filter({has:page.getByRole("button",{name:"网络速率详细查看",exact:true})});

for(const variant of ["default","doraemon"]){
 test("NIC empty/error retry and all historical periods "+variant,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const state=await setup(page,variant),network=card(page);
  await page.getByText("1 天",{exact:true}).click();
  await expect(network.getByRole("button",{name:"网络速率详细查看"})).toBeEnabled();
  await network.getByRole("button",{name:"网络速率详细查看"}).click();
  const dialog=page.getByRole("dialog");
  state.mode="empty";await select(page,dialog,"eth0");
  await expect(dialog).toContainText("这个范围没有记录");
  state.mode="error";await select(page,dialog,"eth1");
  await expect(dialog.getByRole("alert")).toContainText("记录读取失败");
  state.mode="normal";await select(page,dialog,"全部");
  await expect(dialog.locator("[data-detail-readout]")).not.toContainText("暂无有效采样");
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  for(const [label,period] of [["7 天","7d"],["30 天","30d"]]){
   await page.getByText(label,{exact:true}).click();await select(page,network,"eth1");
   await expect.poll(()=>state.requests.some(x=>x.includes("metric="+metric("eth1","out"))&&x.includes("period="+period))).toBe(true);
   await expect(network.getByRole("button",{name:"网络速率详细查看"})).toBeEnabled();
  }
  await network.getByRole("button",{name:"网络速率详细查看"}).click();
  await expect(dialog.locator("[data-detail-readout]")).not.toContainText("暂无有效采样");
  await dialog.screenshot({path:info.outputPath("history-30d.png")});
 });
 test("NIC offline snapshot, reconnect and legacy Agent "+variant,async({page},info)=>{
  await page.setViewportSize({width:320,height:900});const state=await setup(page,variant);
  state.offline=true;state.tick();await expect(page.locator("[data-offline-summary]")).toBeVisible();
  const network=card(page);await select(page,network,"eth0");
  await network.getByRole("button",{name:"网络速率详细查看"}).click();
  const dialog=page.getByRole("dialog");await expect(dialog).toContainText("离线前的已保存记录");
  const before=await dialog.locator("[data-detail-readout]").innerText();
  await select(page,dialog,"eth1");await expect(dialog.locator("[data-detail-readout]")).not.toHaveText(before);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.screenshot({path:info.outputPath("offline-nic.png")});
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  state.offline=false;state.tick();await expect(page.locator("[data-offline-summary]")).toHaveCount(0);
  await expect(card(page).getByRole("button",{name:"选择网卡，当前：全部"})).toBeVisible();
  state.names=[];state.tick();await expect(page.getByRole("button",{name:/选择网卡/})).toHaveCount(0);
  await expect(card(page).getByRole("button",{name:"网络速率详细查看"})).toBeEnabled();
  expect(state.requests.filter(x=>!x.startsWith("GET ")&&x!=="POST /api/v1/refresh-token")).toEqual([]);
 });
}
