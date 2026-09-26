import {test,expect} from "@playwright/test";
const origin="https://127.0.0.1:18475";
test.use({ignoreHTTPSErrors:true});
const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK5sAAAAASUVORK5CYII=","base64");
async function open(page:any){
 await page.route(origin+"/media/**",(r:any)=>r.fulfill({contentType:"image/png",body:image}));
 await page.goto(origin+"/native-test.html");
 await page.waitForFunction(()=>typeof(window as any).setNativeConfig==="function");
}
const configure=(page:any,background:any)=>page.evaluate((background:any)=>(window as any).setNativeConfig(["background","video"],{background}),background);
test("time boundary and responsive sources switch without refresh",async({page})=>{
 await page.clock.install({time:new Date("2026-09-26T13:50:00Z")});await open(page);await page.clock.pauseAt(new Date("2026-09-26T13:59:58Z"));
 const base={regionEnabled:false,scheduleEnabled:true,timezone:"Asia/Shanghai",desktopMedia:[{type:"image",src:origin+"/media/day.png"}],mobileMedia:[{type:"image",src:origin+"/media/mobile.png"}],scheduleRules:[{enabled:true,name:"夜间",start:"22:00",end:"06:00",desktopMedia:[{type:"image",src:origin+"/media/night.png"}],mobileMedia:[{type:"image",src:origin+"/media/night-mobile.png"}]}]};
 await configure(page,base);
 await expect(page.locator(".nz-media img")).toHaveAttribute("src",origin+"/media/day.png");
 await page.clock.fastForward(4000);
 await expect(page.locator(".nz-media img")).toHaveAttribute("src",origin+"/media/night.png");
 await page.setViewportSize({width:390,height:844});await page.clock.runFor(50);
 await expect(page.locator(".nz-media img")).toHaveAttribute("src",origin+"/media/night-mobile.png");
 await page.screenshot({path:"test-results/background-mobile.png"});
});
test("region priority, query failure and resize fallback",async({page})=>{
 await open(page);await page.route(origin+"/region",r=>r.fulfill({json:{network:{org:"AS123 Example"},geo:{country:"HK"}}}));
 const f={scheduleEnabled:false,regionEnabled:true,regionApi:origin+"/region",regionOrgPath:"network.org",regionCountryPath:"geo.country",asns:["AS123"],regionCountries:[],desktopMedia:[{type:"image",src:origin+"/media/day.png"}],mobileMedia:[],chinaMedia:[{type:"image",src:origin+"/media/region.png"}],regionMobileMedia:[]};
 await configure(page,f);await expect(page.locator(".nz-media img")).toHaveAttribute("src",origin+"/media/region.png");
 await page.setViewportSize({width:390,height:844});await expect(page.locator(".nz-media img")).toHaveAttribute("src",origin+"/media/region.png");
 await page.route(origin+"/fail",r=>r.abort());await configure(page,{...f,regionApi:origin+"/fail"});
 await expect(page.locator(".nz-media img")).toHaveAttribute("src",origin+"/media/day.png");
});
test("extensionless video fallback, separate sound control and cleanup",async({page})=>{
 await open(page);
 await page.addScriptTag({content:"HTMLMediaElement.prototype.play=function(){return Promise.resolve()}"});
 await page.route(origin+"/video-api",r=>r.fulfill({contentType:"video/mp4",body:Buffer.from([0])}));
 await configure(page,{regionEnabled:false,scheduleEnabled:false,desktopMedia:[{type:"auto",src:origin+"/video-api"}],mobileMedia:[]});
 // Prevent the intentionally invalid tiny fixture from advancing before checking the image-to-video fallback.
 await page.evaluate(()=>document.addEventListener("error",e=>{if(e.target instanceof HTMLVideoElement)e.stopImmediatePropagation()},true));
 await expect(page.locator(".nz-media video")).toBeAttached();
 await expect(page.getByRole("button",{name:"开启背景声音",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"开启背景声音",exact:true}).click();
 await expect(page.getByRole("button",{name:"关闭背景声音",exact:true})).toBeVisible();
 expect(await page.locator("video").evaluate((v:HTMLVideoElement)=>v.muted)).toBe(false);
 await page.evaluate(()=>(window as any).setNativeConfig([]));
 await expect(page.locator(".nz-media,.nz-background-sound")).toHaveCount(0);
});
