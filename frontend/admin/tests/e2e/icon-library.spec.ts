import {test,expect} from "@playwright/test";
const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=";
const asset="/api/v1/logo/assets/"+"c".repeat(64)+".png";
for(const width of [1366,390])test("icon library CRUD and named server selection "+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:950});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 let rows:any[]=[{id:"carrier-hgc",kind:"carrier",name:"HGC 环球全域电讯",regions:["HK"],aliases:"AS9304",logo:asset,logoWebsite:"https://hgc.example/icon.png",background:"",version:1}];
 let server:any={id:11,host:{version:"2.3.5"},name:"图标关联测试",display_index:0,user_id:1,uuid:"fixture",public_note:JSON.stringify({keep:1,planDataMod:{trafficVol:"500G/月"}}),note:"",enable_ddns:false,hide_for_guest:false};
 await page.route("**/api/v1/**",async route=>{const path=new URL(route.request().url()).pathname,method=route.request().method();let data:any=[];
  if(path===asset)return route.fulfill({contentType:"image/png",body:Buffer.from(png.split(",")[1],"base64")});
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};if(path==="/api/v1/setting")data={config:{site_name:"测试",language:"zh-CN"},version:"test"};
  if(path==="/api/v1/logo/fetch")data={image:png,source:"https://fixture.example/icon.png"};if(path==="/api/v1/logo/store")data={logo:asset,logoOriginal:asset};
  if(path==="/api/v1/logo/library"){if(method==="POST"){const form=route.request().postDataJSON();const item={...form,id:form.kind+"-"+rows.length,version:1};rows.push(item);data=item}else data=rows}
  if(path.startsWith("/api/v1/logo/library/")){const id=path.split("/").pop(),old=rows.find(e=>e.id===id);if(method==="PUT"){const form=route.request().postDataJSON();Object.assign(old,form,{version:old.version+1});data={entry:old,updated_servers:1}}else if(method==="DELETE"){rows=rows.filter(e=>e.id!==id);data={entry:old,updated_servers:1}}}
  if(path==="/api/v1/server")data=[server];if(path==="/api/v1/server/11"&&method==="PATCH"){server={...server,...route.request().postDataJSON()};data=null}
  return route.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard/settings/icons");await expect(page.getByRole("heading",{name:"图标设置",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"添加厂商",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByLabel("图标名称",{exact:true}).fill("香港星河云");await dialog.getByLabel("图标搜索别名",{exact:true}).fill("Star Cloud HK");
 await dialog.getByLabel("上传 Logo 图标库",{exact:true}).setInputFiles({name:"logo.png",mimeType:"image/png",buffer:Buffer.from(png.split(",")[1],"base64")});await expect(dialog.getByAltText("图标预览")).toBeVisible();
 await dialog.getByRole("button",{name:"保存",exact:true}).click();await expect(dialog).toHaveCount(0);await page.getByLabel("搜索图标",{exact:true}).fill("Star Cloud");await expect(page.locator("[data-library-row]")).toHaveCount(1);
 await page.getByRole("button",{name:"修改 香港星河云",exact:true}).click();await dialog.getByLabel("图标名称",{exact:true}).fill("星河云 HK");await dialog.getByRole("button",{name:"保存",exact:true}).click();await expect(page.locator("[data-library-row]")).toContainText("星河云 HK");
 await page.screenshot({path:"test-results/icon-settings-"+width+".png",fullPage:true});
 await page.goto("/dashboard");const row=page.getByRole("row").filter({has:page.getByText("图标关联测试",{exact:true})});await row.getByRole("button",{name:"编辑服务器",exact:true}).click();
 await dialog.getByRole("button",{name:"服务器厂商 Logo",exact:true}).click();await dialog.getByRole("combobox",{name:"选择服务器厂商",exact:true}).click();await page.getByRole("combobox",{name:"搜索选择服务器厂商",exact:true}).fill("Star Cloud");await page.getByRole("option",{name:"星河云 HK",exact:true}).click();await expect(dialog.getByAltText("厂商 Logo 预览")).toHaveAttribute("src",asset);
 await dialog.locator('button[type="submit"]').click();await expect(dialog).toHaveCount(0);expect(JSON.parse(server.public_note)).toMatchObject({keep:1,planDataMod:{trafficVol:"500G/月",providerLogo:{logoLibraryId:"provider-1",logoLibraryName:"星河云 HK",logo:asset}}});
 await page.goto("/dashboard/settings/icons");page.on("dialog",d=>d.accept());await page.getByRole("button",{name:"删除 星河云 HK",exact:true}).click();await expect(page.getByText("暂无匹配图标，可以添加新的厂商。")).toBeVisible();
 await page.getByRole("button",{name:"网络运营商",exact:true}).click();await page.getByRole("combobox",{name:"筛选国家地区",exact:true}).click();await page.getByRole("combobox",{name:"搜索筛选国家地区",exact:true}).fill("香港");await page.getByRole("option",{name:/香港/}).click();await expect(page.locator("[data-library-row]")).toContainText("HGC");
 await page.getByRole("button",{name:"添加运营商",exact:true}).click();await dialog.getByLabel("图标名称",{exact:true}).fill("香港测试线路");await dialog.getByRole("combobox",{name:"添加国家地区",exact:true}).click();await page.getByRole("combobox",{name:"搜索添加国家地区",exact:true}).fill("香港");await page.getByRole("option",{name:/香港/}).click();await dialog.getByRole("button",{name:"保存",exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator("[data-library-row]")).toHaveCount(2);
 expect(errors).toEqual([]);
});
