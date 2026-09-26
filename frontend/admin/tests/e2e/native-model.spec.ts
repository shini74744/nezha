import {test,expect} from "@playwright/test";
const origin="https://127.0.0.1:18475";
test.use({ignoreHTTPSErrors:true});
test("Live2D models, texture switching, and photo retain their original tools",async({page})=>{
 test.setTimeout(90000);const failures:string[]=[],consoleErrors:string[]=[],responses:string[]=[];
 page.on("pageerror",error=>failures.push(error.message));page.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text())});
 page.on("response",r=>{if(r.url().includes("live2d_api"))responses.push(r.status()+" "+r.url())});
 await page.goto(origin+"/native-test.html");await page.waitForFunction(()=>typeof(window as any).setNativeConfig==="function");
 await page.evaluate(()=>(window as any).setNativeConfig(["live2d"]));await expect(page.locator("#waifu")).toHaveCSS("bottom","0px",{timeout:20000});
 await expect.poll(()=>responses.some(r=>r.startsWith("200")&&r.includes(".png")),{timeout:30000}).toBe(true);
 await page.waitForTimeout(3000);await page.screenshot({path:"test-results/native-model.png"});
 await page.locator("#waifu").hover({force:true});await page.locator("#waifu-tool-switch-texture").click();
 await page.locator("#waifu-tool-switch-model").click();await page.waitForTimeout(3000);
 const download=page.waitForEvent("download");await page.locator("#waifu").hover({force:true});await page.locator("#waifu-tool-photo").click();await download;
 console.log(JSON.stringify({responses,consoleErrors}));expect(failures).toEqual([]);
 await page.evaluate(()=>(window as any).setNativeConfig([]));await expect(page.locator("#waifu")).toHaveCount(0);
});
