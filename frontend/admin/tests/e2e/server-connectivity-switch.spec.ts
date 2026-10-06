import {test,expect} from "@playwright/test";
for(const width of [390,1440])test("server connectivity default and persisted switch "+width,async({page},info)=>{
 await page.setViewportSize({width,height:950});
 const original={planDataMod:{bandwidth:"30Mbps",custom:"keep"},unknown:{keep:true}};
 let server:any={id:11,host:{version:"2.3.5"},name:"连通性开关测试",display_index:0,user_id:1,uuid:"fixture",public_note:JSON.stringify(original),note:"",enable_ddns:false,hide_for_guest:false};
 const updates:any[]=[];
 await page.route("**/api/v1/**",route=>{
  const path=new URL(route.request().url()).pathname;let data:any=[];
  if(path==="/api/v1/profile")data={id:1,role:0,username:"admin"};
  if(path==="/api/v1/setting")data={config:{language:"zh-CN",site_name:"测试"}};
  if(path==="/api/v1/server")data=[server];
  if(path==="/api/v1/server/11"&&route.request().method()==="PATCH"){updates.push(route.request().postDataJSON());server={...server,...updates.at(-1)};}
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");
 const edit=page.getByRole("row").filter({hasText:"连通性开关测试"}).getByRole("button",{name:"编辑服务器",exact:true});
 const dialog=page.getByRole("dialog"), toggle=dialog.getByRole("switch",{name:"连通性",exact:true});
 await edit.click();await expect(toggle).toBeChecked();await toggle.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath("switch.png")});
 await toggle.click();await dialog.locator('button[type="submit"]').click();
 await expect.poll(()=>updates.length).toBe(1);expect(updates[0].connectivity_disabled).toBe(true);
 expect(JSON.parse(updates[0].public_note).unknown).toEqual({keep:true});
 await edit.click();await expect(toggle).not.toBeChecked();await toggle.click();
 await dialog.locator('button[type="submit"]').click();await expect.poll(()=>updates.length).toBe(2);expect(updates[1].connectivity_disabled).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
