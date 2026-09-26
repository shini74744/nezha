import {test,expect,Page} from "@playwright/test";
import fs from "node:fs";
const manifest=JSON.parse(fs.readFileSync(new URL("../../src/lib/appearance-manifest.json",import.meta.url),"utf8")) as any[];
const baseConfig=()=>({version:1,enabled:false,features:Object.fromEntries(manifest.map(d=>[d.key,structuredClone(d.defaults)]))});
async function setup(page:Page,custom_code="",current_template="user-dist"){
 const updates:any[]=[];let state={config:baseConfig(),custom_code,current_template,revision:"first"};let conflict=false;
 await page.route("**/api/v1/**",async route=>{const path=new URL(route.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{site_name:"Test",language:"zh-CN"},version:"test"};
  if(path==="/api/v1/setting/appearance"){if(route.request().method()==="PATCH"){const body=route.request().postDataJSON();updates.push(body);if(conflict)return route.fulfill({json:{success:false,error:"appearance changed; reload settings"}});state={...state,config:body.config,revision:"second",custom_code:body.remaining_custom_code??state.custom_code}}data=state}
  await route.fulfill({json:{success:true,data}});
 });await page.goto("/dashboard/settings/appearance");await expect(page.getByRole("heading",{name:"美化设置",exact:true})).toBeVisible();return{updates,conflict:()=>{conflict=true}};
}
test("29 native sections, second-row tab, independent save and untouched custom code",async({page})=>{
 const {updates}=await setup(page);await expect(page.locator("h2")).toHaveCount(28);
 const appearanceTab=page.getByRole("tab",{name:"美化设置",exact:true}),systemTab=page.getByRole("tab",{name:"系统设置",exact:true});
 expect((await appearanceTab.boundingBox())!.y).toBeGreaterThan((await systemTab.boundingBox())!.y);
 await page.getByRole("switch",{name:"启用内置美化",exact:true}).click();await page.getByLabel("站点说明",{exact:true}).fill("native test");
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);
 expect(Object.keys(updates[0].config.features)).toHaveLength(29);expect(updates[0].config.features.branding.description).toBe("native test");expect(updates[0]).not.toHaveProperty("remaining_custom_code");
 await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
});
test("unknown custom source is never cleared by migration",async({page})=>{const {updates}=await setup(page,"<script>unknown()</script>");await page.getByRole("button",{name:"迁移已核对的原有美化"}).click();await expect(page.getByText(/当前自定义代码与已核对版本不同/)).toBeVisible();expect(updates).toHaveLength(0)});
test("other theme retains editable settings and shows default-only warning",async({page})=>{await setup(page,"","other-theme");await expect(page.getByText("当前不是默认主题，保存配置不会影响当前前台。")).toBeVisible();await expect(page.locator("h2")).toHaveCount(28)});
test("save conflict retains unsaved input",async({page})=>{const state=await setup(page);state.conflict();await page.getByLabel("站点说明",{exact:true}).fill("unsaved input");await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect(page.getByText("配置已被其他页面修改，请重新读取后再保存。")).toBeVisible();await expect(page.getByLabel("站点说明",{exact:true})).toHaveValue("unsaved input")});
test("exact legacy migration carries parameters and supplies atomic replacement guard",async({page})=>{
 const file=process.env.LEGACY_APPEARANCE_FIXTURE;test.skip(!file,"requires the private verified fixture on the build server");
 const original=JSON.parse(fs.readFileSync(file!,"utf8")).custom_code;const {updates}=await setup(page,original);
 await page.getByRole("button",{name:"迁移已核对的原有美化"}).click();await expect(page.getByText("本次保存将归档原始美化代码并停止旧脚本执行，避免与内置功能重复。")).toBeVisible();
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();await expect.poll(()=>updates.length).toBe(1);expect(updates[0].expected_custom_code).toBe(original);expect(updates[0].remaining_custom_code).toBe("");expect(updates[0].config.features.sponsor.sponsors).toHaveLength(3);expect(updates[0].config.features.analytics.measurementId).toBe("G-S5CPS1PHE4");expect(updates[0].config.enabled).toBe(true);
});

test("background editor saves multiline media, ordered schedules and region settings",async({page})=>{
 const {updates}=await setup(page);
 const desktop=page.getByLabel("电脑背景地址",{exact:true});
 await desktop.fill("https://media.test/a.jpg\n");await desktop.press("End");await desktop.pressSequentially("https://media.test/b.mp4");
 await expect(desktop).toHaveValue("https://media.test/a.jpg\nhttps://media.test/b.mp4");
 await page.getByLabel("手机背景地址",{exact:true}).fill("https://media.test/mobile-api");
 await page.getByRole("button",{name:"添加分时规则"}).click();
 await page.getByLabel("分时规则名称 2",{exact:true}).fill("晚间");
 await page.getByLabel("分时电脑背景 2",{exact:true}).fill("https://media.test/night.webm");
 await page.getByLabel("启用分时规则 2",{exact:true}).click();
 await page.getByLabel("背景规则优先级",{exact:true}).selectOption("schedule-first");
 await page.getByLabel("国家或地区代码",{exact:true}).fill("CN, HK");
 await page.getByLabel("运营商字段路径",{exact:true}).fill("asn.org");
 await page.getByRole("button",{name:"保存美化设置",exact:true}).click();
 await expect.poll(()=>updates.length).toBe(1);
 const f=updates[0].config.features.background;
 expect(f.desktopMedia.map((m:any)=>m.type)).toEqual(["image","video"]);
 expect(f.mobileMedia).toEqual([{src:"https://media.test/mobile-api",type:"auto"}]);
 expect(f.scheduleRules[1]).toMatchObject({name:"晚间",enabled:true,start:"22:00",end:"06:00"});
 expect(f.priority).toBe("schedule-first");expect(f.regionCountries).toEqual(["CN","HK"]);
 await page.getByRole("button",{name:"重新读取",exact:true}).click();
 await expect(desktop).toHaveValue("https://media.test/a.jpg\nhttps://media.test/b.mp4");
 await expect(page.getByLabel("分时规则名称 2",{exact:true})).toHaveValue("晚间");
 await page.screenshot({path:"test-results/background-editor.png",fullPage:true});
});
test("background editor rejects unsafe URLs and previews custom region API fields",async({page})=>{
 await setup(page);await page.getByLabel("电脑背景地址",{exact:true}).fill("javascript:alert(1)");
 await expect(page.getByRole("button",{name:"保存美化设置",exact:true})).toBeDisabled();
 await page.getByLabel("电脑背景地址",{exact:true}).fill("https://media.test/api");
 await page.route("https://region.test/query",route=>route.fulfill({json:{asn:{org:"AS123 Example"},data:{country:"CN"}}}));
 await page.getByLabel("运营商查询地址",{exact:true}).fill("https://region.test/query");
 await page.getByLabel("运营商字段路径",{exact:true}).fill("asn.org");await page.getByLabel("地区字段路径",{exact:true}).fill("data.country");
 await page.getByRole("button",{name:"测试运营商查询",exact:true}).click();
 await expect(page.getByText("运营商：AS123 Example；地区：CN",{exact:true})).toBeVisible();
});
