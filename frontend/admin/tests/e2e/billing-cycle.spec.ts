import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
for(const width of [390,1366])for(const expired of [false,true])test("Chinese billing year "+width+" expired="+expired,async({page})=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");localStorage.setItem("inline","0");localStorage.setItem("showMap","0");localStorage.setItem("showServices","0")});
 const now=Date.now(),note={billingDataMod:{startDate:new Date(now-365*86400000).toISOString(),endDate:new Date(now+(expired?-2:84)*86400000).toISOString(),autoRenewal:"0",cycle:"Year",amount:"$251.16"}};
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:1,servers:[createServer({id:11,name:"年付显示验证",last_active:new Date(now).toISOString(),public_note:JSON.stringify(note)})]})));
 await page.route("**/api/v1/**",r=>{const path=new URL(r.request().url()).pathname;let data:any=[];if(path==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"验证"}};if(path.includes("/service"))data={services:{},cycle_transfer_stats:{}};if(path==="/api/v1/server-traffic")data={};return r.fulfill({json:{success:true,data}})});
 await page.goto("/");const card=page.locator("[data-server-card]"),billing=card.locator(width<1024?"[data-mobile-billing]":"[data-server-billing]");
 await expect(billing).toContainText("价格: $251.16/年");await expect(card).not.toContainText("/Year");
 await expect(billing).toContainText(expired?"已过期":"剩余天数");expect(note.billingDataMod.cycle).toBe("Year");
 await card.screenshot({path:"test-results/billing-year-"+width+"-"+expired+".png"});
});
