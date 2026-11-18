import {test,expect,type Page} from "@playwright/test";
import fs from "node:fs";
const defs=JSON.parse(fs.readFileSync(new URL("../../src/lib/appearance-manifest.json",import.meta.url),"utf8"));
const paper=JSON.parse(fs.readFileSync(new URL("../../../shared/paper-defaults.json",import.meta.url),"utf8"));
const base=()=>({version:1,enabled:true,features:Object.fromEntries(defs.map((d:any)=>[d.key,structuredClone(d.defaults)]))});
async function setup(page:Page){
 await page.route("**/*",route=>{const host=new URL(route.request().url()).hostname;return host==="localhost"||host==="127.0.0.1"?route.continue():route.abort()});

 const configs:Record<string,any>={"user-dist":base(),"paper-dist":structuredClone(paper),"doraemon-dist":{version:1,enabled:true,features:{traffic:{enabled:true,toggleInterval:5000}}}},updates:any[]=[];
 await page.route("**/api/v1/**",route=>{
  const u=new URL(route.request().url());let data:any=[];
  if(u.pathname==="/api/v1/profile")data={id:1,username:"test",role:0};
  if(u.pathname==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"参数设置测试"}};
  if(u.pathname==="/api/v1/setting/appearance"){
   const theme=u.searchParams.get("theme")||"user-dist";
   if(route.request().method()==="PATCH"){const body=route.request().postDataJSON();configs[theme]=body.config;updates.push({theme,...body})}
   data={config:configs[theme],revision:String(updates.length),custom_code:"",current_template:"user-dist"};
  }
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard/settings/appearance");
 await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled({timeout:30000});
 return{configs,updates};
}
for(const width of [390,1440])test("font editing, particle settings, hidden login and Paper scope "+width,async({page},info)=>{
 test.setTimeout(120000);
 await page.setViewportSize({width,height:1000});
 const {configs,updates}=await setup(page);
 const defaultBefore=structuredClone(configs["user-dist"]);
 await page.getByRole("button",{name:"字体",exact:true}).click();
 const select=page.getByLabel("使用字体",{exact:true});
 await expect(select.locator("option")).toHaveCount(9);
 await select.selectOption("misans");
 await page.getByRole("button",{name:"添加字体",exact:true}).click();
 const row=page.locator("[data-font-id]").last();
 await row.locator("summary").click();
 await row.getByLabel("显示名称",{exact:true}).fill("我的中文字体");
 await row.getByLabel("字体文件地址",{exact:true}).fill("javascript:alert(1)");
 await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
 await row.getByLabel("字体文件地址",{exact:true}).fill("https://example.test/fonts/custom.woff2");
 await row.getByRole("button",{name:"使用此字体"}).click();
 await row.getByRole("button",{name:"预览字体"}).click();
 await expect(row.getByTitle("字体预览")).toHaveAttribute("sandbox","");
 await row.getByRole("button",{name:"删除",exact:true}).click();
 await expect(select).toHaveValue("random");
 await select.selectOption("misans");
 await page.getByRole("button",{name:"点击爱心",exact:true}).click();
 await page.getByLabel("爱心大小（像素）",{exact:true}).fill("18");
 await page.getByLabel("持续时间（毫秒）",{exact:true}).fill("900");
 await page.getByRole("button",{name:"页面樱花",exact:true}).click();
 await page.getByLabel("电脑端花瓣数量",{exact:true}).fill("24");
 await page.getByLabel("手机端花瓣数量",{exact:true}).fill("8");
 await page.getByRole("button",{name:"鼠标星星",exact:true}).click();
 await page.getByLabel("生成间隔（毫秒）",{exact:true}).fill("60");
 await page.getByRole("button",{name:"顶部链接样式",exact:true}).click();
 await page.getByLabel("文字大小（像素）",{exact:true}).fill("16");
 await page.getByLabel("链接间距（像素）",{exact:true}).fill("18");
 await page.getByLabel("悬停颜色",{exact:true}).fill("#995533");
 await page.getByRole("button",{name:"隐藏顶部按钮",exact:true}).click();
 await page.getByLabel("隐藏登录按钮",{exact:true}).click();
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();
 await expect.poll(()=>updates.length).toBe(1);
 expect(configs["user-dist"].features.font.activeId).toBe("misans");
 expect(configs["user-dist"].features.heart.size).toBe(18);
 expect(configs["user-dist"].features.stars.interval).toBe(60);
 expect(configs["user-dist"].features.links.hoverColor).toBe("#995533");
 expect(configs["user-dist"].features.hideControls.login).toBe(true);
 await page.reload();
 await page.getByRole("button",{name:"字体",exact:true}).click();
 await expect(page.getByLabel("使用字体",{exact:true})).toHaveValue("misans");
 const savedDefault=JSON.stringify(configs["user-dist"]);
 await page.getByLabel("设置主题",{exact:true}).selectOption("paper-dist");
 await expect(page.getByRole("heading",{name:"主题外观：纸间 · Paper"})).toBeVisible();
 await page.getByRole("button",{name:"顶部链接样式",exact:true}).click();
 await page.getByLabel("文字大小（像素）",{exact:true}).fill("20");
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();
 await expect.poll(()=>updates.length).toBe(2);
 expect(updates[1].theme).toBe("paper-dist");expect(JSON.stringify(configs["user-dist"])).toBe(savedDefault);
 expect(defaultBefore.features.font.activeId).toBe("random");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath("paper-settings.png")});
});
