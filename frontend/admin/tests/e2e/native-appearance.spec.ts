import {test,expect} from "@playwright/test";
const origin="https://127.0.0.1:18475";
test.use({ignoreHTTPSErrors:true});
async function open(page:any){
 await page.route("**/*",async(route:any)=>{const u=new URL(route.request().url());if(u.origin===origin){if(u.pathname==="/api/v1/service")return route.fulfill({json:{success:true,data:{cycle_transfer_stats:{}}}});return route.continue()}if(route.request().resourceType()==="fetch"||route.request().resourceType()==="xhr")return route.fulfill({json:{ip:"203.0.113.5",country:"JP",region:"Tokyo",city:"Tokyo",org:"AS123 Example",asn:{asn:"AS123",name:"Example",org:"Example"},data:{ip:"203.0.113.5",country:"JP"},content:"test quote"}});return route.fulfill({status:200,contentType:"text/plain",body:""})});
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>typeof (window as any).setNativeConfig==="function");await page.evaluate(()=>{history.replaceState({},"","/");dispatchEvent(new PopStateEvent("popstate"))});
}
const configure=(page:any,keys:string[],overrides={})=>page.evaluate(({keys,overrides}:any)=>(window as any).setNativeConfig(keys,overrides),{keys,overrides});
test("all independent DOM effects run off the former authorized domain and clean up",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await open(page);
 for(const [feature,selector]of [["visitorIP","#ip-bar"],["quote","#message"],["network","canvas"],["snow",".snowflake"],["fragments","[data-nezha-appearance=fragments]"],["sideImage","[data-nezha-appearance=sideImage]"],["counter","[data-nezha-appearance=counter]"],["font","style[data-nezha-appearance=font]"],["clock","[data-issues-count-animation]"],["sponsor","#bmWrap"],["stars",".js-cursor-container"],["sakura","#canvas_sakura"]]){
  await configure(page,[feature],{snow:{interval:100},font:{selection:7}});
  await expect(page.locator(selector).first(),feature).toBeAttached({timeout:10000});
  if(feature==="clock")await expect(page.locator(selector).first()).toHaveCSS("color",/rgb\(/);
  await configure(page,[]);await expect(page.locator("[data-nezha-appearance]"),feature+" cleanup").toHaveCount(0);
  if(feature==="visitorIP")await expect(page.locator("#ip-bar")).toHaveCount(0);
 }
 expect(errors).toEqual([]);
});
test("sponsor respects SPA routes and does not accumulate duplicates",async({page})=>{await open(page);await configure(page,["sponsor"]);await expect(page.locator("#bmWrap")).toBeVisible();await page.getByRole("link",{name:"detail",exact:true}).click();await expect(page.locator("#bmWrap")).not.toBeVisible();await page.getByRole("link",{name:"home",exact:true}).click();await expect(page.locator("#bmWrap")).toHaveCount(1);await expect(page.locator("#bmWrap")).toBeVisible()});
test("mobile snow count and sponsor behavior preserve mobile settings",async({page})=>{await page.setViewportSize({width:390,height:844});await open(page);await configure(page,["snow","sponsor"],{snow:{interval:100,mobileCount:3}});await expect(page.locator(".snowflake")).toHaveCount(3);await expect(page.locator("#bmWrap")).not.toBeVisible();await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await expect(page.locator("#bmWrap")).toBeVisible();await configure(page,[]);await expect(page.locator("#bmWrap,.snowflake")).toHaveCount(0)});
test("master toggle restores names and removes background and click effects",async({page})=>{await open(page);await configure(page,["nameColor","background","heart"],{background:{regionApi:origin+"/region",nightEnabled:false,desktopMedia:[{type:"image",src:origin+"/image.png"}]}});await expect(page.getByText("Server A")).toHaveClass(/nz-name-online/);await expect(page.locator(".nz-media")).toHaveCount(1);await page.mouse.click(250,300);await expect(page.locator(".heart")).toHaveCount(1);await configure(page,[]);await expect(page.locator(".nz-media,.heart")).toHaveCount(0);await expect(page.getByText("Server A")).not.toHaveClass(/nz-name-online/)});

test("Live2D retains the seven original tools, model loading and close/reopen",async({page})=>{
 test.setTimeout(60000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>typeof (window as any).setNativeConfig==="function");
 await configure(page,["live2d"]);await expect(page.locator("#waifu-tool > span")).toHaveCount(7,{timeout:20000});
 await expect(page.locator("#live2d")).toBeVisible();await expect(page.locator("#waifu")).toHaveCSS("bottom","0px",{timeout:20000});await page.locator("#waifu").hover({force:true});
 await page.waitForFunction(()=>typeof (window as any).loadlive2d==="function");
 await page.locator("#waifu-tool-quit").click();await expect(page.locator("#waifu")).not.toBeVisible({timeout:5000});
 await configure(page,[]);await expect(page.locator("#waifu,#waifu-toggle")).toHaveCount(0);
 await configure(page,["live2d"]);await expect(page.locator("#waifu-toggle")).toBeAttached();await page.locator("#waifu-toggle").click();
 await expect(page.locator("#waifu-tool > span")).toHaveCount(7);await page.screenshot({path:"test-results/native-live2d.png"});
 await configure(page,[]);await expect(page.locator("[data-nezha-appearance],#waifu,#waifu-toggle")).toHaveCount(0);
 expect(errors).toEqual([]);
});

test("Live2D game launches locally and Escape cleans up the game",async({page})=>{
 test.setTimeout(60000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>typeof(window as any).setNativeConfig==="function");
 await configure(page,["live2d"]);await expect(page.locator("#waifu")).toHaveCSS("bottom","0px",{timeout:20000});await page.locator("#waifu").hover({force:true});
 await page.locator("#waifu-tool-asteroids").click();await expect(page.locator("#ASTEROIDS-NAVIGATION")).toBeAttached();
 await page.keyboard.press("ArrowUp");await page.keyboard.press("Space");await page.keyboard.press("Escape");
 await expect(page.locator("#ASTEROIDS-NAVIGATION,[data-nezha-appearance=asteroids]")).toHaveCount(0);await expect(page.locator("body")).not.toHaveClass(/ASTEROIDS/);
 await configure(page,[]);expect(errors).toEqual([]);
});
test("disabling while Live2D requests are pending does not resurrect effects",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));let release:()=>void=()=>{};let waiting:()=>void=()=>{};
 const started=new Promise<void>(resolve=>waiting=resolve), gate=new Promise<void>(resolve=>release=resolve);
 await page.route("**/appearance/live2d-tips.json",async route=>{waiting();await gate;await route.fulfill({json:{}}).catch(()=>{})});
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>typeof(window as any).setNativeConfig==="function");
 await configure(page,["live2d"]);await started;await configure(page,[]);release();
 await expect(page.locator("[data-nezha-appearance],#waifu,#waifu-toggle")).toHaveCount(0);await page.waitForTimeout(700);expect(errors).toEqual([]);
});
