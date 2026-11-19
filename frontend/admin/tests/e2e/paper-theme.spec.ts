import {test,expect,type Page,type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
import fs from "node:fs";
const paper=JSON.parse(fs.readFileSync(new URL("../../../shared/paper-defaults.json",import.meta.url),"utf8"));
test.use({ignoreHTTPSErrors:true});
const origin=process.env.PAPER_URL || "https://127.0.0.1:18511";
async function setup(page:Page,color="light",role:number|null=0,bits=false){
 const now=Date.now();
 const state={sockets:[] as WebSocketRoute[],servers:[
  createServer({id:7,name:"香港 · HKT 家宽母机",country_code:"HK",public_note:JSON.stringify({planDataMod:{bandwidth:"1000Mbps",trafficVol:"1000GB / 月",IPv4:"1",IPv6:"1",extra:"香港家宽"}}),last_active:new Date(now).toISOString(),host:{mem_total:16*1024**3,disk_total:500*1024**3},state:{net_out_speed:3*1024**2,net_in_speed:4*1024**2,cpu:28.5,mem_used:6*1024**3,disk_used:86*1024**3,network_interfaces:[{name:"ens18",available:true,in_speed:1024**2,out_speed:2*1024**2},{name:"wg0",available:true,in_speed:3*1024**2,out_speed:1024**2}] as any}}),
  createServer({id:8,name:"东京 · Sakura Cloud",country_code:"JP",last_active:new Date(now).toISOString(),state:{cpu:43}}),
  createServer({id:9,name:"洛杉矶 · DMIT.LAX.AN4.Pro.MALIBU",country_code:"US",last_active:new Date(now).toISOString(),state:{cpu:9}}),
  createServer({id:10,name:"新加坡 · StarHub",country_code:"SG",last_active:"2020-01-01T00:00:00Z"}),
  createServer({id:11,name:"首尔 · 韩国节点",country_code:"KR",last_active:new Date(now).toISOString(),state:{cpu:61}}),
  createServer({id:12,name:"法兰克福 · 欧洲节点",country_code:"DE",last_active:new Date(now).toISOString(),state:{cpu:17}}),
 ],config:structuredClone(paper),monitorNames:["香港电信","东京线路","新加坡线路"],mode:"normal",combined:false,requests:[] as string[],offlineReport:null as any};
 if(!bits)state.config.features.speed.enabled=false;
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
   data=state.mode==="empty"?[]:state.monitorNames.map((name,i)=>({monitor_id:i+1,monitor_name:name,display_index:3-i,server_id:7,server_name:state.servers[0].name,created_at:Array.from({length:60},(_,n)=>now-(60-n)*60000),avg_delay:Array.from({length:60},(_,n)=>40+i*25+Math.sin(n)*8),packet_loss:Array(60).fill(0)}));
  }
  if(u.pathname.endsWith("/last-report"))data=state.offlineReport;
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
  await expect(page.getByRole("heading",{name:"服务器概览"})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__legacyExecuted)).toBeUndefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if([390,1440].includes(width))await page.screenshot({path:info.outputPath("paper-home.png"),fullPage:true});
  await page.locator('[data-region="HK"]').focus();await page.keyboard.press("Enter");
  await expect(page.getByTestId("map-tooltip")).toContainText("香港 · HKT");
  await page.getByTestId("map-tooltip").getByRole("button",{name:"关闭"}).click();
  state.servers[0].name="香港 · 已实时更新";tick();
  await expect(page.locator("[data-server-card]").filter({hasText:"香港 · 已实时更新"})).toBeVisible();
  const detailStart=Date.now();
  await page.locator("[data-server-card]").filter({hasText:"香港 · 已实时更新"}).click();
  await expect(page.getByRole("heading",{name:"运行详情",exact:true})).toBeVisible({timeout:30000});
  await info.attach("navigation-timing",{body:JSON.stringify({milliseconds:Date.now()-detailStart}),contentType:"application/json"});
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
  await page.getByRole("link",{name:"返回概览",exact:true}).click();
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
 await expect(card.locator(".recharts-line-curve")).toHaveCount(2,{timeout:30000});
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
 test("pencil paper typography, contrast and paper material "+width+" "+color,async({page},info)=>{
  test.setTimeout(120000);
  await page.setViewportSize({width,height:950});
  const {state,tick}=await setup(page,color);
  await page.evaluate(()=>document.fonts.ready);
  const title=page.getByRole("heading",{name:"服务器概览"});
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
  expect(await page.locator("main").evaluate(e=>getComputedStyle(e).backgroundImage)).toContain("paper-fiber");
  expect(await card.evaluate(e=>getComputedStyle(e).backgroundImage)).toContain("paper-fiber");
  const overviewBox=await page.locator(".server-overview").boundingBox();
  const iconBox=await page.getByRole("button",{name:"页面插画",exact:true}).boundingBox();
  expect(iconBox!.y+iconBox!.height).toBeLessThanOrEqual(overviewBox!.y);
  const texture=await page.evaluate(()=>performance.getEntriesByType("resource").filter((e:any)=>e.name.includes("paper-fiber")).map((e:any)=>({url:e.name,size:e.decodedBodySize})));
  expect(texture).toHaveLength(1);
  expect(new URL(texture[0].url).origin).toBe(new URL(origin).origin);
  expect(texture[0].size).toBeGreaterThan(1000);
  expect(texture[0].size).toBeLessThan(150000);
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
 await expect(page.getByRole("heading",{name:"服务器概览"})).toBeVisible();
 await page.locator("[data-server-card]").first().click();
 await expect(page.getByRole("heading",{name:"运行详情",exact:true})).toBeVisible({timeout:30000});
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

test("Paper remains usable without the optional material image",async({page})=>{
 test.setTimeout(90000);await setup(page);
 await page.route("**/*paper-fiber*",r=>r.abort());await page.reload();
 await expect(page.locator("[data-server-card]")).toHaveCount(6,{timeout:30000});
 await page.locator("[data-server-card]").first().click();
 await expect(page.getByRole("heading",{name:"运行详情",exact:true})).toBeVisible({timeout:30000});
 await expect(page.locator(".server-charts .chart-detail-open")).toHaveCount(6,{timeout:30000});
});

for(const width of [390,1440])test("Paper unit conversion across summary cards live and offline charts "+width,async({page},info)=>{
 test.setTimeout(180000);await page.setViewportSize({width,height:960});
 expect(paper.features.speed).toMatchObject({enabled:true,bits:true,overviewBits:true,animation:false,overviewAnimation:false});
 const {state,tick}=await setup(page,"light",0,true);
 const home=page.locator("[data-server-card]").filter({hasText:"香港 · HKT"});
 await expect(home.locator('[data-native-speed="up"]')).toHaveText("24.0Mbps");
 await expect(home.locator('[data-native-speed="down"]')).toHaveText("32.0Mbps");
 await expect(page.locator('.server-overview [data-native-speed="up"]')).toHaveText("88.0Mbps");
 await expect(page.locator('.server-overview [data-native-speed="down"]')).toHaveText("64.0Mbps");
 await expect(home.locator('[data-network-direction="up"]')).toContainText("GiB");
 await home.locator("[data-server-name]").click();
 const card=rateCard(page);await expect(card).toBeVisible({timeout:30000});
 for(let i=0;i<4;i++){tick();await page.waitForTimeout(50)}
 await expect(card.locator("[data-network-rate]")).toHaveText(["24.0Mbps","32.0Mbps"]);
 await chooseNIC(page,card,"ens18");
 await expect(card.locator("[data-network-rate]")).toHaveText(["16.0Mbps","8.00Mbps"]);
 await page.getByRole("button",{name:"1 天",exact:true}).click();
 await expect(card.locator(".recharts-line-curve")).toHaveCount(2,{timeout:30000});
 await card.getByRole("button",{name:"网络速率详细查看",exact:true}).click();
 await expect(page.getByRole("dialog").locator("[data-detail-readout]")).toContainText("23.2Mbps",{timeout:30000});
 await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
 state.config.features.speed.bits=false;
 await page.goto(origin+"/");await page.reload();
 await expect(home.locator('[data-native-speed="up"]')).toHaveText("3.00M/s",{timeout:30000});
 await expect(page.locator('.server-overview [data-native-speed="up"]')).toHaveText("88.0Mbps");
 state.config.features.speed.bits=true;
 state.config.features.speed.overviewBits=false;
 await page.reload();
 await expect(home.locator('[data-native-speed="up"]')).toHaveText("24.0Mbps",{timeout:30000});
 await expect(page.locator('.server-overview [data-native-speed="up"]')).toHaveText("11.00 MiB/s");
 const now=Date.now();
 state.offlineReport={server_id:10,tsdb_enabled:true,history_days:30,last_report_at:now-1000,snapshot:{at:now-1000,host:state.servers[0].host,state:state.servers[0].state},metrics:{net_out_speed:2*1024**2,net_in_speed:1024**2},recent:{net_out_speed:[0,1,2].map(i=>({ts:now-3000+i*1000,value:2*1024**2})),net_in_speed:[0,1,2].map(i=>({ts:now-3000+i*1000,value:1024**2}))}};
 await page.goto(origin+"/server/10");
 const offline=page.locator("[data-ui-card]").filter({has:page.getByRole("button",{name:"网络速率详细查看",exact:true})});
 await expect(offline).toContainText("16.0Mbps",{timeout:30000});
 await expect(offline).toContainText("8.00Mbps");
 await offline.getByRole("button",{name:"网络速率详细查看",exact:true}).click();
 await expect(page.getByRole("dialog").locator("[data-detail-readout]")).toContainText("16.0Mbps",{timeout:30000});
 await page.getByRole("dialog").screenshot({path:info.outputPath("paper-offline-units.jpg"),type:"jpeg",quality:75});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const [width,color] of [[320,"light"],[390,"dark"],[768,"light"],[1440,"light"]] as const) test("Paper margin and toolbar interactions "+width+" "+color,async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:950});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await setup(page,color,0,true);await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator(".paper-eraser")).toBeVisible();
 await expect(page.locator(".paper-binder-clip")).toBeVisible();
 for(const selector of [".paper-margin-pen",".paper-pencil-shavings",".paper-edge-index"]){
  if(width>=1024)await expect(page.locator(selector)).toBeVisible();else await expect(page.locator(selector)).toBeHidden();
 }
 for(const prop of await page.locator(".paper-desk-extras svg").all())await expect(prop).toHaveCSS("pointer-events","none");
 const clipBox=await page.locator(".paper-binder-clip").boundingBox();
 const headerBox=await page.locator(".paper-chapter").boundingBox();
 expect(clipBox!.y+clipBox!.height).toBeLessThan(headerBox!.y);

 if(width>=768)await expect(page.locator(".paper-short-ruler")).toBeVisible();else await expect(page.locator(".paper-short-ruler")).toBeHidden();
 if(width>=1024)await expect(page.locator(".paper-margin-pencil")).toBeVisible();else await expect(page.locator(".paper-margin-pencil")).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath("paper-framed-home.jpg"),type:"jpeg",quality:80});

 await expect(page.locator(".paper-tools-tray,.paper-tools-row,.paper-tools-margins")).toHaveCount(0);
 await expect(page.locator(".global-map-shell .paper-metal-clip")).toBeVisible();
 for(const tool of await page.locator(".paper-tool").all())await expect(tool).toHaveCSS("pointer-events","none");
 if(width>=1024)await expect(page.locator(".paper-writing-tools")).toBeVisible();else await expect(page.locator(".paper-writing-tools")).toBeHidden();
 await page.locator('.global-map-shell [data-region="HK"]').focus();await page.keyboard.press("Enter");
 await expect(page.getByTestId("map-tooltip")).toContainText("香港 · HKT");
 await page.getByTestId("map-tooltip").getByRole("button",{name:"关闭"}).click();
 const firstCard=page.locator(".server-card-list [data-server-card]").first();
 const upload=await firstCard.locator('[data-native-speed="up"]').boundingBox(),download=await firstCard.locator('[data-native-speed="down"]').boundingBox(),cardBox=await firstCard.boundingBox();
 expect(upload!.x+upload!.width).toBeLessThanOrEqual(download!.x+1);
 expect(download!.x+download!.width).toBeLessThanOrEqual(cardBox!.x+cardBox!.width);
 await page.locator(".server-card-list").screenshot({path:info.outputPath("paper-fixed-cards.jpg"),type:"jpeg",quality:80});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const eraser=page.getByRole("button",{name:"页面插画",exact:true});
 // Send a real five-click burst within the gesture window; repeated actionability waits can exceed it on the build host.
 await eraser.click({clickCount:5,delay:80});
 await expect(eraser).toHaveAttribute("aria-pressed","true");
 await page.getByRole("button",{name:"切换地区地图",exact:true}).click();
 await expect(page.getByRole("region",{name:"服务器分布",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"选择统计视图",exact:true}).click();
 await page.getByRole("menuitemradio").filter({hasText:/周期/}).click();
 await expect(page.locator('[data-statistics-view="cycle"]')).toBeVisible({timeout:30000});
 await page.getByRole("button",{name:"选择统计视图",exact:true}).click();
 await page.getByRole("menuitemradio").filter({hasText:/周期/}).click();
 await expect(page.locator('[data-statistics-view="cycle"]')).toHaveCount(0);
 await page.getByRole("button",{name:"切换卡片列表布局",exact:true}).click();
 await expect(page.locator(".server-inline-list")).toBeVisible();
 await page.getByRole("button",{name:"Sort metric",exact:true}).click();
 await page.getByRole("menuitemradio").filter({hasText:/CPU/}).click();
 const direction=page.getByRole("button",{name:"Toggle sort direction",exact:true});await expect(direction).toBeEnabled();
 const first=await page.locator(".server-inline-list [data-server-name]").first().textContent();
 await direction.click();
 await expect(page.locator(".server-inline-list [data-server-name]").first()).not.toHaveText(first!);
 await page.getByRole("button",{name:"切换卡片列表布局",exact:true}).click();
 await expect(page.locator(".server-card-list [data-server-card]")).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator(".server-overview-controls").screenshot({path:info.outputPath("paper-toolbar.jpg"),type:"jpeg",quality:85});
 expect(errors).toEqual([]);
});

for(const [width,color] of [[320,"light"],[390,"dark"],[1440,"light"],[1440,"dark"]] as const) test("Paper detail tape labels and chart stationery "+width+" "+color,async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const {state,tick}=await setup(page,color,0,true);state.combined=true;
 state.monitorNames=Array.from({length:18},(_,i)=>i===0?"很长的线路名称 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":"网络线路 "+(i+1));
 state.servers[0].host.cpu=["Intel(R) Xeon(R) Platinum 2 Virtual Core / long CPU description with 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
 tick();await page.locator("[data-server-card]").first().click();
 const summary=page.locator(".server-detail-overview");
 const charts=page.locator(".server-charts");
 await expect(charts.locator(".chart-detail-open")).toHaveCount(6,{timeout:30000});
 await page.evaluate(()=>document.fonts.ready);
 const labels=summary.locator(":scope>section>[data-ui-card]");
 expect(await labels.count()).toBeGreaterThan(8);
 for(const label of await labels.all()){
  expect(await label.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  expect(await label.evaluate(e=>getComputedStyle(e,"::before").content)).toBe('""');
 }
 expect(await summary.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await summary.screenshot({path:info.outputPath("paper-detail-labels.jpg"),type:"jpeg",quality:85});
 for(let i=0;i<6;i++){tick();await page.waitForTimeout(300)}
 const cpu=charts.locator(":scope>[data-ui-card]").first();
 await cpu.scrollIntoViewIfNeeded();
 expect(await cpu.evaluate(e=>getComputedStyle(e,"::before").pointerEvents)).toBe("none");
 expect(await cpu.evaluate(e=>getComputedStyle(e,"::before").height)).toBe("28px");
 expect(await cpu.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(await page.locator("main").evaluate(e=>getComputedStyle(e).backgroundColor));
 const plot=cpu.locator(".recharts-wrapper").first();const rect=await plot.boundingBox();
 await plot.hover({position:{x:rect!.width*.65,y:rect!.height*.5}});
 const tooltip=cpu.locator(".recharts-tooltip-wrapper").first();
 await expect(tooltip).toBeVisible();
 await expect(tooltip).toContainText("CPU");
 expect(await tooltip.locator(":scope>div").evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(color==="light"?"rgb(255, 253, 245)":"rgb(69, 65, 56)");
 await page.screenshot({path:info.outputPath("paper-drawing-charts.jpg"),type:"jpeg",quality:85});
 await page.getByRole("button",{name:"网络速率详细查看",exact:true}).click();
 await expect(page.getByRole("dialog")).toBeVisible();
 expect(await page.getByRole("dialog").evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
 const period=page.locator("[data-metric-period-selector]");
 await period.getByRole("button",{name:"1 天",exact:true}).click();
 await expect(period.getByRole("button",{name:"1 天",exact:true})).toHaveAttribute("aria-pressed","true");
 await expect(charts.locator(".chart-detail-open")).toHaveCount(6);
 await expect(page.locator("[data-network-period-selector]")).toBeVisible();
 const notes=page.locator("[data-network-note-list]>button");
 await expect(notes).toHaveCount(18);
 for(const note of await notes.all()){
  expect(await note.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  expect(await note.evaluate(e=>getComputedStyle(e,"::before").pointerEvents)).toBe("none");
  expect(await note.evaluate(e=>getComputedStyle(e,"::after").pointerEvents)).toBe("none");
 }
 await expect(page.locator("[data-network-note-header] .paper-metal-clip")).toBeVisible();
 await expect(page.locator("[data-network-note-header] .paper-metal-clip")).toHaveCSS("pointer-events","none");
 const peak=page.locator("[data-server-network] #Peak");
 const peakState=await peak.getAttribute("aria-checked");await peak.click();await expect(peak).toHaveAttribute("aria-checked",peakState==="true"?"false":"true");
 const selected=await notes.first().getAttribute("data-active");
 await notes.first().click();await expect(notes.first()).toHaveAttribute("data-active",selected==="true"?"false":"true");
 await page.locator("[data-network-note-header]").screenshot({path:info.outputPath("paper-network-notes.jpg"),type:"jpeg",quality:85});

 await page.locator("[data-network-period-selector] [data-period-option]").filter({hasText:"7 天"}).click();
 const tabStrip=page.locator(".server-info-tab");
 for(const tab of await tabStrip.getByRole("button").all()){
  const b=await tab.boundingBox();const parent=await tabStrip.boundingBox();
  expect(b!.x).toBeGreaterThanOrEqual(parent!.x-1);
  expect(b!.x+b!.width).toBeLessThanOrEqual(parent!.x+parent!.width+1);
 }
 const bgp=page.locator(".server-info-tab").getByRole("button",{name:"BGP",exact:true});
 await bgp.focus();await page.keyboard.press("Enter");await expect(bgp).toHaveAttribute("aria-pressed","true");
 const detail=page.locator(".server-info-tab").getByRole("button",{name:"详情",exact:true});
 await detail.click();await expect(charts.locator(".chart-detail-open")).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});


test("Paper quiet empty dark page without a stationery gallery",async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width:1440,height:950});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const {state,tick}=await setup(page,"dark",0,true);state.servers.length=0;tick();
 await expect(page.locator("[data-server-card]")).toHaveCount(0,{timeout:30000});
 await expect(page.locator(".paper-tools-tray,.paper-tools-row,.paper-tools-margins")).toHaveCount(0);
 const before=await page.evaluate(()=>document.documentElement.scrollHeight);
 await page.locator(".paper-writing-tools").evaluate(el=>(el as HTMLElement).style.display="none");
 expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBe(before);
 await page.locator(".paper-writing-tools").evaluate(el=>(el as HTMLElement).style.removeProperty("display"));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath("paper-empty-dark.jpg"),type:"jpeg",quality:80,fullPage:true});
 expect(errors).toEqual([]);
});
