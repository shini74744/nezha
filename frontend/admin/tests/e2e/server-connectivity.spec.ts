import {type Page,expect,test} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
import {readFileSync} from "node:fs";
const manifest = JSON.parse(readFileSync(new URL("../../../user/src/appearance/manifest.json", import.meta.url), "utf8")) as {key:string}[];
test.use({ignoreHTTPSErrors:true});
const catalog = JSON.parse(readFileSync(new URL("../../../../service/connectivity/catalog.json", import.meta.url), "utf8")) as {id:string; name:string; group:string; host:string}[];
async function setup(page:Page,theme:string,light=false,offline=false,owner=true,language="zh-CN",wallpaper=false,countryCode="us",disabled=false,clickTab=true) {
 const origin="https://127.0.0.1:"+(theme==="doraemon"?"18478":"18477"),now=Date.now();
 const server=createServer({id:7,name:"连通性测试节点",country_code:countryCode,connectivity_disabled:disabled,last_active:offline?"0001-01-01T00:00:00Z":new Date(now).toISOString()});
 const state={posts:0,postPaths:[] as string[],gets:0,external:[] as string[],override:null as any[]|null,latest:undefined as any,canBypass:false,fullBatch:true,mode:"idle",readError:false,postError:false,localMock:false,localDelay:0,localRequests:[] as {url:string;method:string;headers:Record<string,string>}[],redirectHeaders:[] as Record<string,string>[]};
 page.on("request",req=>{if(new URL(req.url()).pathname==="/__local-probe-redirect-test")void req.allHeaders().then(headers=>state.redirectHeaders.push(headers))});
 const results=()=>catalog.map(({id,name,group,host},i)=>({id,name,group,host,
  phase:state.mode==="idle"?undefined:state.mode==="running"?(i===0?"running":i===1?"complete":"queued"):"complete",
  status:state.mode==="idle"||(state.mode==="running"&&i!==1)?"pending":i===7?"http_error":i===8?"timeout":i===9?"agent_timeout":"ok",delay_ms:state.mode==="idle"||(state.mode==="running"&&i!==1)||i===8||i===9?undefined:35+i*12,
  samples:state.mode==="idle"||(state.mode==="running"&&i!==1)?[]:Array.from({length:3},()=>({status:i===7?"http_error":i===8?"timeout":i===9?"agent_timeout":"ok",http_status:i===7?403:undefined,delay_ms:i===8||i===9?undefined:35+i*12}))}));
 const response=()=>({full_batch:state.fullBatch,server_id:7,online:!offline,can_run:owner,can_bypass_cooldown:owner&&state.canBypass,state:state.mode,latest:state.latest,rounds:3,started_at:state.mode==="idle"?undefined:now-2000,finished_at:state.mode==="complete"?now:undefined,retry_at:state.mode==="complete"?now+60000:undefined,results:state.override??results()});
 await page.addInitScript(({light,language})=>{
  localStorage.setItem("language",language);localStorage.setItem("vite-ui-theme",light?"light":"dark");localStorage.setItem("doraemon-ui-theme",light?"light":"dark");localStorage.setItem("doraemon-sky",light?"light":"dark");
 },{light,language});
 await page.context().addCookies([{name:"nz-csrf",value:"mock-signed-token",url:origin}]);
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,servers:[server],online:offline?0:1})));
 await page.route("**/*",async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!==origin){
   state.external.push(u.href);
   if(state.localMock && (state.override??catalog).some(target=>target.host===u.hostname)){
    state.localRequests.push({url:u.href,method:req.method(),headers:await req.allHeaders()});
    if(state.localDelay)await new Promise(r=>setTimeout(r,state.localDelay));
    if(u.hostname==="redirect.example.com")return route.fulfill({status:302,headers:{location:origin+"/__local-probe-redirect-test"},body:""});
    if(u.hostname==="blocked.example.com")return route.abort("blockedbyresponse");
    return route.fulfill({status:404,body:""});
   }
   return route.abort();
  }
  if(u.pathname==="/connectivity-wallpaper.svg") return route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="bg"><stop stop-color="#052e16"/><stop offset=".45" stop-color="#14532d"/><stop offset=".5" stop-color="#ecfccb"/><stop offset="1" stop-color="#f0fdf4"/></linearGradient></defs><rect width="1200" height="800" fill="url(#bg)"/><path d="M0 640L1200 80M0 710L1200 150" stroke="#c4a875" stroke-width="28"/></svg>'});
  if(u.pathname.startsWith("/api/v1/logo/assets/")) {
   if(u.pathname.includes("bbbbbbbb"))return route.fulfill({status:404,body:"missing"});
   return route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=","base64")});
  }
  if(!u.pathname.startsWith("/api/"))return route.continue();
  let data:any=[];
  if(/\/connectivity(?:\/[^/]+)?$/.test(u.pathname)){
   if(req.method()==="POST"){
    state.posts++;state.postPaths.push(u.pathname);expect(req.postData()).toBe(null);expect(req.headers()["x-csrf-token"]).toBe("mock-signed-token");
    if(state.postError)return route.fulfill({json:{success:false,error:"connectivity_busy"}});
    state.fullBatch=u.pathname.endsWith("/connectivity");
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
  if(u.pathname.endsWith("/last-report"))data={server_id:7,tsdb_enabled:true,history_days:30,last_report_at:now-3600000,snapshot:{at:now-3600000,host:server.host,state:server.state,country_code:countryCode},metrics:{cpu:12},recent:{cpu:[{ts:now-3600000,value:12}]}};
  if(u.pathname.endsWith("/metrics"))data={data_points:[]};
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/server/7");
 if(clickTab) await page.locator(".server-info-tab").getByText(language==="en-US"?"Connectivity":"连通性",{exact:true}).click();
 return state;
}
for(const theme of ["default","doraemon"])for(const light of [false,true])for(const width of [320,390,768,1440]){
 test(`connectivity layout ${theme} ${light?"light":"dark"} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const state=await setup(page,theme,light),view=page.locator("[data-server-connectivity]");
  await expect(view.locator("[data-connectivity-target]")).toHaveCount(catalog.length);
  await expect(view.locator("[data-connectivity-group]")).toHaveCount(new Set(catalog.map(row=>row.group)).size);
  await expect(view.locator("img[data-connectivity-icon]")).toHaveCount(catalog.length);
  await expect.poll(() => view.locator("img[data-connectivity-icon]").evaluateAll((images) => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  for (const region of [...new Set(catalog.map(row=>row.group))].map(id=>({id,size:catalog.filter(row=>row.group===id).length}))) {
   await expect(view.locator(`[data-connectivity-group="${region.id}"] [data-connectivity-target]`)).toHaveCount(region.size);
  }
  expect(state.posts).toBe(0);await expect(page.locator("[data-server-network]")).toHaveCount(0);
  await view.getByRole("button",{name:"开始检测",exact:true}).click();
  await expect(view.getByRole("button",{name:"检测中…",exact:true})).toBeDisabled();expect(state.posts).toBe(1);
  await expect(view.locator('[data-connectivity-phase="running"]')).toHaveCount(1);
  await expect(view.getByText("正在检测",{exact:true})).toHaveCount(0);
  await expect(view.getByText("排队中",{exact:true})).toHaveCount(0);
  await expect(view.getByText(/排队 \d+ 项/)).toHaveCount(0);
  const progress=view.locator("[data-connectivity-header]").getByRole("progressbar");
  await expect(progress).toBeVisible();
  const p=await progress.boundingBox(),h=await view.locator("[data-connectivity-header] h2").boundingBox(),b=await view.getByRole("button",{name:"检测中…",exact:true}).boundingBox();
  expect(p!.width).toBeGreaterThan(20);
  if(width>=640){expect(p!.x).toBeGreaterThanOrEqual(h!.x+h!.width);expect(p!.x+p!.width).toBeLessThanOrEqual(b!.x);expect(Math.abs(p!.y+p!.height/2-(b!.y+b!.height/2))).toBeLessThan(2);}
  else expect(p!.y).toBeGreaterThanOrEqual(Math.max(h!.y+h!.height,b!.y+b!.height));
  const helpGap=await view.locator("[data-connectivity-header] h2").evaluate(el=>el.querySelector("button svg")!.getBoundingClientRect().left-el.querySelector("span")!.getBoundingClientRect().right);
  expect(helpGap).toBeLessThanOrEqual(5);
  await view.locator("[data-connectivity-controls]").screenshot({path:info.outputPath("progress-header.png")});
  state.mode="complete";
  await expect(view.getByRole("button",{name:/秒后可重测/})).toBeDisabled({timeout:10000});
  await expect(view.getByText("(HTTP 403)")).toHaveCount(0);
  await expect(view.getByText("请求超时",{exact:true})).toBeVisible();
  await expect(view.getByText("检测超时（3 秒未收到 Agent 回包）",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const cards=await view.locator("[data-connectivity-target]").evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}}));
  expect(cards.every(r=>r.left>=0&&r.right<=width+1&&r.width>0&&r.height>=54&&r.height<=60)).toBe(true);
  const aligned=await view.locator("[data-connectivity-target]").evaluateAll(nodes=>nodes.every(node=>{
   const bounds=node.getBoundingClientRect(), icon=node.querySelector("[data-connectivity-icon], [data-connectivity-icon-fallback]")?.getBoundingClientRect(), delay=node.querySelector("[data-connectivity-delay]")!.getBoundingClientRect();
   const text=[...node.querySelectorAll("h4, [data-connectivity-status]")].map(el=>el.getBoundingClientRect());
   return icon && Math.abs(icon.top+icon.height/2-(bounds.top+bounds.height/2))<=1 && Math.abs(delay.top+delay.height/2-(bounds.top+bounds.height/2))<=1 && text.every(rect=>rect.top>=bounds.top&&rect.bottom<=bounds.bottom);
  }));
  expect(aligned).toBe(true);
  expect(await view.innerHTML()).not.toContain("www.sony.jp");
  expect(await view.innerHTML()).not.toContain("www.nintendo.co.jp");
  await view.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("connectivity.png"),fullPage:true});
  expect(state.external.filter(url=>new URL(url).hostname==="ip.net.coffee" || catalog.some(target=>new URL(url).hostname===target.host))).toEqual([]);
  expect(errors).toEqual([]);
 });
}
test("guest and offline only read cache; reloading does not trigger probes",async({page})=>{
 const state=await setup(page,"default",false,true,false);state.mode="complete";await page.reload();
 await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
 const view=page.locator("[data-server-connectivity]");
 await expect(view.locator("[data-connectivity-controls]")).toHaveCount(0);
 await expect(view.getByRole("heading",{name:"节点连通性",exact:true})).toHaveCount(0);
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(catalog.length);
 await expect(view.getByRole("button",{name:/开始检测|重新检测/})).toHaveCount(0);
 await expect(view.getByText("(HTTP 403)")).toHaveCount(0);expect(state.posts).toBe(0);
});
test("network/detail tabs still work with combined network; help and failure recovery",async({page})=>{
 const state=await setup(page,"default"),view=page.locator("[data-server-connectivity]");
 await view.getByRole("button",{name:"连通性说明",exact:true}).click();await expect(view.getByText(/对比服务器与本地网络/)).toBeVisible();
 state.postError=true;await view.getByRole("button",{name:"开始检测",exact:true}).click();await expect(view.getByRole("alert")).toHaveText(/当前检测任务较多/);
 await expect(page.locator(".server-info-tab").getByText("网络",{exact:true})).toHaveCount(0);
 await page.locator(".server-info-tab").getByText("详情",{exact:true}).click();
 await expect(page.locator("[data-server-network]")).toBeVisible();await expect(view).toHaveCount(0);
 await expect(page.locator(".server-charts")).toBeVisible();
 state.readError=true;await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();await expect(view.getByRole("alert")).toHaveText(/检测结果读取失败/,{timeout:20000});
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(0);state.readError=false;await view.getByRole("button",{name:"重新加载"}).click();
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(catalog.length);
  await expect(view.locator("[data-connectivity-group]")).toHaveCount(new Set(catalog.map(row=>row.group)).size);
  await expect(view.locator("img[data-connectivity-icon]")).toHaveCount(catalog.length);
  await expect.poll(() => view.locator("img[data-connectivity-icon]").evaluateAll((images) => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  for (const region of [...new Set(catalog.map(row=>row.group))].map(id=>({id,size:catalog.filter(row=>row.group===id).length}))) {
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
 const tab=page.locator(".server-info-tab").getByRole("button",{name:"详情",exact:true});
 await tab.focus();await page.keyboard.press("Enter");await expect(page.locator("[data-server-network]")).toBeVisible();
 await page.locator(".server-info-tab").getByRole("button",{name:"连通性",exact:true}).focus();await page.keyboard.press("Space");
 await expect(view).toBeVisible();expect(state.posts).toBe(1);
});
for(const theme of ["default","doraemon"])for(const light of [false,true])for(const width of [390,1440]){
 test(`guest results only ${theme} ${light?"light":"dark"} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const state=await setup(page,theme,light,false,false,"zh-CN",true),view=page.locator("[data-server-connectivity]");
  await expect(view.locator("[data-connectivity-target]")).toHaveCount(catalog.length);
  await expect(view.locator("[data-connectivity-controls]")).toHaveCount(0);
  await expect(view.getByRole("heading",{name:"节点连通性",exact:true})).toHaveCount(0);
  await expect(view.getByText(/仅管理员或节点所属用户/)).toHaveCount(0);
  await expect(view.getByRole("button")).toHaveCount(2);
  expect(await view.evaluate(el=>el.firstElementChild?.hasAttribute("data-connectivity-source"))).toBe(true);
  await expect.poll(()=>view.locator("img[data-connectivity-icon]").evaluateAll(images=>images.every(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await view.locator("[data-connectivity-group]").first().scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("guest-results.png")});
  expect(state.posts).toBe(0);
 });
}
for(const theme of ["default","doraemon"])for(const light of [false,true])for(const offline of [false,true])for(const width of [320,1440]){
 test(`compact source buttons ${theme} ${light?"light":"dark"} ${offline?"offline":"online"} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const state=await setup(page,theme,light,offline,false,"zh-CN",true),view=page.locator("[data-server-connectivity]");
  await expect(view.locator("[data-connectivity-target]")).toHaveCount(catalog.length);
  const source=view.locator("[data-connectivity-source]");
  await expect.poll(async()=>source.evaluate(el=>el.getBoundingClientRect().top-document.querySelector(".server-info-tab")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(6);
  const sourceBox=await source.boundingBox(),tabsBox=await page.locator(".server-info-tab").boundingBox();
  expect(sourceBox!.y).toBeGreaterThanOrEqual(tabsBox!.y+tabsBox!.height);
  expect(sourceBox!.height).toBe(32);
  const buttons=source.getByRole("button");
  for(let i=0;i<2;i++){
   const button=buttons.nth(i);
   await expect(button.locator("svg")).toHaveCount(1);
   const style=await button.evaluate(el=>{const s=getComputedStyle(el);return {cursor:s.cursor,border:parseFloat(s.borderTopWidth),background:s.backgroundColor,color:s.color}});
   expect(style.cursor).toBe("pointer");expect(style.border).toBeGreaterThanOrEqual(1);
   expect(style.background).not.toBe("rgba(0, 0, 0, 0)");expect(style.color).not.toBe(style.background);
   await button.focus();await expect(button).toBeFocused();
  }
  const left=await buttons.nth(0).boundingBox(),right=await buttons.nth(1).boundingBox();
  expect(left!.x+left!.width+8).toBeLessThanOrEqual(right!.x);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator(".server-info-tab").scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("source-buttons.png")});
  expect(state.posts).toBe(0);expect(state.localRequests).toHaveLength(0);
 });
}
test("guest cache failure retains reload without exposing owner controls",async({page})=>{
 const state=await setup(page,"default",false,false,false),view=page.locator("[data-server-connectivity]");
 state.readError=true;
 await page.locator(".server-info-tab").getByText("详情",{exact:true}).click();
 await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
 await expect(view.getByRole("alert")).toHaveText(/检测结果读取失败/,{timeout:20000});
 await expect(view.locator("[data-connectivity-controls]")).toHaveCount(0);
 state.readError=false;await view.getByRole("button",{name:"重新加载"}).click();
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(catalog.length);
 await expect(view.getByRole("button")).toHaveCount(2);
 expect(state.posts).toBe(0);
});
test("compact reference row has names dots and latency but no website text",async({page},info)=>{
 await page.setViewportSize({width:1600,height:900});
 const state=await setup(page,"default",true,false,false);
 const delays=[45,42,49,39];
 // Select the same first four Japanese brands as the supplied reference.
 state.override=catalog.filter(row=>row.group==="japan").slice(0,4).map((row,i)=>({...row,icon:row.id,status:"ok",phase:"complete",delay_ms:delays[i],samples:Array.from({length:3},()=>({status:"ok",delay_ms:delays[i]}))}));
 state.mode="complete";
 await page.reload();await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
 const view=page.locator("[data-server-connectivity]"),grid=view.locator('[data-connectivity-group="japan"] > .grid');
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(4);
 await expect.poll(()=>view.locator("img").evaluateAll(imgs=>imgs.every(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0))).toBe(true);
 const html=await view.innerHTML();
 for(const row of state.override)expect(html).not.toContain(row.host);
 const sizes=await view.locator("[data-connectivity-target]").evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top})));
 expect(sizes.every(size=>size.height>=54&&size.height<=60&&size.top===sizes[0].top)).toBe(true);
 await grid.screenshot({path:info.outputPath("compact-reference.png")});
 expect(state.posts).toBe(0);
});
for(const theme of ["default","doraemon"])test(`overflow status pans and cached icons ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:320,height:850});
 const state=await setup(page,theme,true,false,false);
 const make=(id:string,status:string,icon:string)=>({id,name:id,group:"china",host:"private.example",icon,status,delay_ms:status==="http_error"?185:undefined,phase:"complete",samples:Array.from({length:3},()=>({status,http_status:status==="http_error"?403:undefined}))});
 state.mode="complete";
 state.override=[make("long-status","agent_timeout","/api/v1/logo/assets/"+"a".repeat(64)+".png"),make("short-status","timeout","/api/v1/logo/assets/"+"b".repeat(64)+".png"),make("external-icon","http_error","https://example.com/not-requested.png")];
 await page.reload();await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
 const view=page.locator("[data-server-connectivity]"),box=view.locator('[data-connectivity-target="long-status"]'),status=box.locator("[data-connectivity-status]"),track=status.locator(".nz-connectivity-marquee-track");
 await box.scrollIntoViewIfNeeded();
 // Constrain the status area to exercise overflow independently of latency width.
 await status.evaluate(el => { (el as HTMLElement).style.maxWidth="90px"; });
 await expect(status).toHaveAttribute("data-overflow","true");
 await expect(box.locator("img")).toHaveAttribute("src","/api/v1/logo/assets/"+"a".repeat(64)+".png");
 await expect.poll(()=>box.locator("img").evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await expect(view.locator('[data-connectivity-target="short-status"] img')).toHaveCount(0);
 await expect(view.locator('[data-connectivity-target="external-icon"] img')).toHaveCount(0);
 await expect(view.locator('[data-connectivity-target="short-status"] [data-connectivity-status]')).toHaveAttribute("data-overflow","false");
 const movement=await track.evaluate(el=>{
  const animation=el.getAnimations()[0];if(!animation)throw Error("animation missing");
  const duration=Number(animation.effect!.getTiming().duration);
  animation.pause();
  const at=(fraction:number)=>{animation.currentTime=duration*fraction;return new DOMMatrix(getComputedStyle(el).transform).m41;};
  return {start:at(0),end:at(.5),back:at(1),distance:(el as HTMLElement).scrollWidth-(el.parentElement as HTMLElement).clientWidth};
 });
 expect(movement.start).toBe(0);expect(movement.end).toBeCloseTo(-movement.distance,0);expect(movement.back).toBe(0);
 await status.hover();expect(await track.evaluate(el=>getComputedStyle(el).animationPlayState)).toBe("paused");
 await page.mouse.move(0,0);await status.focus();expect(await track.evaluate(el=>getComputedStyle(el).animationPlayState)).toBe("paused");
 await page.screenshot({path:info.outputPath("overflow-mobile.png")});
 await page.emulateMedia({reducedMotion:"reduce"});
 expect(await track.evaluate(el=>getComputedStyle(el).animationName)).toBe("none");
 expect(await status.evaluate(el=>getComputedStyle(el).overflowX)).toBe("auto");
 await page.emulateMedia({reducedMotion:"no-preference"});
 await status.evaluate(el => { (el as HTMLElement).style.maxWidth=""; });
 await page.setViewportSize({width:740,height:850});
 await expect(status).toHaveAttribute("data-overflow","false");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(state.posts).toBe(0);
 expect(state.external.filter(url=>url.includes("not-requested")||url.includes("private.example"))).toEqual([]);
});
for(const theme of ["default","doraemon"]) {
 for(const [code,first] of [["cn","china"],["us","usa"],["sg","singapore"],["my","malaysia"],["id","indonesia"],["gb","uk"],["kr","korea"],["hk","hongkong"],["mo","macau"],["","global"]]) {
  test(`node region priority ${theme} ${code||"unknown"}`,async({page})=>{
   const state=await setup(page,theme,false,false,false,"zh-CN",false,code);
   const groups=page.locator("[data-connectivity-group]");
   await expect(groups.first()).toHaveAttribute("data-connectivity-group",first==="china"?"global":first);
   const order=await groups.evaluateAll(nodes=>nodes.map(n=>n.getAttribute("data-connectivity-group")));
   expect(order.slice(0,first==="china"||first==="global"?1:2)).toEqual(first==="china"||first==="global"?["global"]:[first,"global"]);
   expect(order.at(-1)).toBe("china");
   expect(state.posts).toBe(0);
  });
 }
 for(const offline of [false,true]) test(`disabled node hides connectivity ${theme} ${offline}`,async({page})=>{
  const state=await setup(page,theme,false,offline,false,"zh-CN",false,"sg",true,false);
  await expect(page.locator(".server-info-tab").getByText("详情",{exact:true})).toBeVisible();
  await expect(page.locator(".server-info-tab").getByText("连通性",{exact:true})).toHaveCount(0);
  expect(state.gets).toBe(0);expect(state.posts).toBe(0);
 });
 test(`single card authorized retry ${theme}`,async({page})=>{
  const state=await setup(page,theme);
  const card=page.locator('[data-connectivity-target="deepseek"]');
  await expect(card).toHaveAttribute("role","button");
  await card.click();
  await expect.poll(()=>state.posts).toBe(1);
  expect(state.postPaths).toEqual(["/api/v1/server/7/connectivity/deepseek"]);
  await expect(card).toHaveAttribute("aria-disabled","true");
  await card.click({force:true});expect(state.posts).toBe(1);
 });
 test(`details shell remains available with deferred requests ${theme}`,async({page})=>{
  await setup(page,theme,false,false,false,"zh-CN",false,"sg",false,false);
  let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route("**/api/v1/server/7/connectivity",async route=>{await gate;await route.fulfill({json:{success:true,data:{server_id:7,online:true,can_run:false,state:"idle",rounds:3,results:[]}}})});
  await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
  await expect(page.locator(".server-info-tab").getByText("详情",{exact:true})).toBeVisible();
  await expect(page.locator(".server-info-tab").getByText("网络",{exact:true})).toHaveCount(0);
  await expect(page.locator(".server-name")).toContainText("连通性测试节点");
  await expect(page.locator("[data-server-connectivity]")).toBeVisible();
  await page.locator(".server-info-tab").getByText("详情",{exact:true}).click();
  await expect(page.locator(".server-charts")).toBeVisible();release();
 });
}

for (const theme of ["default","doraemon"]) for (const width of [390,1440]) {
 test(`latest completed compact header ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const state=await setup(page,theme,true,false,true,"zh-CN",true,"hk");
  state.latest={state:"complete",started_at:Date.now()-100000,finished_at:Date.now()-90000,scheduled_at:Date.parse("2026-10-06T16:00:00Z"),rounds:3,
   results:catalog.map(({id,name,group,host})=>({id,name,group,host,phase:"complete",status:"ok",delay_ms:42,samples:Array.from({length:3},()=>({status:"ok",delay_ms:42}))}))};
  state.mode="running";
  await page.reload();
  await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
  const view=page.locator("[data-server-connectivity]"),controls=view.locator("[data-connectivity-controls]");
  await expect(view.locator('[data-connectivity-phase="complete"]')).toHaveCount(catalog.length);
  await expect(controls.getByText("最近一次检测结果")).toBeVisible();
  await expect(controls.getByText("2026/10/7 00:00:00",{exact:true})).toBeVisible();
  await expect(controls.getByText(/不使用访问者网络/)).toHaveCount(0);
  await expect(controls.getByRole("progressbar")).toHaveCount(0);
  expect((await controls.boundingBox())!.height).toBeLessThan(width<500?155:110);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(state.posts).toBe(0);
  await controls.screenshot({path:info.outputPath("compact-header.png")});
  await view.locator('[data-connectivity-group="hongkong"]').screenshot({path:info.outputPath("hongkong.png")});
  state.mode="complete";
  await expect(controls.getByRole("button",{name:/秒后可重测/})).toBeDisabled({timeout:10000});
  await expect(view.getByText("42ms",{exact:true})).toHaveCount(0);
 });
}

for (const theme of ["default","doraemon"]) test("administrator bypass cooldown "+theme,async({page})=>{
 const state=await setup(page,theme,true);
 state.mode="complete";state.canBypass=true;
 await page.reload();await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
 const view=page.locator("[data-server-connectivity]");
 await expect(view.getByRole("button",{name:"重新检测",exact:true})).toBeEnabled();
 await expect(view.getByRole("button",{name:/秒后可重测/})).toHaveCount(0);
 await view.getByRole("button",{name:"重新检测",exact:true}).click();
 await expect(view.getByRole("button",{name:"检测中…",exact:true})).toBeDisabled();
 expect(state.posts).toBe(1);
 state.mode="complete";
 await expect(view.getByRole("button",{name:"重新检测",exact:true})).toBeEnabled({timeout:10000});
 await view.locator('[data-connectivity-target="deepseek"]').click();
 await expect.poll(()=>state.posts).toBe(2);
 expect(state.postPaths[1]).toMatch(/\/deepseek$/);
});
for(const theme of ["default","doraemon"])for(const width of [390,1440])test("compact controls and single retry "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const state=await setup(page,theme,true,false,true,"zh-CN",true,"hk");
 state.canBypass=true;state.mode="complete";
 // A fresh page reads the changed fixture; warm tab switches reuse cached data.
 await page.reload();
 await page.locator(".server-info-tab").getByRole("button",{name:"连通性",exact:true}).click();
 const view=page.locator("[data-server-connectivity]"),controls=view.locator("[data-connectivity-controls]");
 const button=view.getByRole("button",{name:"重新检测",exact:true});
 await expect(button).toBeEnabled();
 const height=await controls.evaluate(el=>el.getBoundingClientRect().height);
 expect(height).toBeLessThanOrEqual(width===390?120:80);
 await controls.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath("compact-controls.png")});
 await view.locator('[data-connectivity-target="google"]').click();
 await expect(button).toHaveCount(0);
 await expect(view.getByRole("button",{name:"检测中…",exact:true})).toBeDisabled();
 await expect(view.getByRole("progressbar")).toHaveCount(0);
 await expect(view.getByText(/已完成.*项/)).toHaveCount(0);
 expect(state.postPaths).toEqual(["/api/v1/server/7/connectivity/google"]);
 state.mode="complete";
 await expect(view.getByRole("button",{name:"重新检测",exact:true})).toBeEnabled({timeout:10000});
 await view.getByRole("button",{name:"重新检测",exact:true}).click();
 await expect(view.getByRole("progressbar")).toBeVisible();
 expect(state.postPaths[1]).toBe("/api/v1/server/7/connectivity");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
for(const theme of ["default","doraemon"])for(const width of [320,390,768,1440])test(`visitor local latency ${theme} ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const state=await setup(page,theme,true,true,false,"zh-CN",true,"hk");
 state.override=[
  {id:"google",name:"本地样例",host:"www.example.com",group:"hongkong",status:"ok",phase:"complete",samples:[{status:"ok",delay_ms:42}],delay_ms:42},
  {id:"redirect",name:"重定向样例",host:"redirect.example.com",group:"global",status:"pending",samples:[]},
  {id:"blocked",name:"受限样例",host:"blocked.example.com",group:"global",status:"pending",samples:[]},
  {id:"private",name:"内部地址样例",host:"127.0.0.1",group:"global",status:"pending",samples:[]},
 ];
 state.mode="complete";state.localMock=true;state.localDelay=900;
 await page.context().addCookies([{name:"private-session",value:"must-not-send",url:"https://www.example.com"}]);
 await page.reload();await page.locator(".server-info-tab").getByRole("button",{name:"连通性",exact:true}).click();
 const view=page.locator("[data-server-connectivity]"),source=view.locator("[data-connectivity-source]");
 await expect(view.locator("[data-connectivity-target]")).toHaveCount(4);
 await expect(source.getByRole("button",{name:"服务器延迟",exact:true})).toHaveAttribute("aria-pressed","true");
 await expect(source.getByRole("button",{name:"本地延迟",exact:true})).toBeVisible();
 expect(state.localRequests).toHaveLength(0);
 expect(await source.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(32);
 const left=await source.getByRole("button",{name:"服务器延迟",exact:true}).boundingBox(),right=await source.getByRole("button",{name:"本地延迟",exact:true}).boundingBox();
 expect(left!.x+left!.width).toBeLessThan(right!.x);
 await view.screenshot({path:info.outputPath("guest-source-row.png")});
 await page.evaluate(()=>{(window as any).__storageWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){(window as any).__storageWrites.push([k,v]);return original.call(this,k,v)}});
 await source.getByRole("button",{name:"本地延迟",exact:true}).click();
 await expect(view.locator("[data-local-connectivity]")).toBeVisible();
 await expect(view.getByRole("button",{name:"停止检测",exact:true})).toBeVisible();
 const progress=source.getByRole("progressbar");
 await expect(progress).toBeVisible();
 expect(await progress.evaluate(el=>!!el.closest("[data-connectivity-source]"))).toBe(true);
 const p=await progress.boundingBox(),l=await source.getByRole("button",{name:"服务器延迟",exact:true}).boundingBox(),r=await source.getByRole("button",{name:"本地延迟",exact:true}).boundingBox();
 if(width>=640){expect(p!.x).toBeGreaterThanOrEqual(l!.x+l!.width);expect(p!.x+p!.width).toBeLessThanOrEqual(r!.x);}
 else expect(p!.y).toBeGreaterThanOrEqual(l!.y+l!.height);
 await expect(view.getByText(/当前浏览器访问|仅本页可见|每项 1 次/)).toHaveCount(0);
 await expect(view.getByText(/本地检测完成/)).toBeVisible();
 await expect(view.locator('[data-connectivity-target="google"] [data-connectivity-delay]')).not.toHaveText("—");
 await expect(view.locator('[data-connectivity-target="redirect"] [data-connectivity-delay]')).not.toHaveText("—");
 await expect(view.locator('[data-connectivity-target="blocked"]')).toContainText("浏览器限制或网络不可达");
 await expect(view.locator('[data-connectivity-target="private"]')).toContainText("不支持浏览器检测");
 expect(state.localRequests).toHaveLength(3);
 for(const req of state.localRequests){expect(req.method).toBe("HEAD");expect(req.headers["cookie"]).toBeUndefined();expect(req.headers["referer"]).toBeUndefined();expect(new URL(req.url).pathname).toBe("/");}
 // Playwright routes only the first redirect hop. The final HEAD uses the
 // real preview server; verify credentials remain omitted on that hop too.
 await expect.poll(()=>state.redirectHeaders.length).toBe(1);
 expect(state.redirectHeaders[0]["cookie"]).toBeUndefined();
 expect(state.redirectHeaders[0]["referer"]).toBeUndefined();
 expect(state.localRequests.some(req=>new URL(req.url).hostname==="127.0.0.1")).toBe(false);
 expect(state.posts).toBe(0);
 expect(await page.evaluate(()=>(window as any).__storageWrites)).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await view.screenshot({path:info.outputPath("local-results.png")});
 await source.getByRole("button",{name:"服务器延迟",exact:true}).click();
 await expect(view.locator('[data-connectivity-target="google"] [data-connectivity-delay]')).toHaveText("42ms");
 await source.getByRole("button",{name:"本地延迟",exact:true}).click();
 expect(state.localRequests).toHaveLength(3);
 await view.getByRole("button",{name:"重新检测本地延迟",exact:true}).click();
 await expect(view.getByText(/本地检测完成/)).toBeVisible();
 expect(state.localRequests).toHaveLength(6);
 await page.reload();await page.locator(".server-info-tab").getByRole("button",{name:"连通性",exact:true}).click();
 await expect(source.getByRole("button",{name:"服务器延迟",exact:true})).toHaveAttribute("aria-pressed","true");
 await expect(view.locator("[data-local-connectivity]")).toHaveCount(0);
 expect(state.localRequests).toHaveLength(6);expect(state.posts).toBe(0);
});

for(const theme of ["default","doraemon"])test("local cancellation and rapid navigation "+theme,async({page},info)=>{
 await page.setViewportSize({width:390,height:900});
 const state=await setup(page,theme,false,false,false,"zh-CN",true,"hk");
 state.localMock=true;state.localDelay=2000;
 const view=page.locator("[data-server-connectivity]");
 const local=view.getByRole("button",{name:"本地延迟",exact:true});
 await local.click();await local.click();
 await expect.poll(()=>state.localRequests.length).toBe(6);
 await expect(view.getByRole("button",{name:"停止检测",exact:true})).toBeVisible();
 await view.screenshot({path:info.outputPath("local-dark-running.png")});
 await view.getByRole("button",{name:"停止检测",exact:true}).click();
 await expect(view.getByText("本地检测已停止",{exact:true})).toBeVisible();
 expect(state.localRequests).toHaveLength(6);
 await view.getByRole("button",{name:"重新检测本地延迟",exact:true}).click();
 await expect.poll(()=>state.localRequests.length).toBe(12);
 await page.locator(".server-info-tab").getByRole("button",{name:"详情",exact:true}).click();
 await expect(view).toHaveCount(0);
 await page.waitForTimeout(3300); // Past the probe timeout: no queued/background work may start.
 expect(state.localRequests).toHaveLength(12);
 await page.locator(".server-info-tab").getByRole("button",{name:"连通性",exact:true}).click();
 await expect(view.getByRole("button",{name:"服务器延迟",exact:true})).toHaveAttribute("aria-pressed","true");
 await expect(view.locator("[data-local-connectivity]")).toHaveCount(0);
 expect(state.localRequests).toHaveLength(12);expect(state.posts).toBe(0);
});

for(const theme of ["default","doraemon"])for(const width of [390,1440])test("visitor unlimited single local retries "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const state=await setup(page,theme,false,true,false,"zh-CN",true);
 state.override=[{id:"a",name:"Site A",host:"a.example.com",group:"global",status:"ok",phase:"complete",samples:[{status:"ok",delay_ms:42}],delay_ms:42},{id:"b",name:"Site B",host:"b.example.com",group:"global",status:"ok",phase:"complete",samples:[{status:"ok",delay_ms:77}],delay_ms:77}];
 state.localMock=true;state.localDelay=200;
 await page.reload();await page.locator(".server-info-tab").getByText("连通性",{exact:true}).click();
 const view=page.locator("[data-server-connectivity]"),a=view.locator('[data-connectivity-target="a"]'),b=view.locator('[data-connectivity-target="b"]');
 await view.getByRole("button",{name:"本地延迟",exact:true}).click();
 await expect(view.getByText(/本地检测完成/)).toBeVisible();
 expect(state.localRequests).toHaveLength(2);
 const untouched=await b.locator("[data-connectivity-delay]").innerText();
 state.localDelay=700;
 await a.click();await expect(a).toHaveAttribute("aria-disabled","false");
 await expect(view.getByRole("progressbar")).toHaveCount(0);
 await expect(b.locator("[data-connectivity-delay]")).toHaveText(untouched);
 await a.click();
 await expect.poll(()=>state.localRequests.length).toBe(4);
 await expect(a).toHaveAttribute("data-connectivity-phase","complete");
 await expect(view.getByText(/本地检测完成/)).toBeVisible();
 await a.focus();await page.keyboard.press("Enter");
 await expect.poll(()=>state.localRequests.length).toBe(5);
 await expect(a).toHaveAttribute("data-connectivity-phase","complete");
 await expect(b.locator("[data-connectivity-delay]")).toHaveText(untouched);
 expect(state.posts).toBe(0);
 expect(state.localRequests.slice(2).every(row=>new URL(row.url).hostname==="a.example.com")).toBe(true);
 await view.screenshot({path:info.outputPath("single-local-retry.png")});
 await view.getByRole("button",{name:"服务器延迟",exact:true}).click();
 await expect(a.locator("[data-connectivity-delay]")).toHaveText("42ms");
 await expect(a).not.toHaveAttribute("role","button");
});
