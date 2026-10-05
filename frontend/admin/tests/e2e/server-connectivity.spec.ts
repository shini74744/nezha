import {type Page,expect,test} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
import {readFileSync} from "node:fs";
const manifest = JSON.parse(readFileSync(new URL("../../../user/src/appearance/manifest.json", import.meta.url), "utf8")) as {key:string}[];
test.use({ignoreHTTPSErrors:true});
const catalog = JSON.parse(readFileSync(new URL("../../../../service/connectivity/catalog.json", import.meta.url), "utf8")) as {id:string; name:string; group:string; host:string}[];
async function setup(page:Page,theme:string,light=false,offline=false,owner=true,language="zh-CN",wallpaper=false) {
 const origin="https://127.0.0.1:"+(theme==="doraemon"?"18478":"18477"),now=Date.now();
 const server=createServer({id:7,name:"连通性测试节点",last_active:offline?"0001-01-01T00:00:00Z":new Date(now).toISOString()});
 const state={posts:0,gets:0,external:[] as string[],mode:"idle",readError:false,postError:false};
 const results=()=>catalog.map(({id,name,group,host},i)=>({id,name,group,host,
  phase:state.mode==="idle"?undefined:state.mode==="running"?(i===0?"running":i===1?"complete":"queued"):"complete",
  status:state.mode==="idle"||(state.mode==="running"&&i!==1)?"pending":i===7?"http_error":i===8?"timeout":i===9?"agent_timeout":"ok",delay_ms:state.mode==="idle"||(state.mode==="running"&&i!==1)||i===8||i===9?undefined:35+i*12,
  samples:state.mode==="idle"||(state.mode==="running"&&i!==1)?[]:Array.from({length:3},()=>({status:i===7?"http_error":i===8?"timeout":i===9?"agent_timeout":"ok",http_status:i===7?403:undefined,delay_ms:i===8||i===9?undefined:35+i*12}))}));
 const response=()=>({server_id:7,online:!offline,can_run:owner,state:state.mode,rounds:3,started_at:state.mode==="idle"?undefined:now-2000,finished_at:state.mode==="complete"?now:undefined,retry_at:state.mode==="complete"?now+60000:undefined,results:results()});
 await page.addInitScript(({light,language})=>{
  localStorage.setItem("language",language);localStorage.setItem("vite-ui-theme",light?"light":"dark");localStorage.setItem("doraemon-ui-theme",light?"light":"dark");localStorage.setItem("doraemon-sky",light?"light":"dark");
 },{light,language});
 await page.context().addCookies([{name:"nz-csrf",value:"mock-signed-token",url:origin}]);
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,servers:[server],online:offline?0:1})));
 await page.route("**/*",async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!==origin){state.external.push(u.href);return route.abort();}
  if(u.pathname==="/connectivity-wallpaper.svg") return route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="bg"><stop stop-color="#052e16"/><stop offset=".45" stop-color="#14532d"/><stop offset=".5" stop-color="#ecfccb"/><stop offset="1" stop-color="#f0fdf4"/></linearGradient></defs><rect width="1200" height="800" fill="url(#bg)"/><path d="M0 640L1200 80M0 710L1200 150" stroke="#c4a875" stroke-width="28"/></svg>'});
  if(!u.pathname.startsWith("/api/"))return route.continue();
  let data:any=[];
  if(u.pathname.endsWith("/connectivity")){
   if(req.method()==="POST"){
    state.posts++;expect(req.postData()).toBe(null);expect(req.headers()["x-csrf-token"]).toBe("mock-signed-token");
    if(state.postError)return route.fulfill({json:{success:false,error:"connectivity_busy"}});
    state.mode="running";
   }else{state.gets++;if(state.readError)return route.fulfill({json:{success:false,error:"test failure"}});}
   return route.fulfill({json:{success:true,data:response()}});
  }
  if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language,site_name:"测试面板",show_network_in_detail:true,appearance_config:JSON.stringify({version:1,enabled:wallpaper,features:{...Object.fromEntries(manifest.map(item=>[item.key,{enabled:false}])),background:{enabled:wallpaper,desktopMedia:[{type:"image",src:origin+"/connectivity-wallpaper.svg"}],mobileMedia:[{type:"image",src:origin+"/connectivity-wallpaper.svg"}],nightEnabled:false,lightOpacity:0.82,darkOpacity:0.82}}}),custom_code:""}};
  if(u.pathname==="/api/v1/profile"){
   if(!owner)return route.fulfill({status:401,json:{success:false,error:"unauthorized"}});
   data={id:1,role:0,username:"qa"};
  }
  if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  if(u.pathname.endsWith("/last-report"))data={server_id:7,tsdb_enabled:true,history_days:30,last_report_at:now-3600000,snapshot:{at:now-3600000,host:server.host,state:server.state},metrics:{cpu:12},recent:{cpu:[{ts:now-3600000,value:12}]}};
  if(u.pathname.endsWith("/metrics"))data={data_points:[]};
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/server/7");
 await page.locator(".server-info-tab").getByText(language==="en-US"?"Connectivity":"连通性",{exact:true}).click();
 return state;
}
for(const theme of ["default","doraemon"])for(const light of [false,true])for(const width of [320,390,768,1440]){
 test(`connectivity layout ${theme} ${light?"light":"dark"} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const state=await setup(page,theme,light),view=page.locator("[data-server-connectivity]");
  await expect(view.locator("[data-connectivity-target]")).toHaveCount(72);
  await expect(view.locator("[data-connectivity-group]")).toHaveCount(4);
  await expect(view.locator("img[data-connectivity-icon]")).toHaveCount(72);
  await expect.poll(() => view.locator("img[data-connectivity-icon]").evaluateAll((images) => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  for (const region of [{id:"china",size:12},{id:"japan",size:7},{id:"usa",size:36},{id:"global",size:17}]) {
   await expect(view.locator(`[data-connectivity-group="${region.id}"] [data-connectivity-target]`)).toHaveCount(region.size);
  }
  expect(state.posts).toBe(0);await expect(page.locator("[data-server-network]")).toHaveCount(0);
  await view.getByRole("button",{name:"开始检测",exact:true}).click();
  await expect(view.getByRole("button",{name:"检测中…",exact:true})).toBeDisabled();expect(state.posts).toBe(1);
  await expect(view.locator('[data-connectivity-phase="running"]')).toHaveCount(1);
  await expect(view.getByText("正在检测",{exact:true})).toBeVisible();
  await expect(view.getByText("排队中",{exact:true})).toHaveCount(70);
  await expect(view.getByText(/已有结果 1 项 · 检测中 1 项 · 排队 70 项/)).toBeVisible();
  state.mode="complete";
  await expect(view.getByRole("button",{name:/秒后可重测/})).toBeDisabled({timeout:10000});
  await expect(view.getByText("(HTTP 403)")).toBeVisible();
  await expect(view.getByText("请求超时",{exact:true})).toBeVisible();
  await expect(view.getByText("检测超时（3 秒未收到 Agent 回包）",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const cards=await view.locator("[data-connectivity-target]").evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}));
  expect(cards.every(r=>r.left>=0&&r.right<=width+1&&r.width>0)).toBe(true);
  await view.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("connectivity.png"),fullPage:true});
  expect(state.external.filter(url=>new URL(url).hostname==="ip.net.coffee" || catalog.some(target=>new URL(url).hostname===target.host))).toEqual([]);
  expect(errors).toEqual([]);
 });
}
test("guest and offline only read cache; reloading does not trigger probes",async({page})=>{
 const state=await setup(page,"default",false,true,false);state.mode="complete";await page.reload();
 await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
 const view=page.locator("[data-server-connectivity]");
 await expect(view.getByText(/节点当前离线/)).toBeVisible();await expect(view.getByText(/仅管理员或节点所属用户/)).toBeVisible();
 await expect(view.getByRole("button",{name:/开始检测|重新检测/})).toHaveCount(0);
 await expect(view.getByText("(HTTP 403)")).toBeVisible();expect(state.posts).toBe(0);
});
test("network/detail tabs still work with combined network; help and failure recovery",async({page})=>{
 const state=await setup(page,"default"),view=page.locator("[data-server-connectivity]");
 await view.getByRole("button",{name:"连通性说明",exact:true}).click();await expect(view.getByText(/不是 ICMP Ping/)).toBeVisible();
 state.postError=true;await view.getByRole("button",{name:"开始检测",exact:true}).click();await expect(view.getByRole("alert")).toHaveText(/当前检测任务较多/);
 await page.locator(".server-info-tab").getByText("网络",{exact:true}).click();await expect(page.locator("[data-server-network]")).toBeVisible();
 await expect(view).toHaveCount(0);await page.locator(".server-info-tab").getByText("详情",{exact:true}).click();await expect(page.locator(".server-charts")).toBeVisible();
 state.readError=true;await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();await expect(view.getByRole("alert")).toHaveText(/检测结果读取失败/);
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(0);state.readError=false;await view.getByRole("button",{name:"重新加载"}).click();
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(72);
  await expect(view.locator("[data-connectivity-group]")).toHaveCount(4);
  await expect(view.locator("img[data-connectivity-icon]")).toHaveCount(72);
  await expect.poll(() => view.locator("img[data-connectivity-icon]").evaluateAll((images) => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  for (const region of [{id:"china",size:12},{id:"japan",size:7},{id:"usa",size:36},{id:"global",size:17}]) {
   await expect(view.locator(`[data-connectivity-group="${region.id}"] [data-connectivity-target]`)).toHaveCount(region.size);
  }
});
test("English mobile tab labels and cards fit",async({page})=>{
 await page.setViewportSize({width:320,height:850});await setup(page,"default",true,false,true,"en-US");
 await expect(page.getByRole("heading",{name:"Node connectivity"})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const theme of ["default","doraemon"])for(const light of [false,true])test(`connectivity wallpaper ${theme} ${light}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:900});
 const state=await setup(page,theme,light,false,true,"zh-CN",true);
 const view=page.locator("[data-server-connectivity]");
 await expect(page.locator(theme==="doraemon"?".dora-scene":".nz-media")).toBeVisible();
 expect(await page.locator("html").evaluate(el=>el.classList.contains("dark"))).toBe(!light);
 await view.getByRole("button",{name:"开始检测",exact:true}).click();state.mode="complete";
 await expect(view.getByRole("button",{name:/秒后可重测/})).toBeDisabled({timeout:10000});
 await view.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("wallpaper.png"),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const tab=page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true});
 await tab.focus();await page.keyboard.press("Enter");await expect(page.locator("[data-server-network]")).toBeVisible();
 await page.locator(".server-info-tab").getByRole("button",{name:"连通性",exact:true}).focus();await page.keyboard.press("Space");
 await expect(view).toBeVisible();expect(state.posts).toBe(1);
});