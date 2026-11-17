import {test, expect, type Page, type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";

test.use({ignoreHTTPSErrors:true});
async function setup(page:Page, color="light", inline=false) {
 const origin=process.env.NIC_USER_URL || "https://127.0.0.1:5185";
 const now=Date.now();
 const state={servers:[
  createServer({id:7,name:"香港主机",country_code:"HK",last_active:new Date(now).toISOString()}),
  createServer({id:8,name:"香港备用",country_code:"HK",last_active:"2020-01-01T00:00:00Z"}),
  createServer({id:9,name:"新加坡节点",country_code:"SG",last_active:new Date(now).toISOString()}),
 ],sockets:[] as WebSocketRoute[]};
 await page.addInitScript(({color,inline})=>{
  localStorage.setItem("language","zh-CN");
  localStorage.setItem("vite-ui-theme",color);
  localStorage.setItem("showMap","1");
  localStorage.setItem("showServices","0");
  localStorage.setItem("inline",inline?"1":"0");
 },{color,inline});
 const tick=()=>state.sockets.at(-1)?.send(JSON.stringify({now:Date.now(),online:state.servers.filter(s=>s.last_active!=="2020-01-01T00:00:00Z").length,servers:state.servers}));
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{state.sockets.push(ws);tick()});
 await page.route("**/*",route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/"))return route.continue();
  if(u.pathname==="/api/v1/profile")return route.fulfill({json:{error:"ApiErrorUnauthorized"}});
  let data:any=[];
  if(u.pathname==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"地图交互验证",custom_code:"",appearance_config:'{"version":1,"enabled":false,"features":{}}'}};
  if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}};
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/");
 await expect(page.locator("[data-server-card]")).toHaveCount(3);
 await expect(page.locator(".global-map-shell")).toBeVisible();
 return {state,tick};
}

for(const width of [320,390,768,1440])for(const color of ["light","dark"]) {
 test(`region interaction, fresh data and responsive layout ${width} ${color}`,async({page})=>{
  await page.setViewportSize({width,height:950});
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const {state,tick}=await setup(page,color);
  await expect(page.locator(".global-map-regions,.global-map-panel")).toHaveCount(0);
  await page.locator('[data-region="HK"]').focus();await page.keyboard.press("Enter");
  const panel=page.getByTestId("map-tooltip");
  await expect(panel).toContainText("在线 1");await expect(panel).toContainText("离线 1");
  state.servers[1]={...state.servers[1],name:"香港恢复",last_active:new Date().toISOString()};tick();
  await expect(panel).toContainText("在线 2");await expect(panel).toContainText("香港恢复");
  await panel.getByRole("button",{name:"关闭"}).click();
  await expect(panel).toHaveCount(0);
  const marker=page.locator('[data-region="SG"]');
  await marker.focus();await page.keyboard.press("Enter");
  await expect(panel).toContainText("新加坡节点");

  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);
  state.servers=state.servers.filter(s=>s.country_code!=="SG");tick();
  await expect(panel).toHaveCount(0);
  if(color==="light" && [390,1440].includes(width))await page.locator(".global-map-shell").screenshot({path:`test-results/map-simplified-${width}.png`});
  expect(errors).toEqual([]);
 });
}

for(const inline of [false,true]) {
 test(`glass follows pointer, remains clipped, fades and permits card navigation ${inline}`,async({page})=>{
  await page.setViewportSize({width:1440,height:950});
  await setup(page,"light",inline);
  const card=page.locator("[data-server-card]").filter({hasText:"香港主机"});
  await card.scrollIntoViewIfNeeded();
  const box=(await card.boundingBox())!;
  const positions=[{x:18,y:18},{x:box.width-20,y:box.height-18}];
  for(const p of positions){
   await page.mouse.move(box.x+p.x,box.y+p.y);
   await expect(card).toHaveAttribute("data-glass-hover","true");
   await expect.poll(()=>card.evaluate(el=>parseFloat((el as HTMLElement).style.getPropertyValue("--glass-x")))).toBeCloseTo(p.x,0);
   await expect.poll(()=>card.evaluate(el=>parseFloat((el as HTMLElement).style.getPropertyValue("--glass-y")))).toBeCloseTo(p.y,0);
  }
  const bounds=await card.evaluate(el=>{
   const layer=el.querySelector(".server-glass-sheen")!;
   const c=el.getBoundingClientRect(),r=layer.getBoundingClientRect(),css=getComputedStyle(layer);
   return {x:r.left-c.left,y:r.top-c.top,w:r.width,h:r.height,cw:c.width,ch:c.height,overflow:css.overflow,pointer:css.pointerEvents,radius:css.borderRadius,cardRadius:getComputedStyle(el).borderRadius};
  });
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.w).toBeLessThanOrEqual(bounds.cw);expect(bounds.h).toBeLessThanOrEqual(bounds.ch);
  expect(bounds.overflow).toBe("hidden");expect(bounds.pointer).toBe("none");expect(bounds.radius).toBe(bounds.cardRadius);
  await page.mouse.move(0,0);
  await expect(card).not.toHaveAttribute("data-glass-hover");
  await expect.poll(()=>card.locator(".server-glass-sheen").evaluate(el=>getComputedStyle(el,"::before").opacity)).toBe("0");
  await card.click();await expect(page).toHaveURL(/\/server\/7$/);
 });
}

test("reduced motion disables reflection while keeping map tooltip readable",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.setViewportSize({width:1440,height:950});
 await setup(page);
 const card=page.locator("[data-server-card]").first();
 await card.hover();
 await expect(card.locator(".server-glass-sheen")).toBeHidden();
 await expect(card).not.toHaveAttribute("data-glass-hover");
 await page.locator('[data-region="HK"]').hover();
 const tooltip=page.getByTestId("map-tooltip");
 await expect(tooltip).toBeVisible();
 await expect(tooltip).toHaveCSS("opacity","1");
 await expect(tooltip).toContainText("香港主机");
});

test("touch selection works without a stuck reflection",async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
 try{
  const page=await context.newPage();await setup(page);
  await page.locator('[data-region="HK"]').tap();
  await expect(page.getByTestId("map-tooltip")).toContainText("香港主机");
  await expect(page.locator("[data-glass-hover]")).toHaveCount(0);
  await expect(page.locator(".server-glass-sheen").first()).toBeHidden();
  await page.getByTestId("map-tooltip").getByRole("button",{name:/香港主机/}).tap();
  await expect(page).toHaveURL(/\/server\/7$/);
 }finally{await context.close()}
});
