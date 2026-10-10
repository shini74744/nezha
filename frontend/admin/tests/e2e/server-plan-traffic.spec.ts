import {test,expect,Page} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
async function setup(page:Page,theme:string,dark:boolean){
 const origin=theme==="doraemon"?"https://127.0.0.1:18478":"https://127.0.0.1:18477",now=Date.now();
 const servers=[1,2,3].map(id=>createServer({id,name:"周期节点"+id,last_active:new Date(now).toISOString()}));
 let fail=false,shift=false,requests=0;const writes:string[]=[];
 await page.addInitScript(({dark})=>{localStorage.setItem("language","zh-CN");localStorage.setItem("vite-ui-theme",dark?"dark":"light");localStorage.setItem("doraemon-sky",dark?"dark":"light");localStorage.setItem("showMap","0");},{dark});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,servers,online:3})));
 await page.route("**/*",r=>{
  const u=new URL(r.request().url());let data:any;
  if(u.pathname.startsWith("/api/")&&r.request().method()!=="GET")writes.push(u.pathname);
  if(u.pathname==="/api/v1/setting")data={config:{statistics_split:true,language:"zh-CN",site_name:"周期流量测试",custom_code:"",appearance_config:'{"version":1,"enabled":false,"features":{}}'},version:"test"};
  else if(u.pathname==="/api/v1/profile")return r.fulfill({json:{success:false}});
  else if(u.pathname==="/api/v1/server-group")data=[{group:{id:1,name:"单组"},servers:[2]}];
  else if(u.pathname==="/api/v1/service")data={services:{one:{service_name:"在线率原记录",up:Array(30).fill(1),down:Array(30).fill(0),delay:Array(30).fill(3)}},cycle_transfer_stats:{legacy:{name:"原监控规则",from:"2026-10-01T00:00:00+08:00",to:"2026-11-01T00:00:00+08:00",max:1024**4,transfer:{1:1024**3},server_name:{1:"周期节点1"},next_update:{1:"2026-10-10T12:00:00+08:00"}}}};
  else if(u.pathname==="/api/v1/server-traffic"){
   requests++;if(fail)return r.fulfill({status:503,json:{success:false}});
   data=Object.fromEntries([1,2,3].map(id=>[id,{quota_type:id===1?"limited":id===2?"unlimited":"unset",max:id===1?1024**4:0,used:(shift?2:1)*id*1024**3,in:id*1024**3,out:id*1024**3,direction:String(id===1?2:id===2?3:1),reset_day:id*5,from:shift?"2026-10-15T00:00:00+08:00":id===1?"2026-09-15T00:00:00+08:00":"2026-10-05T00:00:00+08:00",to:shift?"2026-11-15T00:00:00+08:00":"2026-10-15T00:00:00+08:00",partial:id===1,estimated:id===3}]));
  }else if(u.pathname.startsWith("/api/"))data=[];
  if(data!==undefined)return r.fulfill({json:{success:true,data}});
  if(u.origin!==origin)return r.abort();return r.continue();
 });
 await page.goto(origin);return {writes,get requests(){return requests},setFail:(v:boolean)=>fail=v,setShift:()=>shift=true};
}
for(const theme of ["default","doraemon"])for(const width of [390,1440])test("separate server traffic "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const state=await setup(page,theme,width===1440);
 const trigger=page.getByRole("button",{name:"选择统计视图",exact:true});
 await trigger.click();await expect(page.getByRole("menuitemradio")).toHaveCount(3);
 await page.getByRole("menuitemradio",{name:"周期流量",exact:true}).click();
 const section=page.locator('[data-statistics-view="cycle"]');
 await expect(section.locator("[data-statistics-card]")).toHaveCount(3);
 await expect(section.getByText("双向",{exact:true})).toBeVisible();
 await expect(section.getByText("单向 · 上传",{exact:true})).toBeVisible();
 await expect(section.getByText("单向 · 下载",{exact:true})).toBeVisible();
 await expect(section.getByText("无限流量",{exact:false})).toBeVisible();
 await expect(section.getByText("未设置配额",{exact:false})).toBeVisible();
 await expect(section.getByRole("progressbar")).toHaveCount(1);
 await expect(section.getByText(/2026\/09\/15/)).toBeVisible();
 await expect(section.getByText("上传（出站）")).toHaveCount(3);
 await expect(section.getByText("下载（入站）")).toHaveCount(3);
 await page.screenshot({path:info.outputPath("cycle-traffic.png"),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.locator("[data-group-switch]").getByRole("button",{name:"单组",exact:true}).click();
 await expect(section.locator("[data-statistics-card]")).toHaveCount(1);
 await expect(section.locator("[data-statistics-card]")).toHaveAttribute("data-server-id","2");
 await page.locator("[data-group-switch]").getByRole("button",{name:"全部",exact:true}).click();
 await page.reload();await expect(section.locator("[data-statistics-card]")).toHaveCount(3);
 await trigger.click();await page.getByRole("menuitemradio",{name:"流量统计",exact:true}).click();
 await expect(section).toHaveCount(0);await expect(page.getByText("原监控规则",{exact:true})).toBeVisible();
 await trigger.click();await page.getByRole("menuitemradio",{name:"在线率",exact:true}).click();
 await expect(page.getByText("在线率原记录",{exact:true})).toBeVisible();
 await expect(page.locator('[data-statistics-card="traffic"]')).toHaveCount(0);
 state.setShift();await trigger.click();await page.getByRole("menuitemradio",{name:"周期流量",exact:true}).click();
 await expect(section.getByText(/2026\/11\/15/)).toHaveCount(3);
 // Failed refresh must not masquerade as fresh current-cycle data.
 await page.getByRole("button",{name:"收起统计",exact:true}).click();state.setFail(true);
 await trigger.click();await page.getByRole("menuitemradio",{name:"周期流量",exact:true}).click();
 await expect(section.getByText("统计数据加载失败，请重试。")).toBeVisible();
 await expect(section.locator("[data-statistics-card]")).toHaveCount(0);
 state.setFail(false);await section.getByRole("button",{name:"重新加载"}).click();
 await expect(section.locator("[data-statistics-card]")).toHaveCount(3);
 await trigger.click();await page.getByRole("menuitemradio",{name:"周期流量",exact:true}).click();
 await expect(section).toHaveCount(0);
 expect(state.requests).toBeGreaterThan(2);expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

for(const theme of ["default","doraemon"])for(const width of [320,390,606,1024,1440])test("compact cycle usage note "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const state=await setup(page,theme,width===1024||width===1440);
 await page.route("**/api/v1/server-traffic",r=>r.fulfill({json:{success:true,data:Object.fromEntries([1,2,3].map(id=>[id,{
  quota_type:id===1?"limited":id===2?"unlimited":"unset",max:id===1?2*1024**4:0,used:8.6*1024**4,
  in:8.64*1024**4,out:8.6*1024**4,direction:"3",reset_day:12,
  from:"2026-09-12T00:00:00+08:00",to:"2026-10-12T00:00:00+08:00",partial:true,estimated:true,
 }]))}}));
 await page.getByRole("button",{name:"选择统计视图",exact:true}).click();
 await page.getByRole("menuitemradio",{name:"周期流量",exact:true}).click();
 const cards=page.locator('[data-statistics-card="cycle"]'),card=cards.first();
 await expect(cards).toHaveCount(3);
 await expect(card.locator(".cycle-traffic-note")).toHaveText("仅含已记录流量 · 部分数据为估算");
 await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow","100");
 await expect(card.locator(".cycle-traffic-percent")).toHaveText("430.0%");
 await expect(cards.nth(1).getByRole("progressbar")).toHaveCount(0);
 await expect(cards.locator("[data-cycle-flow-bar]")).toHaveCount(3);
 for(const [index,kind] of [[1,"unlimited"],[2,"unset"]] as const){
  const bar=cards.nth(index).locator("[data-cycle-flow-bar]");
  await expect(bar).toBeVisible();await expect(bar).toHaveAttribute("data-cycle-flow-bar",kind);
  await expect(bar).not.toHaveAttribute("aria-valuenow");await expect(cards.nth(index).locator(".cycle-traffic-percent")).toHaveCount(0);
  expect((await bar.boundingBox())!.height).toBe(6);
 }
 for(const current of await cards.all()){
  const layout=await current.evaluate(e=>{
   const box=(s:string)=>e.querySelector(s)!.getBoundingClientRect();
   const note=box(".cycle-traffic-note"),usage=box(".cycle-traffic-usage"),data=box("dl"),card=e.getBoundingClientRect();
   const percent=e.querySelector(".cycle-traffic-percent")?.getBoundingClientRect(),progress=e.querySelector('[data-cycle-flow-bar]')?.getBoundingClientRect();
   return {note:{x:note.x,y:note.y,right:note.right,bottom:note.bottom},usage:{right:usage.right,bottom:usage.bottom},dataY:data.y,
    percentX:percent?.x,progressY:progress?.y,card:{x:card.x,right:card.right,height:card.height}};
  });
  expect(layout.note.bottom).toBeLessThanOrEqual((layout.progressY??layout.dataY)+1);
  expect(layout.note.x).toBeGreaterThanOrEqual(layout.card.x);expect(layout.note.right).toBeLessThanOrEqual(layout.card.right);
  if(width>=480){expect(layout.note.x).toBeGreaterThanOrEqual(layout.usage.right-1);if(layout.percentX)expect(layout.note.right).toBeLessThanOrEqual(layout.percentX+1);}
  else expect(layout.note.y).toBeGreaterThanOrEqual(layout.usage.bottom-1);
  expect(layout.card.height).toBeLessThanOrEqual(170);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.locator('[data-statistics-view="cycle"]').screenshot({path:info.outputPath("compact-cycle-cards.png")});
 expect(errors).toEqual([]);expect(state.writes).toEqual([]);
});
