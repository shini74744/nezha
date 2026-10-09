import { expect, test } from "@playwright/test"
for (const width of [360,390,1366]) for (const theme of ["light","dark"]) test("card priority persistence and responsive layout "+width+" "+theme, async ({page}) => {
 await page.setViewportSize({width,height:900})
 await page.addInitScript(theme=>localStorage.setItem("nezha-dashboard-theme",theme),theme)
 let state={order:["connectivity","bgp","return-route","streaming"],revision:"p1"}, writes=0, conflict=false
 await page.routeWebSocket(/\/api\/v1\/ws\//,()=>{})
 await page.route("**/api/v1/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data:any=[]
  if(path==="/api/v1/profile")data={id:1,username:"qa",role:0}
  if(path==="/api/v1/setting")data={config:{language:"zh-CN"},frontend_templates:[]}
  if(path==="/api/v1/setting/connectivity")data={items:[],defaults:[],revision:"c1",max_targets:120}
  if(path.endsWith("/automation"))data={enabled:true,interval_hours:6,retention_days:1,revision:"a1"}
  if(path==="/api/v1/setting/return-route")data={enabled:true,interval_hours:6,retention_days:1,protocol:"tcp",targets:[],revision:"r1"}
  if(path==="/api/v1/setting/detection-priority"){
   if(req.method()==="PUT"){
    writes++
    if(conflict)return route.fulfill({json:{success:false,error:"设置已被其他页面修改，请重新加载"}})
    expect(req.postDataJSON().revision).toBe(state.revision)
    state={...req.postDataJSON(),revision:"p"+(writes+1)}
   }
   data=state
  }
  return route.fulfill({json:{success:true,data}})
 })
 await page.goto("http://127.0.0.1:18479/dashboard/settings/cards")
 const panel=page.locator("[data-detection-priority]")
 await panel.locator("summary").click()
 const save=panel.getByRole("button",{name:"保存优先级",exact:true})
 await expect(save).toBeDisabled()
 await panel.getByRole("button",{name:"回程提高优先级",exact:true}).click()
 await panel.getByRole("button",{name:"回程提高优先级",exact:true}).click()
 await expect(panel.getByRole("listitem").first()).toContainText("回程")
 await expect(panel.getByRole("button",{name:"回程提高优先级",exact:true})).toBeDisabled()
 await save.click();await expect(save).toBeDisabled()
 expect(writes).toBe(1);expect(state.order).toEqual(["return-route","connectivity","bgp","streaming"])
 await page.getByRole("tab",{name:"BGP",exact:true}).click()
 await expect(panel.getByRole("listitem").first()).toContainText("回程")
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await page.screenshot({path:"test-results/card-priority-"+width+"-"+theme+".png"})
 await page.reload();await panel.locator("summary").click()
 await expect(panel.getByRole("listitem").first()).toContainText("回程")
 conflict=true
 await panel.getByRole("button",{name:"BGP提高优先级",exact:true}).click();await save.click()
 await expect(panel.getByRole("alert")).toContainText("其他页面");await expect(save).toBeEnabled()
 expect(state.order).toEqual(["return-route","connectivity","bgp","streaming"])
 page.on("dialog",dialog=>dialog.accept())
 await panel.getByRole("button",{name:"重新加载优先级",exact:true}).click()
 await expect(save).toBeDisabled()
})
