import {test,expect} from "@playwright/test";
import fs from "node:fs";
import {createServer} from "../../../user/src/test/fixtures";
const origin="https://127.0.0.1:18475";
test.use({ignoreHTTPSErrors:true});
async function open(page:any) {
 const manifest=JSON.parse(fs.readFileSync(new URL("../../src/lib/appearance-manifest.json",import.meta.url),"utf8"));
 const config={version:1,enabled:true,features:Object.fromEntries(manifest.map((d:any)=>[d.key,{...d.defaults}]))};
 config.features.background.regionApi=origin+"/test-region";
 config.features.background.nightStart=0;config.features.background.nightEnd=24;
 config.features.font.selection=7;
 config.features.live2d.enabled=false;config.features.analytics.enabled=false;
 const now=Date.now(), servers=[createServer({id:11,name:"Stability 11",last_active:new Date(now).toISOString()})];
 await page.routeWebSocket("**/api/v1/ws/server",(ws:any)=>{
  ws.send(JSON.stringify({now,online:1,servers}));
 });
 await page.route("**/*",async(route:any)=>{
  const u=new URL(route.request().url());
  if(u.pathname==="/api/v1/setting")return route.fulfill({json:{success:true,data:{config:{language:"zh-CN",site_name:"稳定性回归",custom_code:"",appearance_config:JSON.stringify(config)}}}});
  if(u.pathname==="/api/v1/server-group")return route.fulfill({json:{success:true,data:[]}});
  if(u.pathname==="/api/v1/profile")return route.fulfill({json:{success:false}});
  if(u.pathname.includes("/service"))return route.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{"1":{name:"quota",max:1000,from:"2026-09-01",to:"2026-10-01",transfer:{"11":100}}}}}});
  if(route.request().resourceType()==="image" && u.origin!==origin)return route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK5sAAAAASUVORK5CYII=","base64")});
  if(u.origin!==origin || u.pathname==="/test-region")return route.fulfill({json:{ip:"203.0.113.5",org:"AS123 Example",country:"JP",content:"测试语录"}});
  return route.continue();
 });
 await page.goto(origin+"/#/");
 await expect(page.getByText("Stability 11",{exact:true})).toBeVisible({timeout:15000});
}
for(const translate of [false,true])test("delayed updates and SPA stability"+(translate?" with translated text":""),async({page})=>{
 test.setTimeout(70000);const errors:string[]=[];
 page.on("pageerror",e=>errors.push(e.stack||e.message));
 page.on("console",m=>{if(m.type()==="error"&&/removeChild|NotFoundError/.test(m.text()))errors.push(m.text())});
 await open(page);
 if(translate)await page.evaluate(()=>{
  const walker=document.createTreeWalker(document.querySelector("main")!,NodeFilter.SHOW_TEXT);
  const nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
  for(const text of nodes){if(!text.textContent?.trim()||text.parentElement?.closest("script,style,[translate=no]"))continue;const font=document.createElement("font");font.textContent=text.textContent;text.parentNode!.replaceChild(font,text)}
 });
 await page.waitForTimeout(16000);
 await expect(page.getByText("Stability 11",{exact:true})).toBeVisible();
 await page.getByText("Stability 11",{exact:true}).click();
 await expect(page).toHaveURL(/server\/11/);
 await page.waitForTimeout(6000);
 await page.screenshot({path:"test-results/stability-"+translate+".png"});
 expect(errors).toEqual([]);
});
