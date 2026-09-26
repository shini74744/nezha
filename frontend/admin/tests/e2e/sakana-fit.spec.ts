import {test,expect} from "@playwright/test";
test.use({ignoreHTTPSErrors:true});
for(const [name,width,height] of [["wide",600,150],["tall",150,600]] as const)test("custom image fits "+name,async({page})=>{
 await page.route("https://images.test/fit.png",r=>r.fulfill({contentType:"image/svg+xml",body:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="cyan"/><rect width="100%" height="100%" fill="none" stroke="red" stroke-width="12"/></svg>`}));
 await page.goto("https://127.0.0.1:18475/native-test.html");
 await page.waitForFunction(()=>!!(window as any).setNativeConfig);
 await page.evaluate(()=>(window as any).setNativeConfig(["live2d"],{live2d:{provider:"sakana",size:200,controls:false,autoMotion:false,character:"custom-fit",customCharacters:[{id:"custom-fit",name:"Fit",imageUrl:"https://images.test/fit.png"}]}}));
 const image=page.locator("#nz-sakana-widget .nz-sakana-artwork");
 await expect(image).toHaveCSS("background-size","contain");
 await expect(image).toHaveCSS("background-position","50% 100%");
 await expect(page.locator("#nz-sakana-widget")).toHaveAttribute("data-character","custom-fit");
 await image.screenshot({path:"/srv/nezha-builder/releases/sakana-fit-20260926.eYalR1sN/"+name+".png"});
});
test("uploaded plane complete image",async({page})=>{
 page.on("requestfailed",r=>console.log("image request failed",r.url(),r.failure()));
 // Keep the real uploaded artwork, while avoiding Chromium test-host referrer restrictions.
 await page.route("https://img95.699pic.com/**",async r=>{const res=await r.fetch({headers:{"Referer":"https://shli.io/"}});await r.fulfill({response:res})});
 await page.goto("https://127.0.0.1:18475/native-test.html");await page.waitForFunction(()=>!!(window as any).setNativeConfig);
 const dimensions=await page.evaluate(()=>new Promise<{w:number;h:number}>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve({w:i.naturalWidth,h:i.naturalHeight});i.onerror=reject;i.src="https://img95.699pic.com/element/40105/8069.png_860.png"}));
 expect(dimensions.w).toBeGreaterThan(0);
 await page.evaluate(()=>(window as any).setNativeConfig(["live2d"],{live2d:{provider:"sakana",size:200,controls:false,autoMotion:false,character:"custom-plane",customCharacters:[{id:"custom-plane",name:"飞机",imageUrl:"https://img95.699pic.com/element/40105/8069.png_860.png"}]}}));
 await expect(page.getByRole("img",{name:"飞机",exact:true}).locator(".nz-sakana-artwork")).toHaveCSS("background-size","contain");
 await page.waitForTimeout(300);
 await page.locator("#nz-sakana-widget").screenshot({path:"/srv/nezha-builder/releases/sakana-fit-20260926.eYalR1sN/plane.png"});
 console.log("original image dimensions",dimensions);
});

test("manual image scaling preserves ratio and left edge",async({page})=>{
 await page.route("https://images.test/scale.png",r=>r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="cyan"/></svg>'}));
 await page.goto("https://127.0.0.1:18475/native-test.html");await page.waitForFunction(()=>!!(window as any).setNativeConfig);
 for(const scale of [25,100,150,200]){
  await page.evaluate(scale=>(window as any).setNativeConfig(["live2d"],{live2d:{provider:"sakana",size:200,controls:false,autoMotion:false,character:"custom-scale",customCharacters:[{id:"custom-scale",name:"Scale",imageUrl:"https://images.test/scale.png",scale}]}}),scale);
  const art=page.locator(".nz-sakana-artwork");await expect(art).toHaveCSS("transform",`matrix(${scale/100}, 0, 0, ${scale/100}, 0, 0)`);
  await page.waitForTimeout(100);
  // Measure unrotated geometry atomically; Sakana starts with a spring displacement.
  const bounds=await art.evaluate(el=>{const p=el.parentElement!;const old=p.style.transform;p.style.transform="none";const r=el.getBoundingClientRect();p.style.transform=old;return {x:r.x,width:r.width,height:r.height}});expect(bounds.width).toBeCloseTo(160*scale/100,0);expect(bounds.height).toBeCloseTo(bounds.width,0);expect(bounds.x).toBeGreaterThanOrEqual(-1);
  await expect(page.locator("#nz-sakana-widget")).toHaveCSS("left","0px");
 }
});
