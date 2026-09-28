import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
const asset="/api/v1/logo/assets/"+"d".repeat(64)+".svg";
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" fill="#dc143c"/><path d="M30 25v50m40-50v50M30 50h40" stroke="white" stroke-width="10"/></svg>';
for(const width of [360,390,430,1366])for(const variant of ["short","long","no-expiry","wide"])test("logo overlay preserves all content "+width+" "+variant,async({page})=>{
 let show=false;const now=Date.now(),name=variant==="long"?"这是一个非常长而且会发生换行变化的服务器名字-香港优化线路":"HK 测试机器";
 const note=()=>({...(variant==="no-expiry"?{}:{billingDataMod:{startDate:"2026-09-01T00:00:00+08:00",endDate:"2027-09-01T00:00:00+08:00"}}),planDataMod:{trafficVol:"1TB/月",...(show?{providerLogo:{logo:asset}}:{})}});
 await page.setViewportSize({width,height:900});await page.addInitScript(()=>{localStorage.setItem("inline","0");localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:1,servers:[createServer({id:11,name,last_active:new Date(now).toISOString(),public_note:JSON.stringify(note())})]})));
 await page.route("**/api/v1/**",r=>{const path=new URL(r.request().url()).pathname;if(path===asset)return r.fulfill({contentType:"image/svg+xml",body:variant==="wide"?'<svg xmlns="http://www.w3.org/2000/svg" width="186" height="39"><rect width="186" height="39" fill="purple"/></svg>':svg});let data:any=[];if(path==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"布局回归"}};if(path.includes("/service"))data={services:{},cycle_transfer_stats:{}};if(path==="/api/v1/server-traffic")data={};return r.fulfill({json:{success:true,data}})});
 const snapshot=()=>page.locator("[data-server-card]").evaluate(el=>{const c=el.getBoundingClientRect();return {height:c.height,items:["[data-server-name]","[data-server-flag]","[data-server-status]","[data-mobile-billing]","[data-server-billing]","[data-metric-label=cpu]","[data-metric-label=memory]"].map(s=>{const r=el.querySelector(s)!.getBoundingClientRect();return [r.x-c.x,r.y-c.y,r.width,r.height]})}});
 await page.goto("/");await expect(page.locator("[data-server-name]")).toHaveText(name);const before=await snapshot();show=true;await page.reload();const image=page.locator("[data-provider-logo]");await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);expect(await snapshot()).toEqual(before);
 const r=await image.boundingBox();const cardRect=await page.locator("[data-server-card]").boundingBox();expect(r!.y).toBeGreaterThanOrEqual(cardRect!.y);if(width<1024){expect(r!.height).toBeLessThanOrEqual(24);expect(r!.width).toBeLessThanOrEqual(64);
 const slot=await page.locator("[data-server-card]").evaluate(el=>{const a=el.querySelector('[data-metric-label="cpu"]')!.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(el.querySelector('[data-metric-label="memory"]')!);const b=range.getBoundingClientRect();return {left:a.left,right:b.right,top:a.top}});
 expect(Math.abs(r!.x+r!.width/2-(slot.left+slot.right)/2)).toBeLessThan(1);expect(r!.y+r!.height).toBeLessThanOrEqual(slot.top-4);
 const obstacles=await page.locator("[data-server-card]").evaluate(el=>[...el.querySelectorAll("[data-server-name],[data-server-status],[data-server-flag],[data-mobile-billing] [data-billing-expiry],[data-mobile-billing] [data-billing-price],[data-mobile-billing] [data-expiry-progress],[data-mobile-billing] [data-server-link-tags]")].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}));
 for(const o of obstacles)expect(r!.x<o.x+o.width&&r!.x+r!.width>o.x&&r!.y<o.y+o.height&&r!.y+r!.height>o.y).toBe(false);
 const innerTop=await page.locator("[data-server-card]").evaluate(el=>el.getBoundingClientRect().top+(el as HTMLElement).clientTop);
 let gaps=[{top:innerTop+12,bottom:slot.top-4}];
 for(const o of obstacles.filter(o=>r!.x<o.x+o.width+2&&r!.x+r!.width>o.x-2))gaps=gaps.flatMap(g=>o.y+o.height+2<=g.top||o.y-2>=g.bottom?[g]:[{top:g.top,bottom:Math.min(g.bottom,o.y-2)},{top:Math.max(g.top,o.y+o.height+2),bottom:g.bottom}]).filter(g=>g.bottom-g.top>=r!.height);
 const gap=gaps.find(g=>r!.y>=g.top-1&&r!.y+r!.height<=g.bottom+1)!;expect(gap).toBeTruthy();expect(Math.abs(r!.y+r!.height/2-(gap.top+gap.bottom)/2)).toBeLessThan(1);
 if(variant==="short")console.log("MOBILE_LOGO_BOUNDS",JSON.stringify({viewport:width,logo:r,slot}));
 }else{
 const center=await page.locator("[data-server-identity]").evaluate(el=>{const bar=el.querySelector("[data-expiry-progress]")?.getBoundingClientRect();return bar?bar.left+bar.width/2:el.getBoundingClientRect().left+76});expect(Math.abs(r!.x+r!.width/2-center)).toBeLessThan(1);
 const region=await page.locator("[data-server-card]").evaluate(el=>({top:el.getBoundingClientRect().top+(el as HTMLElement).clientTop,bottom:el.querySelector("[data-server-identity]")!.getBoundingClientRect().top-4}));
 expect(Math.abs(r!.y+r!.height/2-((region.top+region.bottom)/2+3))).toBeLessThan(1);
 const bounds=await page.locator("[data-provider-logo-box]").boundingBox();expect(bounds!.width).toBe(70);if(variant==="wide"){const bar=await page.locator("[data-server-billing] [data-expiry-progress]").boundingBox();expect(r!.width).toBeCloseTo(bar!.width,1);expect(r!.x).toBeCloseTo(bar!.x,1);console.log("EXPIRY_LOGO_BOUNDS",JSON.stringify({logo:r,expiry:bar}));}
 }
 await page.screenshot({path:"test-results/logo-layout-"+width+"-"+variant+".png",fullPage:true});
});

for(const width of [360,390,430,1366])for(const online of [true,false])test("mobile expiry stays fixed when price changes "+width+" "+online,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.addInitScript(()=>{localStorage.setItem("inline","0");localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")});
 let amount="",endDate="2027-09-01T00:00:00+08:00";
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now:Date.now(),online:online?1:0,servers:[createServer({id:11,name:"美国堪萨斯母鸡2",last_active:online?new Date().toISOString():"2020-01-01T00:00:00Z",public_note:JSON.stringify({billingDataMod:{startDate:endDate?"2026-09-01T00:00:00+08:00":"",endDate,cycle:"Year",amount}})})]})));
 await page.route("**/api/v1/**",r=>{const path=new URL(r.request().url()).pathname;let data:any=[];if(path==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"到期固定测试"}};if(path.includes("/service"))data={services:{},cycle_transfer_stats:{}};if(path==="/api/v1/server-traffic")data={};return r.fulfill({json:{success:true,data}})});
 const snapshot=()=>page.locator("[data-server-card]").evaluate(el=>{
  const c=el.getBoundingClientRect(),rect=(s:string)=>{const e=el.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [r.x-c.x,r.y-c.y,r.width,r.height]};
  return {size:[c.width,c.height],expiry:rect("[data-mobile-billing-row] [data-billing-expiry]"),bar:rect("[data-mobile-billing-row] [data-expiry-progress]"),name:rect("[data-server-name]"),cpu:rect("[data-metric-label=cpu]"),memory:rect("[data-metric-label=memory]")};
 });
 let baseline:any;
 for(const value of ["","$251.16","$99999999999.99","0","-1"]){
  amount=value;await page.goto("/");await expect(page.locator("[data-server-name]")).toHaveText("美国堪萨斯母鸡2");
  await page.evaluate(()=>document.fonts.ready);
  const current=await snapshot();
  if(width<1024){
   if(baseline)expect(current).toEqual(baseline);else{
    baseline=current;
    const originalLayout=await page.addStyleTag({content:"@media(max-width:1023px){[data-mobile-billing],[data-mobile-billing-row]{width:auto!important;min-width:auto!important}[data-mobile-billing-row]{display:flex!important}}"});
    expect(await snapshot()).toEqual(current);
    await originalLayout.evaluate(el=>el.remove());
   }
   if(value){
    const price=(await page.locator("[data-mobile-billing-row] [data-billing-price]").boundingBox())!,bar=(await page.locator("[data-mobile-billing-row] [data-expiry-progress]").boundingBox())!,card=(await page.locator("[data-server-card]").boundingBox())!;
    expect(price.x).toBeGreaterThanOrEqual(bar.x+bar.width+7);
    expect(price.x+price.width).toBeLessThanOrEqual(card.x+card.width);
    expect(price.height).toBe(15);
   }
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }else if(value){
   const price=(await page.locator("[data-server-billing] [data-billing-price]").boundingBox())!,expiry=(await page.locator("[data-server-billing] [data-billing-expiry]").boundingBox())!;
   expect(price.y).toBeLessThan(expiry.y);
  }
  if(value==="$251.16")await page.locator("[data-server-card]").screenshot({path:"test-results/mobile-expiry-price-"+width+"-"+online+".png"});
 }
 if(width<1024){
  for(const date of ["0000-00-00T00:00:00+08:00",""]){
   endDate=date;amount="";await page.goto("/");await expect(page.locator("[data-server-name]")).toHaveText("美国堪萨斯母鸡2");
   const before=await snapshot();amount="$251.16";await page.reload();await expect(page.locator("[data-mobile-billing-row] [data-billing-price]")).toBeVisible();
   const after=await snapshot();
   if(date)expect(after).toEqual(before);
   else{expect(after.expiry).toBeNull();expect(after.bar).toBeNull()}
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
 }
});

for(const width of [390,1366])test("provider groups and live card preview "+width,async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.setViewportSize({width,height:950});
 const now=Date.now();let groups:any[]=[],entries:any[]=[{id:"provider-test",kind:"provider",name:"香港常用云",regions:[],aliases:"HK Cloud",groupId:"",logo:asset,version:1}];
 let server:any={id:11,host:{version:"2.3.5"},name:"卡片实时调整",display_index:0,user_id:1,uuid:"fixture",public_note:JSON.stringify({keep:1,billingDataMod:{startDate:"2026-09-01T00:00:00+08:00",endDate:"2027-09-01T00:00:00+08:00"},planDataMod:{providerLogo:{logo:asset,logoLibraryId:"provider-test",logoLibraryName:"香港常用云"}}}),note:"",enable_ddns:false,hide_for_guest:false};let saves=0;
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:1,servers:[createServer({id:11,name:server.name,last_active:new Date(now).toISOString()})]})));
 await page.route("**/api/v1/**",async r=>{const path=new URL(r.request().url()).pathname,method=r.request().method();let data:any=[];
 if(path===asset)return r.fulfill({contentType:"image/svg+xml",body:svg});if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};if(path==="/api/v1/setting")data={config:{site_name:"测试",language:"zh-CN",custom_code:'<div id="legacy-preview-decoration">页面装饰不应出现在卡片预览</div>',appearance_config:JSON.stringify({version:1,enabled:true,features:{background:{enabled:true,desktopMedia:[{type:"image",src:new URL(asset,r.request().url()).href}],mobileMedia:[{type:"image",src:new URL(asset,r.request().url()).href}],nightEnabled:false},quote:{enabled:true},network:{enabled:true},sideImage:{enabled:true}}})},version:"test"};
 if(path==="/api/v1/logo/library")data=entries;if(path==="/api/v1/logo/groups"){if(method==="POST"){data={...r.request().postDataJSON(),id:"group-1",version:1};groups.push(data)}else data=groups}
 if(path==="/api/v1/logo/groups/group-1"){if(method==="DELETE"){groups=[];entries[0].groupId="";data=null}else{groups[0]={...groups[0],...r.request().postDataJSON(),version:2};data=groups[0]}}
 if(path==="/api/v1/logo/library/provider-test"&&method==="PUT"){entries[0]={...entries[0],...r.request().postDataJSON(),version:2};data={entry:entries[0],updated_servers:0}}
 if(path==="/api/v1/server")data=[server];if(path==="/api/v1/server/11"&&method==="PATCH"){server={...server,...r.request().postDataJSON()};saves++;data=null}
 if(path.includes("/service"))data={services:{},cycle_transfer_stats:{}};if(path==="/api/v1/server-traffic")data={};
 return r.fulfill({json:{success:true,data}})});
 await page.goto("/dashboard/settings/icons");await page.getByRole("button",{name:"新建分组",exact:true}).click();await page.getByLabel("分组名称",{exact:true}).fill("香港常用");await page.getByRole("button",{name:"保存分组",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.locator("[data-library-row]")).toHaveCount(0);
 await page.getByRole("combobox",{name:"厂商分组",exact:true}).click();await page.getByRole("option",{name:"全部分组",exact:true}).click();await page.getByRole("button",{name:"修改 香港常用云",exact:true}).click();await page.getByRole("combobox",{name:"所属厂商分组",exact:true}).click();await page.getByRole("option",{name:"香港常用",exact:true}).click();await page.getByRole("button",{name:"保存",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.goto("/dashboard");await page.getByRole("row").filter({has:page.getByText("卡片实时调整",{exact:true})}).getByRole("button",{name:"编辑服务器",exact:true}).click();
 const dialog=page.getByRole("dialog"),preview=page.frameLocator('iframe[title="服务器卡片实时预览"]'),img=preview.locator("[data-provider-logo]"),editor=dialog.locator("[data-provider-layout-editor]");
 await expect(editor).toHaveCount(0);await expect(dialog.getByRole("combobox",{name:"选择服务器厂商",exact:true})).toHaveCount(0);await expect(dialog.getByRole("button",{name:"服务器厂商 Logo",exact:true})).toHaveAttribute("aria-expanded","false");await dialog.getByRole("button",{name:"服务器厂商 Logo",exact:true}).click();await dialog.getByRole("button",{name:"卡片调整",exact:true}).click();await editor.scrollIntoViewIfNeeded();await expect(img).toBeVisible();await expect(editor).not.toContainText("正在加载");expect(saves).toBe(0);
 await expect(preview.locator("[data-server-card]")).toHaveCount(1);await expect(preview.locator("#legacy-preview-decoration")).toHaveCount(0);await expect(preview.locator(".nz-media")).toHaveCount(0);
 await expect(preview.locator("[data-server-card]")).toHaveCSS("flex-direction","column");
 expect(await preview.locator("[data-server-card]").evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})).toBe(true);
 await preview.locator("[data-card-preview]").screenshot({path:"test-results/isolated-card-mobile-"+width+".png"});
 await editor.getByLabel("左右偏移",{exact:true}).fill("12");await editor.getByLabel("上下偏移",{exact:true}).fill("-5");await editor.getByLabel("图标大小",{exact:true}).fill("75");await expect(img).toHaveCSS("transform","matrix(0.75, 0, 0, 0.75, 12, -5)");
 await editor.getByRole("button",{name:"电脑端",exact:true}).click();await expect(preview.locator("[data-server-card]")).toHaveCSS("flex-direction","row");await preview.locator("[data-card-preview]").screenshot({path:"test-results/isolated-card-desktop-"+width+".png"});await expect(editor.getByLabel("左右偏移",{exact:true})).toHaveValue("0");await editor.getByLabel("左右偏移",{exact:true}).fill("-8");await editor.getByLabel("图标大小",{exact:true}).fill("125");await expect(img).toHaveCSS("transform","matrix(1.25, 0, 0, 1.25, -8, 0)");
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await editor.scrollIntoViewIfNeeded();await editor.screenshot({path:"test-results/provider-layout-editor-"+width+".png"});await editor.getByRole("button",{name:"手机端",exact:true}).click();await expect(editor.getByLabel("左右偏移",{exact:true})).toHaveValue("12");expect(saves).toBe(0);
 await dialog.locator('button[type="submit"]').click();await expect(dialog).toHaveCount(0);expect(saves).toBe(1);expect(JSON.parse(server.public_note)).toMatchObject({keep:1,planDataMod:{providerLogo:{logoLibraryId:"provider-test",logoLayout:{desktop:{x:-8,scale:125},mobile:{x:12,y:-5,scale:75}}}}});
 await page.reload();await page.getByRole("row").filter({has:page.getByText("卡片实时调整",{exact:true})}).getByRole("button",{name:"编辑服务器",exact:true}).click();await expect(editor).toHaveCount(0);await expect(dialog.getByRole("combobox",{name:"选择服务器厂商",exact:true})).toHaveCount(0);await expect(dialog.getByRole("button",{name:"服务器厂商 Logo",exact:true})).toHaveAttribute("aria-expanded","false");await dialog.getByRole("button",{name:"服务器厂商 Logo",exact:true}).click();await dialog.getByRole("button",{name:"卡片调整",exact:true}).click();await expect(editor.getByLabel("左右偏移",{exact:true})).toHaveValue("12");await editor.getByRole("button",{name:"恢复手机端默认",exact:true}).click();await expect(editor.getByLabel("图标大小",{exact:true})).toHaveValue("100");await dialog.press("Escape");expect(saves).toBe(1);
 await page.goto("/dashboard/settings/icons");await page.getByRole("combobox",{name:"厂商分组",exact:true}).click();await page.getByRole("option",{name:"香港常用",exact:true}).click();await expect(page.locator("[data-library-row]")).toHaveCount(1);page.on("dialog",d=>d.accept());await page.getByRole("button",{name:"删除分组",exact:true}).click();await expect(page.locator("[data-library-row]")).toHaveCount(1);expect(entries[0].groupId).toBe("");expect(errors).toEqual([]);
});
