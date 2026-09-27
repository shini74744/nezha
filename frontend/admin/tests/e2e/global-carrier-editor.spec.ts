import {test,expect} from "@playwright/test";
import {carriers} from "../../../shared/carriers";
for(const width of [1366,390])test("global carriers and link tags editor "+width,async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width,height:950});
 const original={planDataMod:{networkRoute:"CN2,旧线路",custom:"keep"},unknown:{keep:true}};
 let server:any={id:11,host:{version:"2.3.5"},name:"全球运营商测试",display_index:0,user_id:1,uuid:"fixture",public_note:JSON.stringify(original),note:"",enable_ddns:false,hide_for_guest:false};
 const updates:any[]=[],errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();let data:any=[];
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0};
  if(path==="/api/v1/setting")data={config:{site_name:"测试",language:"zh-CN"},version:"test"};
  if(path==="/api/v1/server")data=[server];
  if(path==="/api/v1/server/11"&&method!=="GET"){const body=route.request().postDataJSON();updates.push(body);server={...server,...body};}
  await route.fulfill({json:{success:true,data}});
 });
 await page.goto("/dashboard");
 const row=page.getByRole("row").filter({has:page.getByText("全球运营商测试",{exact:true})});
 await row.getByRole("button",{name:"编辑服务器",exact:true}).click();
 const dialog=page.getByRole("dialog"),editor=dialog.locator("[data-other-routes-editor]");
 await expect(editor.getByText("其他运营商",{exact:true})).toBeVisible();
 await expect(editor.getByLabel("线路名称 1",{exact:true})).toHaveValue("旧线路");
 async function choose(label:string,search:string,option:string){
  await editor.getByRole("combobox",{name:label,exact:true}).click();
  await page.getByRole("combobox",{name:"搜索"+label,exact:true}).fill(search);
  await page.getByRole("option",{name:option,exact:true}).click();
 }
 await choose("国家地区 1","日本","日本");
 await editor.getByRole("combobox",{name:"运营商 Logo 1",exact:true}).click();
 await expect(page.getByRole("option",{name:"NTT",exact:true})).toBeVisible();
 await expect(page.getByRole("option",{name:"AT&T",exact:true})).toHaveCount(0);
 await page.getByRole("option",{name:"NTT",exact:true}).click();
 await editor.getByLabel("线路名称 1",{exact:true}).fill("AS2914");
 await editor.getByRole("button",{name:"添加线路",exact:true}).click();
 await choose("国家地区 2","美国","美国");await choose("运营商 Logo 2","Cogent","Cogent");
 await editor.getByLabel("线路名称 2",{exact:true}).fill("AS174");
 await editor.getByRole("button",{name:"添加线路",exact:true}).click();
 await choose("国家地区 3","新西兰","新西兰");await choose("运营商 Logo 3","手动","手动添加运营商");
 await editor.getByLabel("运营商名称 3",{exact:true}).fill("My NZ ISP");
 await editor.getByLabel("线路名称 3",{exact:true}).fill("Custom transit");
 await editor.getByLabel("上传 Logo 3",{exact:true}).setInputFiles({name:"logo.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=","base64")});
 await expect(editor.locator("[data-other-route-row]").nth(2).locator("img")).toHaveCount(1);
 await editor.getByRole("button",{name:"添加线路",exact:true}).click();
 await editor.getByRole("button",{name:"删除线路 4",exact:true}).click();
 const links=dialog.locator("[data-link-tags-editor]");
 await links.getByRole("button",{name:"添加链接标签",exact:true}).click();
 await links.getByLabel("标签名称 1",{exact:true}).fill("购买");
 await links.getByLabel("标签网址 1",{exact:true}).fill("https://example.com/buy");
 await editor.scrollIntoViewIfNeeded();await page.screenshot({path:"test-results/global-editor-"+width+".png",fullPage:true});
 await dialog.getByRole("button",{name:"原始文本",exact:true}).click();
 const raw=dialog.getByRole("textbox",{name:"公开备注原始文本"}),doc=JSON.parse(await raw.inputValue());
 expect(doc.套餐信息.其他运营商线路[0]).toMatchObject({运营商:"ntt",国家地区:"JP",线路名称:"AS2914"});
 expect(doc.套餐信息.其他运营商线路[2].Logo地址).toContain("data:image/png;base64,");
 expect(doc.套餐信息.链接标签).toEqual([{名称:"购买",网址:"https://example.com/buy"}]);
 await dialog.getByRole("button",{name:"自定义字段",exact:true}).click();
 await dialog.locator('button[type="submit"]').click();await expect.poll(()=>updates.length).toBe(1);
 const saved=JSON.parse(updates[0].public_note);
 expect(saved.planDataMod.networkRoute).toBe("CN2,AS2914,AS174,Custom transit");
 expect(saved.unknown).toEqual({keep:true});expect(saved.planDataMod.custom).toBe("keep");
 await row.getByRole("button",{name:"编辑服务器",exact:true}).click();
 await expect(editor.getByRole("combobox",{name:"国家地区 1",exact:true})).toHaveText("日本");
 await expect(editor.getByRole("combobox",{name:"运营商 Logo 1",exact:true})).toContainText("NTT");
 await expect(editor.getByLabel("运营商名称 3",{exact:true})).toHaveValue("My NZ ISP");
 await expect(links.getByLabel("标签名称 1",{exact:true})).toHaveValue("购买");
 expect(errors).toEqual([]);
});
test("collected carrier logos decode",async({page})=>{
 await page.setViewportSize({width:1000,height:1200});
 await page.setContent('<body style="background:#171717;color:white;font:14px sans-serif"><main style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px"></main></body>');
 await page.evaluate(list=>{
  const main=document.querySelector("main")!;
  for(const c of list){const d=document.createElement("div"),im=document.createElement("img"),label=document.createElement("div");
   im.src=c.icon;im.style.cssText="width:100px;height:48px;object-fit:contain";label.textContent=c.label;d.append(im,label);main.append(d);}
 },carriers);
 await expect.poll(()=>page.locator("img").evaluateAll(imgs=>imgs.every(im=>(im as HTMLImageElement).complete&&(im as HTMLImageElement).naturalWidth>0))).toBe(true);
 await page.screenshot({path:"test-results/global-logo-catalog.png",fullPage:true});
});
