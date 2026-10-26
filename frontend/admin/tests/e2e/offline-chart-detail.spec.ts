import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
for(const theme of ["default","doraemon"])for(const width of [390,1440])for(const saved of [true,false])
test("offline chart and online menu "+theme+" "+width+" saved="+saved,async({page})=>{
 const origin="https://127.0.0.1:"+(theme==="default"?18477:18478),now=Date.now(),at=now-3600000;
 const server=createServer({id:7,name:"离线记录测试",last_active:"0001-01-01T00:00:00Z"});
 const state={...server.state,cpu:25,mem_used:128,swap_used:0,disk_used:80,process_count:12};
 const metrics={cpu:25,memory:128,swap:0,disk:80,memory_percent:50,swap_percent:0,disk_percent:20,process_count:12,net_in_speed:1024,net_out_speed:2048,tcp_conn:3,udp_conn:1};
 const recent=Object.fromEntries(Object.entries(metrics).map(([key,value])=>[key,Array.from({length:21},(_,i)=>({ts:at-60000+i*3000,value}))]));
 await page.setViewportSize({width,height:1000});
 await page.addInitScript(()=>localStorage.setItem("language","zh-CN"));
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:0,servers:[server]})));
 await page.route("**/*",r=>{
  const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();if(!u.pathname.startsWith("/api/"))return r.continue();
  let data:any=[];
  if(u.pathname==="/api/v1/profile")data={id:1};
  else if(u.pathname==="/api/v1/setting")data={tsdb_enabled:saved,config:{language:"zh-CN",show_network_in_detail:false,appearance_config:'{"version":1,"enabled":false,"features":{}}',doraemon_appearance_config:'{"version":1,"enabled":false,"features":{}}'}};
  else if(u.pathname.endsWith("/last-report"))data={server_id:7,tsdb_enabled:saved,history_days:30,...(saved?{last_report_at:at,snapshot:{at,host:server.host,state},metrics,recent}:{metrics:{},recent:{}})};
  else if(u.pathname.endsWith("/online-history"))data={server_id:7,server_name:server.name,days:1,max_days:30,timezone:"Asia/Shanghai",window_start:new Date(now-3600000).toISOString(),window_end:new Date(now).toISOString(),total_online_seconds:1800,online_rate:50,currently_online:false,last_active:new Date(now-1800000).toISOString(),periods:[{start:new Date(now-3600000).toISOString(),end:new Date(now-1800000).toISOString(),ongoing:false}],daily:[{date:new Date(now+28800000).toISOString().slice(0,10),online_seconds:1800}]};
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto(origin+"/server/7");await expect(page.locator("[data-offline-detail]")).toBeVisible();
 const grid=page.locator(".server-charts");
 if(saved){
  await expect(grid.locator(".chart-detail-open")).toHaveCount(6);
  for(const chart of await grid.locator("[data-chart]").all()){await chart.scrollIntoViewIfNeeded();await expect(chart.locator(".recharts-cartesian-grid")).toBeVisible();}
  const cards=await grid.evaluate(el=>[...el.children].map(c=>({y:c.getBoundingClientRect().y,bottom:c.querySelector(".recharts-cartesian-grid")!.getBoundingClientRect().bottom})));
  if(width>1024)for(let i=0;i<cards.length;i++)if(i%3)expect(Math.abs(cards[i].bottom-cards[i-i%3].bottom)).toBeLessThan(1);
  await grid.locator(".chart-detail-open").first().click();await expect(page.getByRole("dialog")).toContainText("21 / 21");
  await page.getByRole("dialog").getByRole("button",{name:"Close"}).click();
 }
 await page.getByRole("button",{name:"最后状态",exact:true}).click();await page.getByRole("menuitem",{name:"在线率",exact:true}).click();
 await expect(page.locator("[data-online-history]")).toContainText("50.0%");
 await expect(page.getByRole("dialog")).toHaveCount(0);await expect(grid).toHaveCount(0);
 await page.locator("[data-online-history]").getByRole("button",{name:"在线率",exact:true}).click();await page.getByRole("menuitem",{name:"最后状态",exact:true}).click();
 if(saved)await expect(grid.locator(".chart-detail-open")).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
