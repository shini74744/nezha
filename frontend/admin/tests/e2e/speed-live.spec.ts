import {test,expect} from "./isolated-appearance";
test("built backend preserves legacy speed choices and persists independent editors",async({page,baseURL,isolatedAppearance})=>{
 test.skip(process.env.E2E_REAL_BACKEND!=="1","Only run on disposable localhost installation");
 expect(baseURL).toBe("http://127.0.0.1:18476");
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem("language","zh-CN"));
 await page.goto("/dashboard/login");
 await page.locator('input[name="username"]').fill("admin");
 await page.locator('input[name="password"]').fill("admin");
 await page.locator('button[type="submit"]').click();await expect(page).toHaveURL(/\/dashboard$/);
 await isolatedAppearance(config => {
  config.enabled = true;
  for (const feature of Object.values(config.features)) feature.enabled = false;
  config.features.speed = {enabled:true,bits:false,color:false,animation:false};
 });
 await page.goto("/dashboard/settings/appearance");
 await page.getByRole("button",{name:"网络速率与颜色",exact:true}).click();
 for(const title of ["单台服务器卡片速率","网络概览卡片速率"]){
  await page.getByRole("button",{name:title,exact:true}).click();
  for(const label of ["转换成 Mbps/Gbps","启用上下行颜色","启用高速率动画"])
   await expect(page.getByRole("switch",{name:title+"："+label,exact:true})).not.toBeChecked();
 }
 for(const label of ["转换成 Mbps/Gbps","启用上下行颜色","启用高速率动画"])
  await page.getByRole("switch",{name:"网络概览卡片速率："+label,exact:true}).click();
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();
 await expect(page.getByText("默认主题美化设置已保存，仅影响该主题")).toBeVisible();
 await page.reload();await page.getByRole("button",{name:"网络速率与颜色",exact:true}).click();
 for(const title of ["单台服务器卡片速率","网络概览卡片速率"]){
  await page.getByRole("button",{name:title,exact:true}).click();
  for(const label of ["转换成 Mbps/Gbps","启用上下行颜色","启用高速率动画"])
   await expect(page.getByRole("switch",{name:title+"："+label,exact:true})).toBeChecked({checked:title.startsWith("网络概览")});
 }
 const result=await page.request.get("/api/v1/setting");const data=await result.json();
 expect(JSON.parse(data.data.config.appearance_config).features.speed).toMatchObject({bits:false,color:false,animation:false,overviewBits:true,overviewColor:true,overviewAnimation:true});
 await page.goto("/");
 await expect(page.locator('[data-native-speed]').first()).toContainText("Mbps");
 expect(errors).toEqual([]);
});
