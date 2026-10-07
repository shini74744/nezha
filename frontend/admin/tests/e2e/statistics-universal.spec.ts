import {test,expect} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true,hasTouch:true});
const js=fs.readFileSync(new URL("../../../../cmd/dashboard/controller/frontend-statistics.js",import.meta.url),"utf8");
for(const [index,theme] of ["nazhua","aobobo","nezha-pixel","nezha-ascii"].entries())for(const width of [390,1366])for(const split of [true,false])test(theme+" shared statistics "+width+" split "+split,async({page})=>{
 // Aobobo's WebGL globe is software-rendered on the headless build host.
 test.setTimeout(theme === "aobobo" ? 90000 : 45000);
 const origin="https://127.0.0.1:"+(5191+index),now=Date.now(),servers=[createServer({id:1,name:"测试服务器",last_active:new Date(now).toISOString()})];
 let failing=false,empty=false;
 await page.setViewportSize({width,height:800});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,servers,online:1})));
 await page.route("**/*",async r=>{
 const u=new URL(r.request().url()),path=u.pathname;
 if(path==="/__nezha/statistics.js")return r.fulfill({contentType:"text/javascript",body:js});
 if(path.startsWith("/api/v1/")){
 let data:any=[];
 if(path==="/api/v1/setting")data={config:{site_name:"主题统计验证",language:"zh-CN"},version:"test"};
 if(path==="/api/v1/profile")return r.fulfill({json:{success:false}});
 if(path==="/api/v1/service"){
  if(failing)return r.fulfill({status:503,json:{success:false}});
  data=empty?{services:{},cycle_transfer_stats:{}}:{services:{"1":{service_name:"重庆电信-上海移动国际网络长名称显示验证",up:Array(30).fill(100),down:Array(30).fill(0),delay:Array(30).fill(32)}},cycle_transfer_stats:{"1":{name:"月流量统计",from:"2026-10-01",to:"2026-11-01",max:1024**4,server_name:{"1":"香港家宽母鸡1-香港海创前置长名称网络节点测试"},transfer:{"1":1.67*1024**4},next_update:{"1":"2026-10-04T23:30:45+08:00"}}}};
 }
 return r.fulfill({json:{success:true,data}});
 }
 if(r.request().isNavigationRequest()&&path==="/"){
  const response=await r.fetch();
  return r.fulfill({response,body:(await response.text()).replace("</head>",'<script defer src="/__nezha/statistics.js" data-theme="'+theme+'-dist" data-statistics-split="'+split+'"></script></head>')});
 }
 if(u.origin!==origin)return r.abort();
 return r.continue();
 });
 await page.goto(origin,{waitUntil:"domcontentloaded"});
 const host=page.locator("#nezha-statistics"),trigger=host.getByRole("button",{name:split?"选择统计视图":"显示或收起统计",exact:true}),menu=host.getByRole("menu");

 // Tap the visible close control directly. Aobobo's scrolling layer can stall
 // Chromium's automatic scroll-into-view even though this fixed control is in view.
 const tapClose = async () => {
  const close=host.getByRole("button",{name:"收起统计",exact:true});
  await expect(close).toBeInViewport();
  const box=await close.boundingBox();expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x+box!.width/2,box!.y+box!.height/2);
 };
 await expect(trigger).toBeVisible();
 if(width===390)await page.evaluate(()=>document.documentElement.classList.add("dark"));
 if(!split){
  await trigger.tap();
  const dialog=host.getByRole("dialog");await expect(dialog).toBeVisible();
  await expect(menu).not.toBeVisible();
  await expect(host.locator('[data-statistics-card="traffic"]')).toHaveCount(1);
  await expect(host.locator('[data-statistics-card="uptime"]')).toHaveCount(1);
  await expect(dialog.locator(".tabs")).not.toBeVisible();
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:"test-results/universal-combined-"+theme+"-"+width+".png",timeout:10000});
  await page.keyboard.press("Escape");await expect(dialog).not.toBeVisible();
  await trigger.tap();await expect(dialog).toBeVisible();
  await tapClose();await expect(dialog).not.toBeVisible();
  return;
 }
 await trigger.tap();await expect(menu).toBeVisible();
 const mb=await menu.boundingBox();expect(mb!.width).toBeLessThanOrEqual(140);expect(mb!.height).toBeLessThanOrEqual(110);await expect(menu.getByRole("menuitemradio")).toHaveCount(2);await expect(menu.getByRole("menuitemradio",{name:"收起统计",exact:true})).toHaveCount(0);await expect(menu.locator(".menu-title")).toHaveCount(0);expect(mb!.x).toBeGreaterThanOrEqual(0);expect(mb!.x+mb!.width).toBeLessThanOrEqual(width);
 await page.screenshot({path:"test-results/universal-menu-"+theme+"-"+width+".png",timeout:10000});
 await host.getByRole("menuitemradio",{name:"流量统计",exact:true}).tap();
 const dialog=host.getByRole("dialog");
 await expect(dialog).toBeVisible();
 await expect(host.locator('[data-statistics-card="traffic"]')).toHaveCount(1);
 await expect(host.locator('[data-statistics-card="uptime"]')).toHaveCount(0);
 await expect(host.getByRole("progressbar")).toHaveAttribute("aria-valuenow","100");
 const db=await dialog.boundingBox();expect(db!.x).toBeGreaterThanOrEqual(0);expect(db!.x+db!.width).toBeLessThanOrEqual(width);expect(db!.height).toBeLessThanOrEqual(800);
 expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await page.screenshot({path:"test-results/universal-traffic-"+theme+"-"+width+".png",timeout:10000});
 await dialog.getByRole("button",{name:"流量统计",exact:true}).tap();
 await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
 await trigger.tap();await host.getByRole("menuitemradio",{name:"流量统计",exact:true}).tap();
 await expect(dialog).toBeVisible();
 await dialog.getByRole("button",{name:"在线率",exact:true}).tap();
 await expect(host.locator('[data-statistics-card="traffic"]')).toHaveCount(0);
 await expect(host.locator('[data-statistics-card="uptime"]')).toHaveCount(1);
 await dialog.locator(".day").first().tap();await expect(dialog.locator(".detail")).toBeVisible();
 await page.screenshot({path:"test-results/universal-uptime-"+theme+"-"+width+".png",timeout:10000});
 await dialog.getByRole("button",{name:"在线率",exact:true}).tap();
 await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
 await trigger.tap();await host.getByRole("menuitemradio",{name:"在线率",exact:true}).tap();
 await expect(dialog).toBeVisible();
 await tapClose();
 await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
 expect(await page.evaluate(key=>localStorage.getItem(key),theme+"-dist:statisticsView")).toBe("uptime");
 failing=true;await trigger.click();await host.getByRole("menuitemradio",{name:"流量统计",exact:true}).click();
 await expect(dialog.getByText("统计数据加载失败，请重试。")).toBeVisible();
 failing=false;empty=true;await dialog.getByRole("button",{name:"重新加载"}).click();
 await expect(dialog.getByText("暂无流量统计，请先配置周期流量规则。")).toBeVisible();
 await page.keyboard.press("Escape");await expect(dialog).not.toBeVisible();
 await trigger.focus();await page.keyboard.press("Enter");await expect(menu).toBeVisible();
 await page.keyboard.press("End");await expect(menu.getByRole("menuitemradio",{name:"在线率",exact:true})).toBeFocused();
 await page.keyboard.press("ArrowDown");await expect(menu.getByRole("menuitemradio",{name:"流量统计",exact:true})).toBeFocused();
 await page.keyboard.press("ArrowUp");await expect(menu.getByRole("menuitemradio",{name:"在线率",exact:true})).toBeFocused();
 await page.keyboard.press("Escape");await expect(menu).not.toBeVisible();await expect(trigger).toBeFocused();
 await page.reload({waitUntil:"domcontentloaded"});await expect(trigger).toBeVisible();await expect(dialog).not.toBeVisible();
});
