import {test,expect} from "@playwright/test"
for (const width of [360,390,430,1366]) test("expiry settings "+width,async({page})=>{
 await page.setViewportSize({width,height:900})
 await page.addInitScript(()=>localStorage.setItem("i18nextLng","zh-CN"))
 let config={enabled:false,notification_group_id:0,days:[7,3,1,0]}
 const writes:any[]=[]
 const errors:string[]=[]
 page.on("pageerror",e=>errors.push(e.message))
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname
  let data:any=[]
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0}
  if(path==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(path==="/api/v1/notification-group")data=[{group:{id:1,name:"TG"},notifications:[5]}]
  if(path==="/api/v1/server-expiry"){
   if(route.request().method()==="PUT"){config=route.request().postDataJSON();writes.push(config)}
   data={config,servers:[
    {id:1,name:"测试年付服务器",start_date:"2025-09-01",end_date:"2025-10-05T00:00:00+08:00",latest_end_date:"2026-10-05T00:00:00+08:00",renewal_projected:true,renewal_warning:"",auto_renewal:true,cycle:"年",amount:"99元",status:"未到期",expires_at:1791129600,remaining_days:3,delivery:[]},
    {id:2,name:"没有到期日期",status:"未设置到期时间",expires_at:0,delivery:[]}
   ]}
  }
  await route.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/server-expiry")
 await expect(page.getByRole("tab",{name:"服务器到期通知"})).toBeVisible()
 await expect(page.getByRole("heading",{name:"服务器到期通知",exact:true})).toBeVisible()
 await expect(page.getByText("测试年付服务器",{exact:false})).toBeVisible()
 await expect(page.getByText("首次购买日期：2025-09-01 00:00:00",{exact:true})).toBeVisible()
 await expect(page.getByText("原始到期日期：2025-10-05 00:00:00",{exact:true})).toBeVisible()
 await expect(page.getByText("最新到期日期：2026-10-05 00:00:00（按周期推算）",{exact:true})).toBeVisible()
 await expect(page.getByText("剩余约 3 天 · 自动续费（按周期续算）",{exact:true})).toBeVisible()
 await expect(page.getByTestId("expiry-days")).toHaveText("3")
 await expect(page.getByTestId("expiry-days")).toHaveClass(/text-orange-600/)
 expect(await page.getByTestId("expiry-days").evaluate(el => getComputedStyle(el).color !== getComputedStyle(el.parentElement!).color)).toBe(true)
 await expect(page.getByText("没有到期日期",{exact:false})).toHaveCount(0)
 await page.getByRole("checkbox",{name:"启用服务器到期通知"}).check()
 await page.getByRole("button",{name:"保存到期通知设置"}).click()
 await expect(page.getByText("启用前请选择通知组",{exact:true})).toBeVisible()
 expect(writes).toHaveLength(0)
 await page.getByLabel("到期通知组",{exact:true}).selectOption("1")
 await page.getByLabel("提前提醒天数",{exact:true}).fill("10,2,0")
 await page.getByRole("button",{name:"保存到期通知设置"}).click()
 await expect(page.getByText("到期通知设置已保存",{exact:true})).toBeVisible()
 expect(writes).toEqual([{enabled:true,notification_group_id:1,days:[10,2,0]}])
 await page.getByRole("checkbox",{name:"仅显示已设置到期时间"}).uncheck()
 await expect(page.getByText("没有到期日期",{exact:false})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:"test-results/expiry-"+width+".png"})
 expect(errors).toEqual([])
 await page.getByRole("tab",{name:"通知",exact:true}).click()
 await expect(page.getByRole("tab",{name:"服务器到期通知"})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
test("member cannot see expiry entry",async({page})=>{
 await page.route("**/api/v1/**",r=>{
  const p=new URL(r.request().url()).pathname
  return r.fulfill({json:{success:true,data:p==="/api/v1/profile"?{id:2,username:"member",role:1}:p==="/api/v1/setting"?{config:{language:"zh-CN"}}:[]}})
 })
 await page.goto("/dashboard/server-expiry")
 await expect(page.getByText("仅管理员可管理服务器到期通知。")).toBeVisible()
 await expect(page.getByRole("tab",{name:"服务器到期通知"})).toHaveCount(0)
})
