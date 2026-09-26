import {test,expect} from "@playwright/test";
const origin="https://127.0.0.1:18475";test.use({ignoreHTTPSErrors:true});
test("independent peak-cut across device and background changes",async({page})=>{
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>!!(window as any).setNativeConfig);
 const setup=()=>page.evaluate(()=>(window as any).setNativeConfig(["peakCut"],{peakCut:{desktop:true,mobile:false}}));
 await setup();await expect(page.getByTestId("peak-cut")).toHaveText("true");
 await page.setViewportSize({width:390,height:844});await expect(page.getByTestId("peak-cut")).toHaveText("false");
 await page.evaluate(()=>(window as any).setNativeConfig(["peakCut"],{peakCut:{desktop:false,mobile:true}}));
 await expect(page.getByTestId("peak-cut")).toHaveText("true");await page.setViewportSize({width:1366,height:900});await expect(page.getByTestId("peak-cut")).toHaveText("false");
});
for(const width of [390,1366])test("Sakana real widget cleanup, role switching and sizing "+width,async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error"&&m.text().includes("cleanup failed"))errors.push(m.text())});
 await page.addInitScript(width=>Object.defineProperty(screen,"width",{get:()=>width}),width);
 await page.setViewportSize({width,height:900});await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>!!(window as any).setNativeConfig);
 const setup=(provider="sakana")=>page.evaluate(provider=>(window as any).setNativeConfig(["live2d"],{live2d:{provider,size:200,autoMotion:true}}),provider);
 await setup();const widget=page.locator("#nz-sakana-widget");
 if(width<768){await page.waitForTimeout(300);await expect(widget).toHaveCount(0);await setup("live2d");await page.waitForTimeout(300);await expect(page.locator("#waifu,#waifu-toggle")).toHaveCount(0);expect(errors).toEqual([]);return;}
 await expect(widget.locator(".sakana-widget-app")).toBeVisible();
 await expect(page.locator("#waifu")).toHaveCount(0);const bounds=(await widget.boundingBox())!;expect(bounds.x).toBe(0);expect(bounds.y+bounds.height).toBe(900);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
 const img=widget.locator(".sakana-widget-img");const before=await img.evaluate((el:HTMLElement)=>el.style.backgroundImage);await widget.getByTitle("Next Character",{exact:true}).click();await expect.poll(()=>img.evaluate((el:HTMLElement)=>el.style.backgroundImage)).not.toBe(before);
 await page.screenshot({path:"/srv/nezha-builder/releases/peak-mascot-20260926.CjihbiOP/sakana-"+width+".png"});
 await widget.getByTitle("Close",{exact:true}).click();await expect(widget.locator(".sakana-widget-app")).toHaveCount(0);
 await page.evaluate(()=>(window as any).setNativeConfig([]));await expect(widget).toHaveCount(0);
 await setup();await expect(widget.locator(".sakana-widget-app")).toBeVisible();
 await page.route("**/live2d_api/**",r=>r.abort());await setup("live2d");await expect(widget).toHaveCount(0);
 await page.evaluate(()=>(window as any).setNativeConfig([]));await expect(page.locator("#waifu")).toHaveCount(0);
 expect(errors).toEqual([]);
});

test("custom Sakana picture, fallback, removed roles and mobile guard",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(()=>Object.defineProperty(screen,"width",{configurable:true,get:()=>1366}));
 await page.route("https://images.test/**",r=>r.request().url().endsWith("/bad.png")?r.abort():r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="80" fill="pink"/></svg>'}));
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>!!(window as any).setNativeConfig);
 const setup=(customCharacters:any[],character="chisato")=>page.evaluate(({customCharacters,character})=>(window as any).setNativeConfig(["live2d"],{live2d:{provider:"sakana",customCharacters,character}}),{customCharacters,character});
 const a={id:"custom-a",name:"我的角色",imageUrl:"https://images.test/a.png"};
 await setup([a],a.id);const host=page.locator("#nz-sakana-widget");await expect(host).toHaveAttribute("data-character",a.id);
 await expect(page.getByRole("img",{name:"我的角色",exact:true})).toBeVisible();
 await expect.poll(()=>host.locator(".nz-sakana-artwork").evaluate((e:HTMLElement)=>e.style.backgroundImage)).toContain("/a.png");
 const image=host.locator(".sakana-widget-img");
 await expect(image.locator(".nz-sakana-artwork")).toHaveCSS("background-size","contain");await expect(image.locator(".nz-sakana-artwork")).toHaveCSS("background-position","50% 100%");
 await host.getByTitle("Next Character",{exact:true}).click();await expect(host).toHaveAttribute("data-character","chisato");
 await expect(image).toHaveCSS("background-size","cover");await expect(image).toHaveCSS("background-position","50% 50%");
 await setup([]);await expect(host).toHaveAttribute("data-character","chisato");
 await host.getByTitle("Next Character",{exact:true}).click();await expect(host).toHaveAttribute("data-character","takina");
 await host.getByTitle("Next Character",{exact:true}).click();await expect(host).toHaveAttribute("data-character","chisato");
 await setup([{...a,imageUrl:"https://images.test/bad.png"}],a.id);await expect(host).toHaveAttribute("data-character","chisato");
 await page.evaluate(()=>Object.defineProperty(screen,"width",{get:()=>390}));await setup([a],a.id);await expect(host).toHaveCount(0);
 expect(errors).toEqual([]);
});
