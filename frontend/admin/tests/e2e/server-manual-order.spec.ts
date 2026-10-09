import { expect, test } from "@playwright/test"

for(const width of [320,390,768,1440])for(const theme of ["light","dark"])test("manual order only "+width+" "+theme,async({page},info)=>{
 await page.setViewportSize({width,height:width===320?640:900})
 await page.addInitScript(theme=>localStorage.setItem("nezha-dashboard-theme",theme),theme)
 let servers=Array.from({length:12},(_,i)=>({id:i+1,name:"服务器"+(i+1),uuid:"manual-"+(i+1),display_index:20001-i,user_id:1,host:{},public_note:"",note:"preserve",hide_for_guest:false,hide_for_display:false,enable_ddns:false}))
 const writes:any[]=[];const errors:string[]=[]
 page.on("pageerror",e=>errors.push(e.message))
 await page.route("**/api/v1/**",async r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[]
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0}
  if(path==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(path==="/api/v1/server")data=servers
  if(["POST","PATCH"].includes(r.request().method())){
   const body=r.request().postDataJSON();writes.push({path,body})
   if(path==="/api/v1/server/order"){
    await new Promise(resolve=>setTimeout(resolve,300))
    servers=body.server_ids.map((id:number,i:number)=>({...servers.find(s=>s.id===id),display_index:body.server_ids.length-i}))
   }else if(path==="/api/v1/server/3")servers=servers.map(s=>s.id===3?{...s,...body}:s)
   else throw Error("Unexpected write: "+path)
  }
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard")
 await expect(page.locator("html")).toHaveClass(new RegExp(theme))
 const firstRow=page.getByRole("row").filter({has:page.getByText("服务器1",{exact:true})})
 await expect(firstRow.getByRole("cell").nth(1)).toHaveText("1")
 await page.getByRole("button",{name:"服务器排序",exact:true}).click()
 const dialog=page.getByRole("dialog")
 await expect(dialog).not.toContainText("权重")
 await expect(dialog.getByRole("spinbutton")).toHaveCount(0)
 await expect(dialog.getByRole("button",{name:"保存",exact:true})).toBeDisabled()
 await expect(dialog.getByRole("button",{name:"上移 服务器1",exact:true})).toBeDisabled()
 await expect(dialog.getByRole("button",{name:"下移 服务器12",exact:true})).toBeDisabled()
 await dialog.getByRole("button",{name:"上移 服务器3",exact:true}).click()
 await dialog.getByRole("button",{name:"下移 服务器1",exact:true}).click()
 const ids=()=>dialog.locator("[data-sort-server]").evaluateAll(rows=>rows.map(row=>Number(row.getAttribute("data-sort-server"))))
 await expect.poll(ids).toEqual([3,1,2,4,5,6,7,8,9,10,11,12])
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
 await expect(dialog.getByRole("heading",{name:"服务器排序"})).toBeInViewport()
 await expect(dialog.getByRole("button",{name:"保存",exact:true})).toBeInViewport()
 await page.screenshot({path:info.outputPath("manual-order.png")})
 await dialog.getByRole("button",{name:"保存",exact:true}).click()
 await expect(dialog.getByRole("button",{name:"上移 服务器1",exact:true})).toBeDisabled()
 await expect(dialog).toHaveCount(0)
 expect(writes[0]).toEqual({path:"/api/v1/server/order",body:{server_ids:[3,1,2,4,5,6,7,8,9,10,11,12]}})
 expect(servers.every(s=>s.uuid==="manual-"+s.id&&s.note==="preserve")).toBe(true)
 await page.reload()
 await page.getByRole("button",{name:"服务器排序",exact:true}).click()
 await expect.poll(ids).toEqual([3,1,2,4,5,6,7,8,9,10,11,12])
 await expect(dialog.getByRole("button",{name:"保存",exact:true})).toBeDisabled()
 await dialog.getByRole("button",{name:"下移 服务器3",exact:true}).click()
 await dialog.getByRole("button",{name:"Close",exact:true}).click()
 expect(writes).toHaveLength(1)
 const edit=page.getByRole("row").filter({has:page.getByText("服务器3",{exact:true})}).getByRole("button",{name:"编辑服务器",exact:true})
 await edit.click()
 await expect(dialog.getByText("权重（数字越大，显示越靠前）",{exact:true})).toHaveCount(0)
 await expect(dialog.locator('[name="display_index"]')).toHaveCount(0)
 await dialog.getByLabel("名称",{exact:true}).fill("已编辑服务器")
 await dialog.locator('button[type="submit"]').click()
 await expect(dialog).toHaveCount(0)
 expect(writes).toHaveLength(2)
 expect(writes[1].path).toBe("/api/v1/server/3")
 expect(writes[1].body).not.toHaveProperty("display_index")
 expect(servers[0].id).toBe(3);expect(servers[0].display_index).toBe(12)
 expect(errors).toEqual([])
})

test("desktop drag and save failure preserve manual draft",async({page})=>{
 let attempts=0
 await page.route("**/api/v1/**",async r=>{
  const path=new URL(r.request().url()).pathname;let data:any=[]
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0}
  if(path==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(path==="/api/v1/server")data=[1,2,3].map(id=>({id,name:"拖动"+id,uuid:"drag-"+id,display_index:10-id,host:{}}))
  if(path==="/api/v1/server/order"){
   attempts++;expect(r.request().postDataJSON()).toEqual({server_ids:[3,1,2]})
   await new Promise(resolve=>setTimeout(resolve,300))
   return r.fulfill({json:attempts===1?{success:false,error:"保存失败，请重试"}:{success:true}})
  }
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard")
 await page.getByRole("button",{name:"服务器排序",exact:true}).click()
 const dialog=page.getByRole("dialog")
 await dialog.locator('[data-sort-server="3"]').dragTo(dialog.locator('[data-sort-server="1"]'),{targetPosition:{x:30,y:10}})
 await dialog.getByRole("button",{name:"保存",exact:true}).click()
 await expect(page.getByText("保存失败，请重试",{exact:true})).toBeVisible()
 await expect(dialog.locator("[data-sort-server]").first()).toHaveAttribute("data-sort-server","3")
 await dialog.getByRole("button",{name:"保存",exact:true}).click()
 await expect(dialog).toHaveCount(0);expect(attempts).toBe(2)
})
