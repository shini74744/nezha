import {expect,test} from "@playwright/test"
for(const width of [320,390,1440]){
test("service sorting persists without changing identities "+width,async({page},info)=>{
 await page.setViewportSize({width,height:900})
 let services=Array.from({length:12},(_,i)=>({id:i+1,name:"服务"+(i+1),type:3,target:"example.org:443",duration:30,display_index:12-i,user_id:1,skip_servers:{},fail_trigger_tasks:[],recover_trigger_tasks:[],notification_group_id:0,enable_trigger_task:false}))
 const writes:any[]=[];const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 await page.route("**/api/v1/**",async r=>{
  const p=new URL(r.request().url()).pathname;let data:any=[]
  if(p==="/api/v1/profile")data={id:1,role:0,username:"admin"}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(p==="/api/v1/service/list")data=services
  if(r.request().method()!=="GET"){
   const body=r.request().postDataJSON();writes.push({p,body})
   if(p==="/api/v1/service/order"){services=body.service_ids.map((id:number,i:number)=>({...services.find(s=>s.id===id),display_index:12-i}))}
  }
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/service")
 await page.getByRole("button",{name:"服务排序",exact:true}).click()
 const dialog=page.getByRole("dialog")
 await expect(dialog).not.toContainText("权重")
 await dialog.getByRole("button",{name:"上移 服务3",exact:true}).click()
 await dialog.getByRole("button",{name:"下移 服务1",exact:true}).click()
 const ids=()=>dialog.locator("[data-sort-service]").evaluateAll(rows=>rows.map(r=>Number(r.getAttribute("data-sort-service"))))
 await expect.poll(ids).toEqual([3,1,2,4,5,6,7,8,9,10,11,12])
 expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath("service-order.png")})
 await dialog.getByRole("button",{name:"保存",exact:true}).click()
 await expect(dialog).toHaveCount(0)
 expect(writes).toEqual([{p:"/api/v1/service/order",body:{service_ids:[3,1,2,4,5,6,7,8,9,10,11,12],original_ids:[1,2,3,4,5,6,7,8,9,10,11,12]}}])
 expect(services.every(s=>s.target==="example.org:443"&&s.duration===30)).toBe(true)
 await page.reload()
 await page.getByRole("button",{name:"服务排序",exact:true}).click()
 await expect.poll(ids).toEqual([3,1,2,4,5,6,7,8,9,10,11,12])
 await dialog.getByRole("button",{name:"下移 服务3",exact:true}).click()
 await dialog.getByRole("button",{name:"Close",exact:true}).click()
 expect(writes).toHaveLength(1)
 expect(errors).toEqual([])
})
}
test("service drag preserves draft after stale save rejection",async({page})=>{
 let attempts=0
 await page.route("**/api/v1/**",async r=>{
  const p=new URL(r.request().url()).pathname;let data:any=[]
  if(p==="/api/v1/profile")data={id:1,role:0,username:"admin"}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(p==="/api/v1/service/list")data=[1,2,3].map(id=>({id,name:"拖动"+id,type:3,target:"example.org:443",duration:30,display_index:4-id,skip_servers:{},fail_trigger_tasks:[],recover_trigger_tasks:[],notification_group_id:0}))
  if(p==="/api/v1/service/order"){attempts++;expect(r.request().postDataJSON()).toEqual({service_ids:[3,1,2],original_ids:[1,2,3]});return r.fulfill({json:{success:false,error:"列表已变化，请关闭后重新打开排序"}})}
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/service");await page.getByRole("button",{name:"服务排序",exact:true}).click()
 const dialog=page.getByRole("dialog")
 await dialog.locator('[data-sort-service="3"]').dragTo(dialog.locator('[data-sort-service="1"]'),{targetPosition:{x:30,y:10}})
 await dialog.getByRole("button",{name:"保存",exact:true}).click()
 await expect(page.getByText("列表已变化，请关闭后重新打开排序",{exact:true})).toBeVisible()
 await expect(dialog.locator("[data-sort-service]").first()).toHaveAttribute("data-sort-service","3")
 expect(attempts).toBe(1)
})
