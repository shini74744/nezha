import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
test.use({ignoreHTTPSErrors:true});
for(const theme of ["default","doraemon"])for(const width of [320,390,1440])for(const inline of ["0","1"])test("public value and tag colors "+theme+" "+width+" inline="+inline,async({page},info)=>{
 test.setTimeout(60000);
 await page.setViewportSize({width,height:900});
 await page.clock.setFixedTime(new Date("2026-10-16T00:00:00+08:00"));
 await page.addInitScript((inline)=>{localStorage.setItem("language","zh-CN");localStorage.setItem("inline",inline);localStorage.setItem("showMap","0");localStorage.setItem("showServices","0");localStorage.setItem("vite-ui-theme","light");localStorage.setItem("doraemon-sky","light")},inline);
 const now=Date.parse("2026-10-16T00:00:00+08:00");
 const planDataMod={bandwidth:"2000Mbps",trafficVol:"2TB/月",IPv4:"1",IPv6:"1",networkRouteEntries:[{carrier:"",text:"台湾Hinet动态住宅家宽",logo:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0cAAAAASUVORK5CYII="}],networkRoutes:{telecom:"163PP/CN2",mobile:"CMI/CMIN2",unicom:"10099/9929",other:"IX"},extra:"香港HKT动态住宅家宽,台湾Hinet动态住宅家宽,三网顶级优化,中文很长的备注用于验证换行后仍然居中而不是溢出卡片,LongUnbrokenLabel"+ "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(4)+",5",extraColors:["#ffffff","#111827"],linkTags:[{name:"默认蓝色",url:"example.com"},{name:"自选颜色",url:"example.com",color:"#ffffff"}]};
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
 if(info.project.name.includes("fallback"))await page.addStyleTag({content:".plan-badge-text{text-box-trim:none!important}"});
 if(width===1440)await page.addStyleTag({content:"[data-plan-info]{font-family:Arial,sans-serif;font-weight:700}"});
 const cards=page.locator(theme==="doraemon"?"article":"[data-server-card]");
 const card=cards.filter({has:page.getByText("价值验证0",{exact:true})});
 await expect(card).toBeVisible();
 if(theme==="default"&&width===1440&&inline==="0"){
  for(const item of await cards.all())expect(await item.locator("[data-server-identity]").evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(159);
 }

 const price=card.locator("[data-billing-price]:visible");
 await expect(price).toHaveAttribute("title",/价格: 31USD\/月\n预估剩余价值: ≈16\.00 USD/);
 await expect(card.locator("[data-billing-value]")).toHaveCount(0);
 await expect(card.getByText(/预估剩余价值/)).toHaveCount(0);
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>card.evaluate(el=>(el as HTMLElement).offsetHeight)).toBeGreaterThan(0);
 const beforeHover=await card.evaluate(el=>(el as HTMLElement).offsetHeight);
 await price.hover();
 expect(await card.evaluate(el=>(el as HTMLElement).offsetHeight)).toBe(beforeHover);
 await expect(card.locator('[data-extra-note="0"]:visible')).toHaveCSS("background-color","rgb(255, 255, 255)");
 await expect(card.locator('[data-extra-note="1"]:visible')).toHaveCSS("color","rgb(255, 255, 255)");
 await expect(card.getByRole("link",{name:"默认蓝色",exact:true})).toHaveClass(/bg-sky-700/);
 expect(await card.getByRole("link",{name:"默认蓝色",exact:true}).evaluate(el=>el.style.backgroundColor)).toBe("");
 await expect(card.getByRole("link",{name:"自选颜色",exact:true})).toHaveCSS("color","rgb(0, 0, 0)");
 for(const i of [1,2])await expect(cards.filter({has:page.getByText("价值验证"+i,{exact:true})}).locator("[data-billing-value]")).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 const compactBadges=card.locator('[data-plan-info]:visible > p');
 for(const badge of await compactBadges.all()){
  const metrics=await badge.evaluate(el=>{
   const styles=getComputedStyle(el);
   return {height:(el as HTMLElement).offsetHeight,font:styles.fontSize,paddingTop:styles.paddingTop,paddingBottom:styles.paddingBottom};
  });
  expect(metrics.font).toBe("9px");expect(metrics.paddingTop).toBe("1.5px");expect(metrics.paddingBottom).toBe("1.5px");
  if(["2000Mbps","2TB/月","IPv4","IPv6","163PP/CN2","CMI/CMIN2","10099/9929","三网顶级优化","IX","5"].includes((await badge.textContent())!.trim()))expect(metrics.height).toBe(18);
 }
 for(const link of await card.locator("[data-server-link-tags] a:visible").all()){
  await expect(link.locator("[data-plan-badge-text]")).toHaveAttribute("data-badge-painted","true");
  expect(await link.evaluate(el=>el.getBoundingClientRect().height)).toBe(16.5);
 }
 const badges=compactBadges;
 for(const badge of await badges.all()){
  await expect(badge.locator(":scope > [data-plan-badge-text]")).toHaveCount(1);
  await expect(badge.locator("[data-plan-badge-text]")).toHaveCSS("align-self","center");
  await expect(badge.locator("[data-plan-badge-text]")).toHaveCSS("text-box-trim","none");
  for(const icon of await badge.locator("[data-plan-badge-icon]:visible").all())await expect(icon).toHaveCSS("align-self","center");
  await expect(badge).toHaveCSS("align-items","center");await expect(badge).toHaveCSS("justify-content","center");await expect(badge).toHaveCSS("text-align","center");
  expect(await badge.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(badge.locator("[data-plan-badge-text]")).toHaveAttribute("data-badge-painted","true");
  await expect(badge.locator("canvas")).toHaveAttribute("aria-hidden","true");
  const centered=await badge.evaluate(el=>{
   const box=el.getBoundingClientRect(),text=el.querySelector<HTMLElement>("[data-plan-badge-text]")!,span=text.getBoundingClientRect();
   const canvas=text.querySelector<HTMLCanvasElement>("canvas[data-badge-paint]")!;
   const context=canvas.getContext("2d")!, rows=new Array(canvas.height).fill(0);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)rows[y]+=pixels[(y*canvas.width+x)*4+3];
   const threshold=rows.reduce((a,b)=>a+b,0)*.04;let first=0,last=rows.length-1,sum=0;
   while(first<last&&sum+rows[first]<=threshold)sum+=rows[first++];
   sum=0;while(last>first&&sum+rows[last]<=threshold)sum+=rows[last--];
   const painted=canvas.getBoundingClientRect();
   const vertical=Math.abs((painted.top+(first+last+1)/2/window.devicePixelRatio)-(box.y+box.height/2))*window.devicePixelRatio;
   const img=el.querySelector("img,svg")?.getBoundingClientRect();
   return {vertical,horizontal:img?0:Math.abs(box.x+box.width/2-span.x-span.width/2),icon:img?Math.abs(box.y+box.height/2-img.y-img.height/2):0,height:box.height};
  });
  expect(centered.vertical).toBeLessThanOrEqual(.53);expect(centered.horizontal).toBeLessThanOrEqual(1);expect(centered.icon).toBeLessThanOrEqual(1);expect(centered.height).toBeGreaterThanOrEqual(18);
 }
 await card.screenshot({path:info.outputPath("card.png")});expect(errors).toEqual([]);
 if(theme==="doraemon"){await price.click();await expect(page).toHaveURL(/\/server\/11$/)}

});
