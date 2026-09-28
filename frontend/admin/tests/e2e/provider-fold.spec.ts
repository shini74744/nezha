import {test,expect} from "@playwright/test";
for(const width of [390,1366])test("provider section defaults closed and keeps saved logo "+width,async({page})=>{
 await page.setViewportSize({width,height:950});
 const note={keep:true,planDataMod:{providerLogo:{logo:"/api/v1/logo/assets/"+"a".repeat(64)+".png",logoLibraryName:"已保存厂商"}}};
 let server:any={id:11,name:"折叠验证机器",host:{version:"2.3.5"},display_index:0,user_id:1,uuid:"fixture",public_note:JSON.stringify(note),note:"",enable_ddns:false,hide_for_guest:false},saves=0;
 await page.route("**/api/v1/**",r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{site_name:"验证",language:"zh-CN"},version:"test"};
  if(path==="/api/v1/server")data=[server];
  if(path==="/api/v1/server/11"&&r.request().method()==="PATCH"){server={...server,...r.request().postDataJSON()};saves++;data=null}
  return r.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");
 const edit=page.getByRole("row").filter({has:page.getByText("折叠验证机器",{exact:true})}).getByRole("button",{name:"编辑服务器",exact:true});
 await edit.click();const dialog=page.getByRole("dialog"),section=dialog.locator("[data-provider-logo-editor]"),toggle=section.getByRole("button",{name:"服务器厂商 Logo",exact:true});
 await expect(toggle).toHaveAttribute("aria-expanded","false");await expect(section.locator("[data-provider-logo-content]")).toHaveCount(0);
 await section.screenshot({path:"test-results/provider-default-closed-"+width+".png"});
 await toggle.click();await expect(section.getByRole("combobox",{name:"选择服务器厂商",exact:true})).toBeVisible();
 await toggle.click();await expect(section.locator("[data-provider-logo-content]")).toHaveCount(0);
 await dialog.locator('button[type="submit"]').click();await expect(dialog).toHaveCount(0);expect(saves).toBe(1);expect(JSON.parse(server.public_note)).toEqual(note);
 await edit.click();await expect(toggle).toHaveAttribute("aria-expanded","false");await expect(section.locator("[data-provider-logo-content]")).toHaveCount(0);
});
