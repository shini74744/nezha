import {test,expect} from "@playwright/test";
for(const width of [390,1440])test("independent editable latency policy "+width,async({page},info)=>{
 test.setTimeout(60000);
 await page.setViewportSize({width,height:900});let writes=0,otherWrites=0;
 let config={enabled:false,interval_hours:2,retention_days:1,revision:"r1",targets:[{id:"gd-ct",region:"华南",province:"广东",carrier:"电信",host:"gd-ct-v4.ip.zstaticcdn.com",port:80,enabled:true}]};
 await page.route("**/api/v1/**",route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,role:0,username:"admin"};
  if(path==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"测试"},frontend_templates:[]};
  if(path==="/api/v1/setting/detection-priority")data={order:["connectivity","bgp","return-route","streaming"],revision:"p1"};
  if(path==="/api/v1/setting/connectivity")data={items:[],defaults:[],revision:"c1",max_targets:120};
  if(path.endsWith("/automation"))data={enabled:true,interval_hours:2,retention_days:1,revision:"a1"};
  if(path==="/api/v1/setting/return-route")data={enabled:false,interval_hours:2,retention_days:1,targets:[],revision:"a1"};
  if(path==="/api/v1/setting/latency"){if(req.method()==="PUT"){writes++;config={...req.postDataJSON(),revision:"r"+(writes+1)}}data=config}
  else if(req.method()==="PUT"||req.method()==="PATCH")otherWrites++;
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard/settings/cards");await page.getByRole("tab",{name:"延迟",exact:true}).click();
 const view=page.locator("[data-latency-settings]");await expect(view).toBeVisible();
 await expect(view.getByRole("switch",{name:"延迟自动检测"})).not.toBeChecked();
 await view.getByRole("spinbutton",{name:"延迟检测间隔（小时）"}).fill("6");
 await view.getByRole("spinbutton",{name:"延迟记录保留（天）"}).fill("7");
 await view.locator("summary").click();
 await expect(view.getByRole("textbox",{name:"gd-ct ipv6_host",exact:true})).toHaveValue("gd-ct-v6.ip.zstaticcdn.com");
 await view.getByRole("textbox",{name:"gd-ct host",exact:true}).fill("example.com");
 await expect(view.getByRole("textbox",{name:"gd-ct ipv6_host",exact:true})).toHaveValue("gd-ct-v6.ip.zstaticcdn.com");
 await view.getByRole("textbox",{name:"gd-ct ipv6_host",exact:true}).fill("v6.example.com");
 await view.getByRole("spinbutton",{name:"gd-ct 端口"}).fill("443");
 await view.screenshot({path:info.outputPath("latency-policy.png")});
 expect(await view.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await view.getByRole("button",{name:"保存延迟设置"}).click();await expect.poll(()=>writes).toBe(1);
 expect(config).toMatchObject({enabled:false,interval_hours:6,retention_days:7});expect(config.targets[0]).toMatchObject({host:"example.com",ipv6_host:"v6.example.com",port:443});
 await page.reload();await page.getByRole("tab",{name:"延迟",exact:true}).click();
 await expect(view.getByRole("spinbutton",{name:"延迟检测间隔（小时）"})).toHaveValue("6");
 await expect(view.getByRole("spinbutton",{name:"延迟记录保留（天）"})).toHaveValue("7");
 expect(otherWrites).toBe(0);
});
