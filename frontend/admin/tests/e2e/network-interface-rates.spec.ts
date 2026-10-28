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
 const state={role,mode:"normal",requests:[] as string[],sockets:[] as WebSocketRoute[],count:0,
  names:["eth0","eth1"],tick:()=>{},held:[] as (()=>void)[]};
 const send=(ws:WebSocketRoute)=>ws.send(JSON.stringify({now:anchor+state.count*3000,online:1,servers:[createServer({
  id:7,name:"网卡速率测试",last_active:new Date(anchor+state.count*3000).toISOString(),
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
for(const variant of ["default","doraemon"])for(const width of [320,390,844,1440])for(const theme of ["light","dark"]){
 test("NIC live/detail UI "+variant+" "+width+" "+theme,async({page},info)=>{
  await page.setViewportSize({width,height:width===844?390:900});
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const state=await setup(page,variant,theme),network=card(page);
  await expect(network.getByRole("button",{name:"选择网卡，当前：全部"})).toBeVisible();
  await network.scrollIntoViewIfNeeded();const before=await network.boundingBox();
  const tcp=page.locator(".server-charts>div").filter({has:page.getByText("TCP",{exact:true})});
  const tcpText=await tcp.innerText();
  await select(page,network,"eth0");
  await expect(network.getByRole("button",{name:"选择网卡，当前：eth0"})).toBeVisible();
  expect((await network.boundingBox())!.height).toBe(before!.height);
  expect(await network.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  for(const rate of await network.locator("[data-network-rate]").all()) {
   expect(await rate.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe("nowrap");
   expect((await rate.boundingBox())!.height).toBeLessThanOrEqual(20);
  }
  await network.screenshot({path:info.outputPath("network-card.png")});
  await network.getByRole("button",{name:"网络速率详细查看"}).click();
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
  const first=await dialog.locator("[data-detail-readout]").innerText();
  await select(page,dialog,"eth1");
  await expect(dialog.getByRole("button",{name:"选择网卡，当前：eth1"})).toBeVisible();
  await expect(dialog.locator("[data-detail-readout]")).not.toHaveText(first);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await tcp.innerText()).toBe(tcpText);
  await dialog.screenshot({path:info.outputPath("network-detail.png")});
  await select(page,dialog,"全部");
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  const long="USB-网卡-"+("very-long-interface-name-".repeat(3));
  state.names.push(long);state.tick();
  await network.getByRole("button",{name:/选择网卡/}).click();
  await expect(page.getByRole("menuitemradio",{name:long,exact:true})).toBeVisible();
  await page.getByRole("menuitemradio",{name:long,exact:true}).click();
  expect(await network.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(state.requests.filter(x=>!x.startsWith("GET ")&&x!=="POST /api/v1/refresh-token")).toEqual([]);
  expect(errors).toEqual([]);
 });
}
for(const variant of ["default","doraemon"]){
 test("NIC history switching permissions and stale requests "+variant,async({page})=>{
  await page.setViewportSize({width:390,height:900});const state=await setup(page,variant),network=card(page);
  await page.getByText("1 天",{exact:true}).click();
  await expect(network.getByRole("button",{name:"网络速率详细查看"})).toBeEnabled();
  await select(page,network,"eth0");
  await expect.poll(()=>state.requests.some(x=>x.includes("metric="+metric("eth0","out")))).toBe(true);
  await expect(network.getByRole("button",{name:"网络速率详细查看"})).toBeEnabled();
  await network.getByRole("button",{name:"网络速率详细查看"}).click();
  const dialog=page.getByRole("dialog");
  const first=await dialog.locator("[data-detail-readout]").innerText();
  state.mode="slow";await select(page,dialog,"eth1");
  await expect(dialog.getByRole("status")).toContainText("正在读取");
  await select(page,dialog,"全部");
  await expect(dialog.getByRole("button",{name:"选择网卡，当前：全部"})).toBeVisible();
  state.mode="normal";state.held.splice(0).forEach(resolve=>resolve());
  await expect(dialog.locator("[data-detail-readout]")).not.toHaveText(first);
  state.role=null;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(dialog).toHaveCount(0,{timeout:35000});
  await expect(network.getByRole("button",{name:/选择网卡/})).toHaveCount(0);
  expect(state.requests.filter(x=>!x.startsWith("GET ")&&x!=="POST /api/v1/refresh-token")).toEqual([]);
 });
 for(const role of [null,2])test("NIC entry hidden "+variant+" "+role,async({page})=>{
  await setup(page,variant,"light",role);
  await expect(page.getByRole("button",{name:/选择网卡/})).toHaveCount(0);
  await page.getByRole("button",{name:"网络速率详细查看"}).click();
  await expect(page.getByRole("dialog").getByRole("button",{name:/选择网卡/})).toHaveCount(0);
 });
}
