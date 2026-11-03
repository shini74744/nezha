import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
const anchor=Date.parse("2026-10-28T08:00:00+08:00");
const metric=(name:string,dir:string)=>"nic_"+Buffer.from(name).toString("hex")+"_"+dir+"_speed";
async function setup(page:Page,variant:string,theme="light",role:number|null=0){
 const origin=process.env[variant==="default"?"NIC_USER_URL":"NIC_DORAEMON_URL"]!;
 await page.clock.setFixedTime(new Date(anchor));
 await page.addInitScript(({theme})=>{
  localStorage.setItem("language","zh-CN");localStorage.setItem("vite-ui-theme",theme);
  localStorage.setItem("doraemon-ui-theme",theme);localStorage.setItem("doraemon-sky",theme);
 },{theme});
 const state={home:["eth0"],role,mode:"normal",requests:[] as string[],sockets:[] as WebSocketRoute[],count:0,
  names:["eth0","eth1"],tick:()=>{},held:[] as (()=>void)[]};
 const send=(ws:WebSocketRoute)=>ws.send(JSON.stringify({now:anchor+state.count*3000,online:1,servers:[createServer({
  id:7,home_network:{interfaces:state.role===0?state.home:undefined,rates_available:true,counters_available:true,in_speed:1024**2,out_speed:2*1024**2,in_transfer:100,out_transfer:200},name:"网卡速率测试",last_active:new Date(anchor+state.count*3000).toISOString(),
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

for(const variant of ["default","doraemon"])for(const width of [320,390,1440])test("home default and temporary switching "+variant+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const state=await setup(page,variant),network=card(page);
 await expect(network.getByRole("button",{name:"选择网卡，当前：eth0"})).toBeVisible();
 await select(page,network,"eth1");
 state.tick();
 await expect(network.getByRole("button",{name:"选择网卡，当前：eth1"})).toBeVisible();
 state.home=["eth0","eth1"];state.tick();
 await expect(network.getByRole("button",{name:"选择网卡，当前：所选合计"})).toBeVisible();
 await network.getByRole("button",{name:"网络速率详细查看"}).click();
 const dialog=page.getByRole("dialog");
 await expect(dialog.getByRole("button",{name:"选择网卡，当前：所选合计"})).toBeVisible();
 await select(page,dialog,"eth0");
 await expect(dialog.getByRole("button",{name:"选择网卡，当前：eth0"})).toBeVisible();
 await select(page,dialog,"所选合计");
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await dialog.screenshot({path:info.outputPath("home-detail.png")});
 await dialog.getByRole("button",{name:"Close",exact:true}).click();
 await page.getByText("1 天",{exact:true}).click();
 await expect.poll(()=>state.requests.some(x=>x.includes("metric="+metric("eth1","out")))).toBe(true);
 await expect.poll(()=>state.requests.some(x=>x.includes("metric="+metric("eth0","out")))).toBe(true);
 await network.getByRole("button",{name:"网络速率详细查看"}).click();
 await expect(page.getByRole("dialog")).toBeVisible();
 await select(page,page.getByRole("dialog"),"全部");
 expect(state.requests.filter(x=>!x.startsWith("GET ")&&x!=="POST /api/v1/refresh-token")).toEqual([]);
 expect(errors).toEqual([]);
});
