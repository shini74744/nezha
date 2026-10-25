import {test,expect} from "@playwright/test";
for(const width of [390,1440])for(const theme of ["light","dark"])test("hide unavailable IP family "+width+" "+theme,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(t=>localStorage.setItem("nezha-dashboard-theme",t),theme);
 const writes:string[]=[];
 await page.route("**/api/v1/**",async route=>{
  const req=route.request(),u=new URL(req.url());if(!["GET","HEAD"].includes(req.method()))writes.push(u.pathname);
  let data:any=[];
  if(u.pathname==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(u.pathname==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"};
  if(u.pathname==="/api/v1/server/operation-servers")data={value:[{server_uuid:"fixture-node",server_id:81,server_name:"双栈展示测试",position:1,count:3,last_id:3,last_at:1792886400000,deleted:false}],pagination:{total:1}};
  if(u.pathname==="/api/v1/server/operations")data={value:[false,true,false].map((observed,i)=>({
   id:3-i,created_at:"2026-10-26T04:15:53+08:00",server_uuid:"fixture-node",server_id:81,server_name:"双栈展示测试",source:"agent",actor_name:"Agent",action:"inventory_change",
   changes:[{field:"ipv4",before:"192.0.2.1",after:"192.0.2.2"}],
   details:{ip_snapshot:[{field:"ipv6",before:i===0?"未记录":"2001:db8::1",after:i===0?"未记录":"2001:db8::1",observed}]},
  })),pagination:{total:3}};
  await route.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");
 await page.getByRole("button",{name:"历史记录",exact:true}).click();const dialog=page.getByRole("dialog");
 await dialog.getByRole("button",{name:/双栈展示测试.*系统 ID 81/}).click();
 const rows=dialog.locator("details");await expect(rows).toHaveCount(3);
 for(const row of await rows.all())await row.locator("summary").click();
 await expect(rows.nth(0)).toContainText("IPv4");await expect(rows.nth(0)).not.toContainText("IPv6");await expect(rows.nth(0)).not.toContainText("未记录");
 await expect(rows.nth(1)).toContainText("IPv6");await expect(rows.nth(1)).toContainText("2001:db8::1");await expect(rows.nth(1)).toContainText("未变化");
 await expect(rows.nth(2)).not.toContainText("2001:db8::1");
 for(const row of await rows.all())await expect(row.locator("summary")).toContainText("1 项变更");
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(writes).toEqual([]);
 await dialog.screenshot({path:info.outputPath("ip-presence.png")});
});
