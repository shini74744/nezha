import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
import fs from "node:fs";
const paper=JSON.parse(fs.readFileSync(new URL("../../../shared/paper-defaults.json",import.meta.url),"utf8"));
test.use({ignoreHTTPSErrors:true});
const origin=process.env.PAPER_URL || "https://127.0.0.1:18511";
async function setup(page:Page,color="light",role:number|null=0){
 const now=Date.now();
 const state={sockets:[] as WebSocketRoute[],servers:[
  createServer({id:7,name:"香港 · HKT 家宽母机",country_code:"HK",last_active:new Date(now).toISOString(),host:{mem_total:16*1024**3,disk_total:500*1024**3},state:{cpu:28.5,mem_used:6*1024**3,disk_used:86*1024**3,network_interfaces:[{name:"ens18",available:true,in_speed:1024**2,out_speed:2*1024**2},{name:"wg0",available:true,in_speed:3*1024**2,out_speed:1024**2}] as any}}),
  createServer({id:8,name:"东京 · Sakura Cloud",country_code:"JP",last_active:new Date(now).toISOString(),state:{cpu:43}}),
  createServer({id:9,name:"洛杉矶 · DMIT.LAX.AN4.Pro.MALIBU",country_code:"US",last_active:new Date(now).toISOString(),state:{cpu:9}}),
  createServer({id:10,name:"新加坡 · StarHub",country_code:"SG",last_active:"2020-01-01T00:00:00Z"}),
  createServer({id:11,name:"首尔 · 韩国节点",country_code:"KR",last_active:new Date(now).toISOString(),state:{cpu:61}}),
  createServer({id:12,name:"法兰克福 · 欧洲节点",country_code:"DE",last_active:new Date(now).toISOString(),state:{cpu:17}}),
 ],config:structuredClone(paper),requests:[] as string[]};
 await page.addInitScript(({color})=>{localStorage.setItem("paper-ui-theme",color);localStorage.setItem("language","zh-CN");localStorage.setItem("showMap","1");localStorage.setItem("showServices","0");localStorage.setItem("inline","0")},{color});
 let seq=0;
 const tick=()=>{const stamp=Math.max(Date.now(),now+(seq++)*3000);for(const s of state.servers)if(s.id!==10)s.last_active=new Date(stamp).toISOString();state.sockets.forEach(ws=>ws.send(JSON.stringify({now:stamp,servers:state.servers,online:5})))};

 await page.routeWebSocket("**/api/v1/ws/server",ws=>{state.sockets.push(ws);tick()});
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/"))return route.continue();
  state.requests.push(route.request().method()+" "+u.pathname+u.search);
  let data:any=[];
  if(u.pathname==="/api/v1/profile")return route.fulfill({status:role===null?401:200,json:role===null?{success:false,error:"ApiErrorUnauthorized"}:{success:true,data:{id:1,username:"test",role}}});
  if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"纸间 · 云端观测",custom_code:"<script>window.__legacyExecuted=true</script>",user_template:"paper-dist",show_network_in_detail:false,appearance_config:JSON.stringify(state.config)}};
  if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  if(u.pathname.endsWith("/metrics"))data={data_points:Array.from({length:10},(_,i)=>({ts:now-270000+i*30000,value:(1+i/10)*1024**2}))};
  if(u.pathname.endsWith("/last-report"))data=null;
  if(u.pathname.endsWith("/connectivity"))data={server_id:7,state:"complete",online:true,can_run:false,results:[],groups:[]};
  if(u.pathname.endsWith("/bgp"))data={server_id:7,state:"complete",online:true,can_run:false,available_families:[],topologies:[],history:[]};
  if(u.pathname.endsWith("/streaming"))data={server_id:7,state:"complete",online:true,can_run:false,results:[]};
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/");
 await expect(page.locator("[data-server-card]")).toHaveCount(6,{timeout:30000});
 return {state,tick};
}
for(const width of [320,390,768,1440])for(const color of ["light","dark"]){
 test("paper pages, map, live updates, detail and dialog "+width+" "+color,async({page},info)=>{
  test.setTimeout(120000);await page.setViewportSize({width,height:950});
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const {state,tick}=await setup(page,color);
  await expect(page.locator("html")).toHaveAttribute("data-theme-variant","paper");
  await expect(page.getByRole("heading",{name:"云端观测手记"})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__legacyExecuted)).toBeUndefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if([390,1440].includes(width))await page.screenshot({path:info.outputPath("paper-home.png"),fullPage:true});
  await page.locator('[data-region="HK"]').focus();await page.keyboard.press("Enter");
  await expect(page.getByTestId("map-tooltip")).toContainText("香港 · HKT");
  await page.getByTestId("map-tooltip").getByRole("button",{name:"关闭"}).click();
  state.servers[0].name="香港 · 已实时更新";tick();
  await expect(page.locator("[data-server-card]").filter({hasText:"香港 · 已实时更新"})).toBeVisible();
  await page.locator("[data-server-card]").filter({hasText:"香港 · 已实时更新"}).click();
  await expect(page.getByRole("heading",{name:"运行详情",exact:true})).toBeVisible();
  const charts=page.locator(".server-charts");
  await expect(charts.locator(".chart-detail-open")).toHaveCount(6,{timeout:30000});
  for(let i=0;i<4;i++){tick();await page.waitForTimeout(50)}
  const network=charts.locator(":scope>div").filter({has:page.getByRole("button",{name:"网络速率详细查看",exact:true})});
  await network.getByRole("button",{name:/选择网卡/}).click();
  await page.getByRole("menuitemradio",{name:"ens18",exact:true}).click();
  await expect(network.getByRole("button",{name:"选择网卡，当前：ens18"})).toBeVisible();
  await network.getByRole("button",{name:"网络速率详细查看",exact:true}).click();
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  if([390,1440].includes(width))await dialog.screenshot({path:info.outputPath("paper-chart.png")});
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole("link",{name:"返回目录",exact:true}).click();
  await expect(page.locator("[data-server-card]")).toHaveCount(6,{timeout:30000});
  expect(state.requests.filter(r=>!r.startsWith("GET ")&&!r.startsWith("POST /api/v1/refresh-token"))).toEqual([]);
  expect(errors).toEqual([]);
 });
}
test("paper hides login on both layouts and keeps guest NIC data private",async({page})=>{
 test.setTimeout(120000);
 const {state}=await setup(page,"light",null);
 state.config.features.hideControls.enabled=true;state.config.features.hideControls.login=true;
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});await page.reload();
  await expect(page.locator("[data-server-card]")).toHaveCount(6,{timeout:30000});
  await expect(page.locator('a[href="/dashboard"]')).toHaveCount(0);
 }
 await page.goto(origin+"/server/7");
 await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6,{timeout:30000});
 await expect(page.getByRole("button",{name:/选择网卡/})).toHaveCount(0);
});
