import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
import fs from "node:fs";
const paper=JSON.parse(fs.readFileSync(new URL("../../../shared/paper-defaults.json",import.meta.url),"utf8"));
test.use({ignoreHTTPSErrors:true});
const origin=process.env.PAPER_URL || "https://127.0.0.1:18511";
async function setup(page:Page,color="light",role:number|null=0){
 const now=Date.now();
 const state={sockets:[] as WebSocketRoute[],servers:[
  createServer({id:7,name:"香港 · HKT 家宽母机",country_code:"HK",public_note:JSON.stringify({planDataMod:{bandwidth:"1000Mbps",trafficVol:"1000GB / 月",IPv4:"1",IPv6:"1",extra:"香港家宽"}}),last_active:new Date(now).toISOString(),host:{mem_total:16*1024**3,disk_total:500*1024**3},state:{net_out_speed:3*1024**2,net_in_speed:4*1024**2,cpu:28.5,mem_used:6*1024**3,disk_used:86*1024**3,network_interfaces:[{name:"ens18",available:true,in_speed:1024**2,out_speed:2*1024**2},{name:"wg0",available:true,in_speed:3*1024**2,out_speed:1024**2}] as any}}),
  createServer({id:8,name:"东京 · Sakura Cloud",country_code:"JP",last_active:new Date(now).toISOString(),state:{cpu:43}}),
  createServer({id:9,name:"洛杉矶 · DMIT.LAX.AN4.Pro.MALIBU",country_code:"US",last_active:new Date(now).toISOString(),state:{cpu:9}}),
  createServer({id:10,name:"新加坡 · StarHub",country_code:"SG",last_active:"2020-01-01T00:00:00Z"}),
  createServer({id:11,name:"首尔 · 韩国节点",country_code:"KR",last_active:new Date(now).toISOString(),state:{cpu:61}}),
  createServer({id:12,name:"法兰克福 · 欧洲节点",country_code:"DE",last_active:new Date(now).toISOString(),state:{cpu:17}}),
 ],config:structuredClone(paper),mode:"normal",combined:false,requests:[] as string[]};
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
  if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"纸间 · 云端观测",custom_code:"<script>window.__legacyExecuted=true</script>",user_template:"paper-dist",show_network_in_detail:state.combined,appearance_config:JSON.stringify(state.config)}};
  if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  if(u.pathname==="/api/v1/server-traffic")data=Object.fromEntries(state.servers.map(s=>[String(s.id),{name:s.name,scope_key:s.home_network?.scope_key??"",quota_type:"limited",max:1000*1024**3,used:150*1024**3,in:100*1024**3,out:50*1024**3,direction:"2",reset_day:1,from:new Date(now-86400000).toISOString(),to:new Date(now+86400000*29).toISOString()}]));
  if(u.pathname.endsWith("/metrics")) {
   if(state.mode==="error")return route.fulfill({status:503,json:{success:false}});
   const metric=u.searchParams.get("metric")||"";
   const base=metric.includes("776730")?7:metric.includes("656e733138")?2:10;
   data={data_points:Array.from({length:state.mode==="empty"?0:10},(_,i)=>({ts:now-270000+i*30000,value:(base+i/10)*1024**2}))};
  }
  if(u.pathname==="/api/v1/server/7/service") {
   if(state.mode==="error")return route.fulfill({status:503,json:{success:false}});
   data=state.mode==="empty"?[]:["香港电信","东京线路","新加坡线路"].map((name,i)=>({monitor_id:i+1,monitor_name:name,display_index:3-i,server_id:7,server_name:state.servers[0].name,created_at:Array.from({length:60},(_,n)=>now-(60-n)*60000),avg_delay:Array.from({length:60},(_,n)=>40+i*25+Math.sin(n)*8),packet_loss:Array(60).fill(0)}));
  }
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

const rateCard=(page:Page)=>page.locator(".server-charts>[data-ui-card]").filter({has:page.getByRole("button",{name:"网络速率详细查看",exact:true})});
async function chooseNIC(page:Page,scope:ReturnType<Page["locator"]>,name:string) {
 await scope.getByRole("button",{name:/选择网卡/}).click();
 await page.getByRole("menuitemradio",{name,exact:true}).click();
}
for(const width of [390,1440])for(const color of ["light","dark"])test("Paper network values curves and history "+width+" "+color,async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:960});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const {state,tick}=await setup(page,color);
 await page.goto(origin+"/server/7");
 const card=rateCard(page);await expect(card).toBeVisible({timeout:30000});
 for(let i=0;i<6;i++){tick();await page.waitForTimeout(100)}
 await expect(card.locator("[data-network-rate]")).toHaveText(["3.00M/s","4.00M/s"]);
 await expect(card.locator(".recharts-line-curve")).toHaveCount(2,{timeout:15000});
 for(const curve of await card.locator(".recharts-line-curve").all()){
  expect((await curve.getAttribute("d"))?.length).toBeGreaterThan(10);
  expect(await curve.evaluate(el=>getComputedStyle(el).stroke)).not.toBe("none");
 }
 await chooseNIC(page,card,"ens18");
 await expect(card.locator("[data-network-rate]")).toHaveText(["2.00M/s","1.00M/s"]);
 await chooseNIC(page,card,"wg0");
 await expect(card.locator("[data-network-rate]")).toHaveText(["1.00M/s","3.00M/s"]);
 await card.getByRole("button",{name:"网络速率详细查看",exact:true}).click();
 const dialog=page.getByRole("dialog");
 await expect(dialog.locator("[data-detail-readout]")).toContainText("3.00");
 await expect(dialog.locator(".recharts-line-curve")).toHaveCount(2);
 await chooseNIC(page,dialog,"ens18");
 await expect(dialog.locator("[data-detail-readout]")).toContainText("2.00");
 await dialog.getByRole("button",{name:"Close",exact:true}).click();
 await page.getByRole("button",{name:"1 天",exact:true}).click();
 await expect.poll(()=>state.requests.some(x=>x.includes("metric=nic_656e733138_out_speed"))).toBe(true);
 await expect(card.locator(".recharts-line-curve")).toHaveCount(2);
 await card.getByRole("button",{name:"网络速率详细查看",exact:true}).click();
 await expect(dialog.locator("[data-detail-readout]")).toContainText("2.90");
 await dialog.screenshot({path:info.outputPath("paper-network-history.png")});
 await dialog.getByRole("button",{name:"Close",exact:true}).click();
 await page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true}).click();
 const monitor=page.locator("[data-server-network]");
 await expect(monitor.getByText("3 个监控服务")).toBeVisible();
 await expect(monitor.locator(".recharts-line-curve")).toHaveCount(3);
 await monitor.getByRole("button",{name:/香港电信/}).click();
 await expect(monitor.locator(".recharts-line-curve")).toHaveCount(1);
 await page.screenshot({path:info.outputPath("paper-monitor.png"),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

for(const mode of ["error","empty"])test("Paper network "+mode+" does not hide other monitoring",async({page})=>{
 test.setTimeout(120000);const {state,tick}=await setup(page);state.mode=mode;state.combined=true;
 await page.goto(origin+"/server/7");for(let i=0;i<4;i++)tick();
 await expect(rateCard(page).locator("[data-network-rate]")).toHaveText(["3.00M/s","4.00M/s"],{timeout:30000});
 const monitor=page.locator("[data-server-network]");
 if(mode==="error"){
  await expect(monitor.getByRole("alert")).toBeVisible({timeout:30000});
  state.mode="normal";await monitor.getByRole("button",{name:"重新加载",exact:true}).click();
  await expect(monitor.locator(".recharts-line-curve")).toHaveCount(3);
 }else await expect(monitor.getByRole("status")).toBeVisible();
 await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6);
});

test("Paper keeps the previous theme background and hover effects isolated",async({page})=>{
 test.setTimeout(90000);
 await page.addInitScript(()=>sessionStorage.setItem("savedBackgroundImage","https://old-theme.invalid/background.jpg"));
 const requests:string[]=[];page.on("request",r=>requests.push(r.url()));
 await setup(page);
 await page.locator("[data-server-card]").first().hover();
 await expect(page.locator("[data-glass-hover]")).toHaveCount(0);
 expect(requests.some(url=>url.includes("old-theme.invalid"))).toBe(false);
 expect(await page.evaluate(()=>sessionStorage.getItem("savedBackgroundImage"))).toBe("https://old-theme.invalid/background.jpg");
 await expect(page.locator(".paper-illustration")).toBeVisible();
 await expect(page.locator('img[alt="animated-man"]')).toHaveCount(0);
});

for(const width of [390,1440])test("Paper homepage cumulative traffic and selected NIC totals "+width,async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});
 const {state,tick}=await setup(page);
 const card=page.locator("[data-server-card]").filter({hasText:"香港 · HKT"});
 await expect(card.getByText("上传:2.00 GiB",{exact:true})).toBeVisible();
 await expect(card.getByText("下载:1.00 GiB",{exact:true})).toBeVisible();
 await expect(card.locator("[data-native-traffic]")).toContainText("150.00");
 state.servers[0].home_network={interfaces:["ens18"],scope_key:"nic-ens18",rates_available:true,counters_available:true,in_speed:1024**2,out_speed:2*1024**2,in_transfer:11*1024**3,out_transfer:22*1024**3};
 tick();
 await expect(card.getByText("上传:22.00 GiB",{exact:true})).toBeVisible();
 await expect(card.getByText("下载:11.00 GiB",{exact:true})).toBeVisible();
 await expect(card.getByText("2.00M/s",{exact:true})).toBeVisible();
 await expect(card.getByText("1.00M/s",{exact:true})).toBeVisible();
 await expect(card.getByText("正在更新流量")).toHaveCount(0,{timeout:10000});
 await card.screenshot({path:info.outputPath("paper-traffic-card.png")});
 await page.screenshot({path:info.outputPath("paper-complete-home.png"),fullPage:true});
 await card.click();
 await expect(rateCard(page).getByRole("button",{name:"选择网卡，当前：ens18"})).toBeVisible({timeout:30000});
 state.servers[0].home_network.interfaces=["ens18","wg0"];tick();
 await expect(rateCard(page).getByRole("button",{name:"选择网卡，当前：所选合计"})).toBeVisible();
 await expect(rateCard(page).locator("[data-network-rate]")).toHaveText(["3.00M/s","4.00M/s"]);
});

for (const width of [390,1440]) for (const color of ["light","dark"]) {
 test("pencil paper typography, contrast and stationery "+width+" "+color,async({page},info)=>{
  test.setTimeout(120000);
  await page.setViewportSize({width,height:950});
  const {state,tick}=await setup(page,color);
  await page.evaluate(()=>document.fonts.ready);
  const title=page.getByRole("heading",{name:"云端观测手记"});
  await expect(title).toHaveCSS("font-family",/DDnezha Paper Hand/);
  const client=await page.context().newCDPSession(page);
  await client.send("DOM.enable");await client.send("CSS.enable");
  const {root}=await client.send("DOM.getDocument");
  const {nodeId}=await client.send("DOM.querySelector",{nodeId:root.nodeId,selector:".paper-chapter h1"});
  const used=await client.send("CSS.getPlatformFontsForNode",{nodeId});
  expect(used.fonts.some((f:any)=>f.isCustomFont&&f.glyphCount>0&&f.familyName==="DDnezha Paper Hand")).toBe(true);
  const card=page.locator("[data-server-card]").first();
  const up=card.locator('[data-native-speed="up"]'),down=card.locator('[data-native-speed="down"]');
  expect(await up.evaluate(e=>getComputedStyle(e).color)).not.toBe(await down.evaluate(e=>getComputedStyle(e).color));
  for (const element of [up,down,card.locator(".text-muted-foreground").first()]) {
   const contrast=await element.evaluate(el=>{
    const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});
    const lum=(c:number[])=>.2126*c[0]+.7152*c[1]+.0722*c[2];
    const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(getComputedStyle(el.closest("[data-server-card]")!).backgroundColor));
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   });
   expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await expect(page.locator(".server-overview [data-network-direction=up]")).toHaveCSS("color",await up.evaluate(e=>getComputedStyle(e).color));
  await expect(page.locator(".server-overview [data-network-direction=down]")).toHaveCSS("color",await down.evaluate(e=>getComputedStyle(e).color));
  expect(await page.locator("main").evaluate(e=>getComputedStyle(e).backgroundImage)).toContain("svg");
  expect(await card.evaluate(e=>getComputedStyle(e).backgroundImage)).toContain("repeating-linear-gradient");
  const fonts=await page.evaluate(()=>performance.getEntriesByType("resource").filter((e:any)=>e.name.includes(".woff2")).map((e:any)=>({url:e.name,size:e.decodedBodySize})));
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((f:any)=>new URL(f.url).origin===locationOrigin())).toBe(true);
  function locationOrigin(){return new URL(origin).origin}
  expect(fonts.reduce((sum:number,f:any)=>sum+f.size,0)).toBeLessThan(1500000);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath("pencil-paper-home.png"),fullPage:true});
  await card.click();
  await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6,{timeout:30000});
  for(let i=0;i<4;i++){tick();await page.waitForTimeout(50)}
  await expect(page.locator("[data-network-rate]").first()).toBeVisible();
  await page.getByRole("button",{name:"网络速率详细查看",exact:true}).click();
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.screenshot({path:info.outputPath("pencil-paper-detail.png")});
 });
}
test("pencil paper stays usable when fonts are unavailable",async({page})=>{
 test.setTimeout(90000);
 await setup(page,"light");
 await page.route("**/*.woff2",r=>r.abort());
 await page.reload();
 await expect(page.locator("[data-server-card]")).toHaveCount(6,{timeout:30000});
 await expect(page.getByRole("heading",{name:"云端观测手记"})).toBeVisible();
 await page.locator("[data-server-card]").first().click();
 await expect(page.getByRole("heading",{name:"运行详情",exact:true})).toBeVisible();
});

for (const color of ["light","dark"]) test("pencil palette stays consistent with speed effects enabled "+color,async({page})=>{
 test.setTimeout(90000);
 const {state}=await setup(page,color);
 state.config.features.speed.enabled=true;
 await page.reload();
 await expect(page.locator("[data-server-card]")).toHaveCount(6,{timeout:30000});
 const card=page.locator("[data-server-card]").first();
 await expect(card.locator('[data-native-speed="up"]')).toBeVisible();
 for (const direction of ["up","down"]) {
  const value=card.locator('[data-native-speed="'+direction+'"]');
  const expected=await page.evaluate(d=>{const e=document.createElement("span");e.style.color="var(--paper-"+d+")";document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c},direction);
  await expect(value).toHaveCSS("color",expected);
  await expect(value).toHaveCSS("animation-name","none");
  await expect(page.locator('.server-overview [data-network-direction="'+direction+'"]')).toHaveCSS("color",expected);
 }
 const traffic=card.locator(".nz-traffic-used").first();
 const expected=await page.evaluate(()=>{const e=document.createElement("span");e.style.color="var(--paper-green)";document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c});
 await expect(traffic).toHaveCSS("color",expected);
});
