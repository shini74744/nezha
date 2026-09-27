import {createHash} from "node:crypto";
import {test,expect} from "@playwright/test";
import {curatedCarriers as carriers} from "../../../shared/carriers";
for(const width of [1366,390])test("global carriers and link tags editor "+width,async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width,height:950});
 const fixtureLogo=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=180;c.height=60;const ctx=c.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,180,60);ctx.fillStyle="#16a34a";ctx.fillRect(12,12,156,36);ctx.fillStyle="white";ctx.fillRect(36,24,20,12);return c.toDataURL("image/png")});
 const original={planDataMod:{networkRoute:"CN2,旧线路",custom:"keep"},unknown:{keep:true}};
 let server:any={id:11,host:{version:"2.3.5"},name:"全球运营商测试",display_index:0,user_id:1,uuid:"fixture",public_note:JSON.stringify(original),note:"",enable_ddns:false,hide_for_guest:false};
 const assets=new Map<string,string>();
 const catalog=carriers.map(c=>{const extension=c.icon.startsWith("data:image/svg")?"svg":"png";const path="/api/v1/logo/assets/"+createHash("sha256").update(Buffer.from(c.icon.split(",")[1],"base64")).digest("hex")+"."+extension;assets.set(path,c.icon);return {id:"carrier-"+c.id,kind:"carrier",name:c.label,regions:c.regions,aliases:c.aliases,logo:path,logoWebsite:c.assetSource,background:c.logoBackground||"",version:1}});
 const updates:any[]=[],errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();let data:any=[];
  if(path.startsWith("/api/v1/logo/assets/")){const value=assets.get(path);return route.fulfill({status:value?200:404,contentType:value?.split(";")[0].slice(5)||"image/png",body:value?Buffer.from(value.split(",")[1],"base64"):Buffer.alloc(0)})}
  if(path==="/api/v1/logo/library")data=catalog;
  if(path==="/api/v1/logo/store"){const body=route.request().postDataJSON();data={};for(const key of ["logo","logoOriginal"]){const value=body[key];const dst="/api/v1/logo/assets/"+createHash("sha256").update(Buffer.from(value.split(",")[1],"base64")).digest("hex")+".png";assets.set(dst,value);data[key]=dst}}
  if(path==="/api/v1/logo/fetch"){const body=route.request().postDataJSON();if(body.url==="failure.example")return route.fulfill({json:{success:false,error:"模拟网站无图标"}});data={image:fixtureLogo,source:"https://www.google.com/s2/favicons?domain=www.starhub.com"}}
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{site_name:"测试",language:"zh-CN"},version:"test"};
  if(path==="/api/v1/server")data=[server];
  if(path==="/api/v1/server/11"&&method!=="GET"){const body=route.request().postDataJSON();updates.push(body);server={...server,...body};}
  await route.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");
 const row=page.getByRole("row").filter({has:page.getByText("全球运营商测试",{exact:true})});
 await row.getByRole("button",{name:"编辑服务器",exact:true}).click();
 const dialog=page.getByRole("dialog"),editor=dialog.locator("[data-other-routes-editor]");
 await expect(dialog.getByText("更换 Logo",{exact:true})).toHaveCount(0);
 for(const name of ["服务器厂商 Logo","链接标签","网络路由","上传 Logo 服务器厂商"]){await dialog.getByRole("button",{name:name+"说明",exact:true}).click();await expect(page.locator("[data-setting-help]")).toBeVisible();await page.keyboard.press("Escape");await expect(page.locator("[data-setting-help]")).toHaveCount(0)}
 await expect(editor.locator("[data-other-routes-entry]")).toContainText("其他运营商");
 await expect(editor).not.toContainText("目录覆盖");
 for(const label of ["500G","1T","无限"])await dialog.getByRole("button",{name:label,exact:true}).click();
 await expect(dialog.getByPlaceholder("1TB/Month")).toHaveValue("无限流量");
 await dialog.getByRole("button",{name:"500G",exact:true}).click();
 async function color(label:string,hex:string){await dialog.getByRole("button",{name:label+"标签颜色",exact:true}).click();await page.getByLabel(label+"自定义颜色",{exact:true}).fill(hex);await page.keyboard.press("Escape")}
 await dialog.getByRole("button",{name:"中国电信标签颜色",exact:true}).click();
 await expect(page.locator("[data-color-palette]")).toBeVisible();await page.getByRole("button",{name:"预设颜色 #dc2626",exact:true}).click();
 await color("中国电信","#ffee00");await color("其他运营商","#112233");await color("线路 1","#55ccaa");
 await expect(editor.getByLabel("线路名称 1",{exact:true})).toHaveValue("旧线路");
 async function choose(label:string,search:string,option:string|RegExp){
  await editor.getByRole("combobox",{name:label,exact:true}).click();
  await page.getByRole("combobox",{name:"搜索"+label,exact:true}).fill(search);
  await page.getByRole("option",{name:option,exact:true}).click();
 }
 await editor.getByRole("combobox",{name:"国家地区 1",exact:true}).click();
 const list=page.locator("[data-carrier-picker-list]");
 await list.hover();await page.mouse.wheel(0,600);
 await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);
 if(width===390){
  const previous=await list.evaluate(e=>e.scrollTop),box=(await list.boundingBox())!;
  const session=await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+box.width/2,y:box.y+box.height-25}]});
  for(let n=1;n<=5;n++)await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x+box.width/2,y:box.y+box.height-25-n*30}]});
  await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBeGreaterThan(previous);
  await session.detach();
 }
 await page.keyboard.press("Escape");
 await editor.locator("[data-other-routes-entry]").scrollIntoViewIfNeeded();
 if(width>640){
  const unicom=(await dialog.locator("#route-unicom").boundingBox())!,entry=(await editor.getByRole("button",{name:"添加线路",exact:true}).boundingBox())!;
  expect(entry.x).toBeGreaterThan(unicom.x+unicom.width);expect(Math.abs(entry.y-unicom.y)).toBeLessThan(10);
 }
 await choose("国家地区 1","日本","日本");
 await editor.getByRole("combobox",{name:"运营商 Logo 1",exact:true}).click();
 await expect(page.getByRole("option",{name:"NTT",exact:true})).toBeVisible();
 await expect(page.getByRole("option",{name:"AT&T",exact:true})).toHaveCount(0);
 await page.getByRole("option",{name:"NTT",exact:true}).click();
 await editor.getByLabel("线路名称 1",{exact:true}).fill("AS2914");
 const route1=editor.locator("[data-other-route-row]").first(),originalIcon=await route1.locator("img").last().getAttribute("src");
 await route1.getByLabel("Logo 地址 1",{exact:true}).fill("www.starhub.com");
 await route1.getByRole("button",{name:"自动获取 Logo 1",exact:true}).click();
 await expect(route1.locator("img").last()).toHaveAttribute("src",/^\/api\/v1\/logo\/assets\//);
 await route1.getByRole("button",{name:"恢复自带 Logo",exact:true}).click();await expect(route1.locator("img").last()).toHaveAttribute("src",originalIcon!);
 await route1.getByLabel("Logo 地址 1",{exact:true}).fill("www.starhub.com");await route1.getByRole("button",{name:"自动获取 Logo 1",exact:true}).click();
 await expect(route1.getByRole("status")).toBeVisible();
 await editor.getByRole("button",{name:"添加线路",exact:true}).click();
 await choose("国家地区 2","美国","美国");await choose("运营商 Logo 2","Cogent","Cogent");
 await editor.getByLabel("线路名称 2",{exact:true}).fill("AS174");
 await editor.getByRole("button",{name:"添加线路",exact:true}).click();
 await choose("国家地区 3","新西兰","新西兰");await choose("运营商 Logo 3","手动","手动添加运营商");
 await editor.getByLabel("运营商名称 3",{exact:true}).fill("My NZ ISP");
 await editor.getByLabel("线路名称 3",{exact:true}).fill("Custom transit");
 await editor.getByLabel("上传 Logo 3",{exact:true}).setInputFiles({name:"logo.png",mimeType:"image/png",buffer:Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=512;c.height=128;const ctx=c.getContext("2d")!,d=ctx.createImageData(c.width,c.height);let seed=42;for(let i=0;i<d.data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;d.data[i]=i%4===3?255:seed>>>24;}ctx.putImageData(d,0,0);return c.toDataURL("image/png").split(",")[1]}),"base64")});
 await expect(editor.locator("[data-other-route-row]").nth(2).locator("img")).toHaveCount(1);
 await editor.getByRole("button",{name:"添加线路",exact:true}).click();
 await choose("国家地区 4","香港",/香港/);
 await choose("运营商 Logo 4","HGC","HGC 环球全域电讯");
 await editor.getByLabel("线路名称 4",{exact:true}).fill("AS9304");
 await editor.getByRole("button",{name:"添加线路",exact:true}).click();
 await editor.getByRole("button",{name:"删除线路 5",exact:true}).click();
 const provider=dialog.locator("[data-provider-logo-editor]");
 await provider.getByLabel("Logo 地址 服务器厂商",{exact:true}).fill("www.starhub.com");
 await provider.getByRole("button",{name:"自动获取 Logo 服务器厂商",exact:true}).click();
 await expect(provider.getByAltText("厂商 Logo 预览")).toHaveAttribute("src",/^\/api\/v1\/logo\/assets\//);
 await provider.getByLabel("Logo 地址 服务器厂商",{exact:true}).fill("failure.example");
 await provider.getByRole("button",{name:"自动获取 Logo 服务器厂商",exact:true}).click();await expect(provider.getByRole("alert")).toContainText("当前 Logo 未更改");
 await provider.scrollIntoViewIfNeeded();await page.screenshot({path:"test-results/provider-editor-"+width+".png",fullPage:true});
 const links=dialog.locator("[data-link-tags-editor]");
 await links.getByRole("button",{name:"添加链接标签",exact:true}).click();
 await links.getByLabel("标签名称 1",{exact:true}).fill("购买");
 await links.getByLabel("标签网址 1",{exact:true}).fill("https://example.com/buy");
 await editor.locator("[data-other-route-row]").first().scrollIntoViewIfNeeded();await page.screenshot({path:"test-results/global-editor-"+width+".png",fullPage:true});
 await dialog.getByRole("button",{name:"原始文本",exact:true}).click();
 const raw=dialog.getByRole("textbox",{name:"公开备注原始文本"}),doc=JSON.parse(await raw.inputValue());
 expect(doc.套餐信息.其他运营商线路[0]).toMatchObject({运营商:"ntt",国家地区:"JP",线路名称:"AS2914"});
 expect(doc.套餐信息.其他运营商线路[2].Logo地址).toContain("/api/v1/logo/assets/");
 expect(doc.套餐信息.其他运营商线路[3]).toMatchObject({运营商:"hgc",国家地区:"HK",线路名称:"AS9304"});
 expect(doc.套餐信息.链接标签).toEqual([{名称:"购买",网址:"https://example.com/buy"}]);
 await dialog.getByRole("button",{name:"自定义字段",exact:true}).click();
 await dialog.locator('button[type="submit"]').click();await expect.poll(()=>updates.length).toBe(1);
 const saved=JSON.parse(updates[0].public_note);
 expect(saved.planDataMod.networkRoute).toBe("CN2,AS2914,AS174,Custom transit,AS9304");
 expect(saved.planDataMod.trafficVol).toBe("500G/月");
 expect(saved.planDataMod.providerLogo.logoWebsite).toBe("www.starhub.com");expect(assets.get(saved.planDataMod.providerLogo.logoOriginal)).toBe(fixtureLogo);
 expect(saved.planDataMod.networkRouteEntries[0].logoWebsite).toBe("www.starhub.com");
 expect(saved.planDataMod.networkRouteColors).toEqual({telecom:"#ffee00",other:"#112233"});
 expect(saved.planDataMod.networkRouteEntries[0].color).toBe("#55ccaa");
 expect(saved.unknown).toEqual({keep:true});expect(saved.planDataMod.custom).toBe("keep");
 await row.getByRole("button",{name:"编辑服务器",exact:true}).click();
 await expect(editor.getByRole("combobox",{name:"国家地区 1",exact:true})).toHaveText("日本");
 await expect(editor.getByRole("combobox",{name:"运营商 Logo 1",exact:true})).toContainText("NTT");
 await expect(editor.getByLabel("运营商名称 3",{exact:true})).toHaveValue("My NZ ISP");
 await expect(links.getByLabel("标签名称 1",{exact:true})).toHaveValue("购买");
 expect(errors).toEqual([]);
});
test("collected carrier logos decode",async({page})=>{
 await page.setViewportSize({width:1000,height:1200});
 await page.setContent('<body style="background:#171717;color:white;font:14px sans-serif"><main style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px"></main></body>');
 await page.evaluate(list=>{
  const main=document.querySelector("main")!;
  for(const c of list){const d=document.createElement("div"),im=document.createElement("img"),label=document.createElement("div");
   im.src=c.icon;im.style.cssText="width:100px;height:48px;object-fit:contain";im.style.backgroundColor=c.logoBackground||"";label.textContent=c.label;d.append(im,label);main.append(d);}
 },carriers);
 await expect.poll(()=>page.locator("img").evaluateAll(imgs=>imgs.every(im=>(im as HTMLImageElement).complete&&(im as HTMLImageElement).naturalWidth>0))).toBe(true);
 await page.screenshot({path:"test-results/global-logo-catalog.png",fullPage:true});
});
