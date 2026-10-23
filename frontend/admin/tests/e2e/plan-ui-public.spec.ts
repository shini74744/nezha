import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
for(const theme of ["default","doraemon"])for(const width of [320,390,1440])for(const inline of ["0","1"])test("public value and tag colors "+theme+" "+width+" inline="+inline,async({page},info)=>{
 test.setTimeout(60000);
 await page.setViewportSize({width,height:900});
 await page.clock.setFixedTime(new Date("2026-10-16T00:00:00+08:00"));
 await page.addInitScript((inline)=>{localStorage.setItem("language","zh-CN");localStorage.setItem("inline",inline);localStorage.setItem("showMap","0");localStorage.setItem("showServices","0");localStorage.setItem("vite-ui-theme","light");localStorage.setItem("doraemon-sky","light")},inline);
 const now=Date.parse("2026-10-16T00:00:00+08:00");
 const planDataMod={bandwidth:"1000Mbps",trafficVol:"无限",IPv4:"1",networkRouteEntries:[{carrier:"",text:"台湾Hinet动态住宅家宽",logo:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0cAAAAASUVORK5CYII="}],networkRoute:"163/PP/CN2",extra:"香港HKT动态住宅家宽,台湾Hinet动态住宅家宽,中文很长的备注用于验证换行后仍然居中而不是溢出卡片,LongUnbrokenLabel"+ "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(4)+",5",extraColors:["#ffffff","#111827"],linkTags:[{name:"默认蓝色",url:"example.com"},{name:"自选颜色",url:"example.com",color:"#ffffff"}]};
 const servers=["31USD","","0"].map((amount,i)=>createServer({id:11+i,name:"价值验证"+i,last_active:i===0?"0001-01-01T00:00:00Z":new Date(now).toISOString(),public_note:JSON.stringify({billingDataMod:{amount,cycle:"Month",startDate:"2026-10-01T00:00:00+08:00",endDate:"2026-11-01T00:00:00+08:00",autoRenewal:"0"},planDataMod})}));
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:2,servers})));
 await page.route("**/api/v1/**",r=>{const p=new URL(r.request().url()).pathname;let data:any=[];
  if(p==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"验证",appearance_config:'{"version":1,"enabled":false,"features":{}}'}};
  if(p.includes("/service"))data={services:{},cycle_transfer_stats:{}};
  if(p==="/api/v1/server-traffic")data={};
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto("https://127.0.0.1:"+(theme==="default"?"18477":"18478")+"/");
 const cards=page.locator(theme==="doraemon"?"article":"[data-server-card]");
 const card=cards.filter({has:page.getByText("价值验证0",{exact:true})});
 await expect(card).toBeVisible();
 const price=card.locator("[data-billing-price]:visible");
 await expect(price).toHaveAttribute("title",/价格: 31USD\/月\n预估剩余价值: ≈16\.00 USD/);
 await expect(card.locator("[data-billing-value]")).toHaveCount(0);
 await expect(card.getByText(/预估剩余价值/)).toHaveCount(0);
 const beforeHover=await card.boundingBox();
 await price.hover();
 expect((await card.boundingBox())?.height).toBe(beforeHover?.height);
 await expect(card.locator('[data-extra-note="0"]:visible')).toHaveCSS("background-color","rgb(255, 255, 255)");
 await expect(card.locator('[data-extra-note="1"]:visible')).toHaveCSS("color","rgb(255, 255, 255)");
 await expect(card.getByRole("link",{name:"默认蓝色",exact:true})).toHaveClass(/bg-sky-700/);
 expect(await card.getByRole("link",{name:"默认蓝色",exact:true}).evaluate(el=>el.style.backgroundColor)).toBe("");
 await expect(card.getByRole("link",{name:"自选颜色",exact:true})).toHaveCSS("color","rgb(0, 0, 0)");
 for(const i of [1,2])await expect(cards.filter({has:page.getByText("价值验证"+i,{exact:true})}).locator("[data-billing-value]")).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 const badges=card.locator('[data-extra-note]:visible, [data-carrier]:visible, [data-other-carrier]:visible');
 for(const badge of await badges.all()){
  await expect(badge).toHaveCSS("align-items","center");await expect(badge).toHaveCSS("justify-content","center");await expect(badge).toHaveCSS("text-align","center");
  expect(await badge.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const centered=await badge.evaluate(el=>{
   const box=el.getBoundingClientRect(),span=el.querySelector("span")!.getBoundingClientRect();
   const img=el.querySelector("img,svg")?.getBoundingClientRect();
   return {vertical:Math.abs(box.y+box.height/2-span.y-span.height/2),horizontal:img?0:Math.abs(box.x+box.width/2-span.x-span.width/2),icon:img?Math.abs(box.y+box.height/2-img.y-img.height/2):0,height:box.height};
  });
  expect(centered.vertical).toBeLessThanOrEqual(1);expect(centered.horizontal).toBeLessThanOrEqual(1);expect(centered.icon).toBeLessThanOrEqual(1);expect(centered.height).toBeGreaterThanOrEqual(18);
 }
 await card.screenshot({path:info.outputPath("card.png")});expect(errors).toEqual([]);
 if(theme==="doraemon"){await price.click();await expect(page).toHaveURL(/\/server\/11$/)}

});
