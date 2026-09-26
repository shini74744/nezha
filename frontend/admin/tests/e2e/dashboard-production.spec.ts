import {test,expect} from "@playwright/test";
const origin="http://127.0.0.1:18476";
test("built dashboard and background settings render on desktop and mobile",async({page})=>{
 const response=await page.request.post(origin+"/api/v1/login",{data:{username:"admin",password:"admin"}});
 const auth=await response.json();expect(auth.success).toBe(true);
 await page.route(origin+"/api/v1/**",route=>route.continue({headers:{...route.request().headers(),Authorization:"Bearer "+auth.data.token}}));
 await page.goto(origin+"/dashboard/settings/dashboard-appearance");
 await expect(page.getByRole("heading",{name:"后台美化设置",exact:true})).toBeVisible();
 await expect(page.locator("h2")).toHaveCount(7);
 await page.screenshot({path:"test-results/dashboard-built-desktop.png"});
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/dashboard-built-mobile.png"});
 await page.setViewportSize({width:1280,height:900});
 await page.goto(origin+"/dashboard/settings/appearance");
 await page.getByLabel("电脑背景地址",{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:"test-results/background-built-desktop.png"});
 await expect(page.getByLabel("电脑背景地址",{exact:true})).toBeVisible();
});
