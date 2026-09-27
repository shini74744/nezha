import {test,expect} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";
const origin=process.env.E2E_BASE_URL||"https://127.0.0.1:18476";
test.use({ignoreHTTPSErrors:true});
for(const width of [1366,390])for(const inline of ["0","1"])for(const theme of ["light","dark"])
test("carrier colors "+width+" inline="+inline+" "+theme,async({page,baseURL})=>{
 expect(baseURL).toBe(origin);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const now=Date.now();
 const public_note=JSON.stringify({billingDataMod:{amount:"33刀",cycle:"Month",startDate:"2026-09-01T00:00:00+08:00",endDate:"2027-09-01T00:00:00+08:00"},planDataMod:{bandwidth:"5000Mbps",trafficVol:"5TB/月",IPv4:"1",networkRoute:"old blue label",networkRoutes:{unicom:"1111",telecom:"CN2",mobile:"CMI/CMIN2",other:"IX"},networkRouteEntries:[{carrier:"ntt",country:"JP",text:"AS2914"},{carrier:"cogent",country:"US",text:"AS174"}],linkTags:[{name:"购买",url:"https://example.com/buy"}]}});
 const servers=[createServer({id:11,name:"在线机器",last_active:new Date(now).toISOString(),public_note}),createServer({id:12,name:"离线机器",public_note})];
 await page.setViewportSize({width,height:900});
 await page.addInitScript(({inline,theme})=>{
  localStorage.setItem("inline",inline);localStorage.setItem("showMap","0");
  localStorage.setItem("showServices","0");localStorage.setItem("vite-ui-theme",theme);
 },{inline,theme});
 await page.routeWebSocket("**/api/v1/ws/server",ws=>ws.send(JSON.stringify({now,online:1,servers})));
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==="/api/v1/setting")return route.fulfill({json:{success:true,data:{config:{language:"zh-CN",site_name:"运营商颜色校验",custom_code:""}}}});
  if(u.pathname==="/api/v1/server-group")return route.fulfill({json:{success:true,data:[]}});
  if(u.pathname==="/api/v1/profile")return route.fulfill({json:{success:false}});
  if(u.pathname==="/api/v1/server-traffic")return route.fulfill({json:{success:true,data:{}}});
  if(u.pathname.includes("/service"))return route.fulfill({json:{success:true,data:{services:{},cycle_transfer_stats:{}}}});
  if(u.origin!==origin)return route.abort();return route.continue();
 });
 await page.goto("/");
 await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--color-blue-600").trim()),{timeout:15000}).not.toBe("");
 const keys=["telecom","mobile","unicom","other"];
 // Resolve the theme's actual color tokens; modern Tailwind emits Lab, not RGB.
 const colors=await page.evaluate(theme=>["blue","green","red","stone"].map(color=>{
  const probe=document.createElement("span");probe.style.backgroundColor="var(--color-"+color+"-"+(theme==="dark"?"800":"600")+")";
  document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;
 }),theme);
 expect(new Set(colors).size).toBe(4);expect(colors).not.toContain("rgba(0, 0, 0, 0)");
 await expect(page.locator("[data-carrier]")).toHaveCount(8);
 for(let i=0;i<keys.length;i++){
  const badges=page.locator('[data-carrier="'+keys[i]+'"]');
  for(const badge of await badges.all()){
   await expect(badge).toBeVisible();await expect(badge).toHaveCSS("background-color",colors[i]);
   const logo=badge.locator("svg");
   if(keys[i]==="other")await expect(logo).toHaveCount(0);
   else {
    await expect(logo).toHaveAttribute("data-carrier-logo",keys[i]);
    await expect(logo).toBeVisible();await expect(logo).toHaveCSS("width","12px");
    await expect(logo).toHaveCSS("height","12px");await expect(logo).toHaveCSS("fill","rgb(255, 255, 255)");
    const lr=await logo.boundingBox(),tr=await badge.locator("span").boundingBox();
    expect(lr!.x+lr!.width).toBeLessThanOrEqual(tr!.x);
    expect(Math.abs(lr!.y+lr!.height/2-tr!.y-tr!.height/2)).toBeLessThanOrEqual(1);
   }
   const r=await badge.boundingBox();expect(r!.x).toBeGreaterThanOrEqual(0);expect(r!.x+r!.width).toBeLessThanOrEqual(width);
  }
 }
 expect(await page.locator("[data-carrier]").evaluateAll(els=>els.map(e=>e.getAttribute("data-carrier")))).toEqual([...keys,...keys]);
 await expect(page.getByText("old blue label")).toHaveCount(0);
 await page.screenshot({path:"test-results/carrier-"+width+"-"+inline+"-"+theme+".png",fullPage:true});
 await expect(page.locator("[data-other-carrier]")).toHaveCount(4);
 for(const badge of await page.locator("[data-other-carrier]").all()){
  await expect(badge).toBeVisible();
  await expect.poll(()=>badge.locator("img").evaluate((im:HTMLImageElement)=>im.complete&&im.naturalWidth>0)).toBe(true);
 }
 const links=page.getByRole("link",{name:"购买",exact:true});
 await expect(links).toHaveCount(2);
 await page.context().route("https://example.com/**",r=>r.fulfill({body:"fixture target"}));
 const [popup]=await Promise.all([page.waitForEvent("popup"),links.first().click()]);
 await expect(popup).toHaveURL("https://example.com/buy");expect(new URL(page.url()).pathname).toBe("/");
 await popup.close();
 expect(errors).toEqual([]);
});

