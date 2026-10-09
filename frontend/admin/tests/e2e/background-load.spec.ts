import {test,expect} from "@playwright/test";

const origin="https://127.0.0.1:18475";
test.use({ignoreHTTPSErrors:true});
const effects=["center","fade","zoom","top","bottom","left","right","none"];
let movie:Buffer;
test.beforeAll(async({browser})=>{
 const page=await browser.newPage({ignoreHTTPSErrors:true});await page.goto(origin+"/native-test.html");
 movie=Buffer.from(await page.evaluate(async()=>{
  const c=document.createElement("canvas");c.width=320;c.height=180;const ctx=c.getContext("2d")!;
  const stream=c.captureStream(12),rec=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp8"}),chunks:Blob[]=[];
  const result=new Promise<number[]>(resolve=>{rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))});
  rec.start();let n=0;const timer=setInterval(()=>{ctx.fillStyle=n++%2?"#1b64dd":"#246bdd";ctx.fillRect(0,0,320,180)},80);
  await new Promise(r=>setTimeout(r,600));rec.stop();clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return result;
 }));await page.close();
});
async function open(page:any){
 await page.route(origin+"/fixture-*.svg",async(route:any)=>route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#168da8"/><circle cx="200" cy="200" r="100" fill="#fc7"/></svg>'}));
 await page.route(origin+"/fixture.webm",async(route:any)=>route.fulfill({contentType:"video/webm",body:movie}));
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>typeof(window as any).setNativeConfig==="function");
}
async function configure(page:any,effect:string,duration:number,type="image"){
 await page.evaluate(({effect,duration,type,origin}:any)=>(window as any).setNativeConfig(["background","video"],{background:{regionEnabled:false,scheduleEnabled:false,desktopMedia:[{type,src:origin+(type==="video"?"/fixture.webm":"/fixture-"+effect+".svg")}],mobileMedia:[],desktopLoadEffect:effect,desktopLoadDuration:duration,mobileLoadEffect:effect,mobileLoadDuration:duration}}),{effect,duration,type,origin});
}
for(const width of [1440,390,320])test("all background effects and readiness at "+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:900});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await open(page);
 await page.evaluate(origin=>(window as any).setNativeConfig(["background"],{background:{regionEnabled:false,scheduleEnabled:false,desktopMedia:[{type:"image",src:origin+"/fixture-device.svg"}],mobileMedia:[],desktopLoadEffect:"left",desktopLoadDuration:4,mobileLoadEffect:"right",mobileLoadDuration:3}}),origin);
 await expect(page.locator(".nz-media")).toHaveAttribute("data-background-phase","revealing");
 await expect(page.locator(".nz-media")).toHaveAttribute("data-background-effect",width<768?"right":"left");
 await expect(page.locator(".nz-media")).toHaveCSS("animation-duration",width<768?"3s":"4s");
 for(const type of ["image","video"])for(const effect of effects){
  await page.evaluate(()=>(window as any).setNativeConfig([]));await expect(page.locator(".nz-media")).toHaveCount(0);
  await configure(page,effect,2.4,type);const layer=page.locator(".nz-media").last();
  await expect(layer).toHaveAttribute("data-background-phase",effect==="none"?"visible":"revealing");
  await expect(layer).toHaveAttribute("data-background-effect",effect);
  if(effect!=="none"){
   await expect(layer).toHaveCSS("animation-duration","2.4s");
   await layer.evaluate((e:any)=>{for(const a of e.getAnimations({subtree:true})){a.pause();a.currentTime=700}});
   if(type==="image"&&width!==320)await page.screenshot({path:test.info().outputPath("effect-"+effect+"-"+width+".png")});
   expect(await layer.evaluate(e=>Number(getComputedStyle(e).opacity))).toBeGreaterThan(0);
   if(!["fade","zoom"].includes(effect))expect(await layer.evaluate(e=>getComputedStyle(e).maskImage)).not.toBe("none");
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await layer.evaluate(e=>{for(const a of e.getAnimations({subtree:true}))a.finish()});
   await expect(layer).toHaveAttribute("data-background-phase","visible");
  }
  if(type==="video")await expect(layer.locator("video")).toHaveJSProperty("muted",true);
 }
 expect(errors).toEqual([]);
});
test("device preferences survive shared region media, zero and reduced motion",async({page})=>{
 await open(page);await page.route(origin+"/region",r=>r.fulfill({json:{country:"JP"}}));
 await page.evaluate(origin=>(window as any).setNativeConfig(["background"],{background:{desktopMedia:[],mobileMedia:[],regionEnabled:true,regionApi:origin+"/region",regionCountryPath:"country",regionCountries:["JP"],asns:[],chinaMedia:[{type:"image",src:origin+"/fixture-region.svg"}],regionMobileMedia:[{type:"image",src:origin+"/fixture-region.svg"}],scheduleEnabled:false,desktopLoadEffect:"left",desktopLoadDuration:3,mobileLoadEffect:"right",mobileLoadDuration:0}}),origin);
 const layer=page.locator(".nz-media").last();await expect(layer).toHaveAttribute("data-background-effect","left");await expect(layer).toHaveCSS("animation-duration","3s");
 await layer.evaluate(e=>e.getAnimations().forEach(a=>a.finish()));await expect(layer).toHaveAttribute("data-background-phase","visible");
 const image=await layer.locator("img").elementHandle();await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1100);
 expect(await image!.evaluate(e=>e.isConnected)).toBe(true);
 await page.evaluate(()=>(window as any).setNativeConfig([]));await configure(page,"top",0);await expect(page.locator(".nz-media")).toHaveAttribute("data-background-phase","visible");
 await page.emulateMedia({reducedMotion:"reduce"});await page.evaluate(()=>(window as any).setNativeConfig([]));await configure(page,"zoom",10);
 await expect(page.locator(".nz-media")).toHaveAttribute("data-background-phase","visible",{timeout:2000});
});

for(const width of [1440,390,320])test("background animation never remounts or hides logo "+width,async({page})=>{
 await page.setViewportSize({width,height:900});await open(page);
 const logo=page.getByAltText("Logo");await expect(logo).toBeVisible();const original=await logo.elementHandle();
 for(const type of ["video","image","video"]){
  await configure(page,"center",2.4,type);await expect(page.locator(".nz-media").last()).toHaveAttribute("data-background-phase","revealing");
  expect(await original!.evaluate(e=>e.isConnected)).toBe(true);await expect(logo).toBeVisible();
  expect(await logo.evaluate(e=>[e,...function*(n:Element|null){while(n){yield n;n=n.parentElement}}(e.parentElement)].every(n=>{const c=getComputedStyle(n);return c.opacity==="1"&&c.maskImage==="none"&&c.animationName==="none"}))).toBe(true);
  await page.locator(".nz-media").last().evaluate(e=>e.getAnimations().forEach(a=>a.finish()));
  await expect(page.locator(".nz-media")).toHaveCount(1);
  if(type==="video"){const control=page.getByRole("button",{name:"开启背景声音",exact:true});await control.focus();await page.keyboard.press("Enter");await expect(page.getByRole("button",{name:"关闭背景声音",exact:true})).toBeVisible();}
 }
 await page.evaluate(()=>(window as any).setNativeConfig([]));await expect(page.locator(".nz-media")).toHaveCount(0);
 expect(await original!.evaluate(e=>e.isConnected)).toBe(true);await expect(logo).toBeVisible();
});
