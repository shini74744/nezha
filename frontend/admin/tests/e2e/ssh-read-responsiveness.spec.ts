import { test, expect, Page } from "@playwright/test"

test.setTimeout(120000)
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function setup(page: Page) {
 await page.addInitScript(dark => {localStorage.setItem("i18nextLng", "zh-CN");localStorage.setItem("nezha-dashboard-theme",dark?"dark":"light")},process.env.E2E_SSH_DARK === "1")
 let delay = 0
 let fail = false
 const requests: string[] = []
 const errors: string[] = []
 page.on("pageerror", e => errors.push(e.message))
 const rows = [1, 2].map(id => ({ id, name: "测试服务器" + id,
  policy: { enabled:true, success:false, failure:false, notification_group_id:0, ports:[22], auto_ban:true, whitelist_only:false,max_retry:3,find_time:86400,ban_time:-1,allowlist:[],block_ips:[],revision:1 },
  status: {updated_at:Date.now()/1000,revision:1,ban_paging:true,ban_total:5259,ban_ready:true,block_ready:true,ports:[22],banned:[]}
 }))
 await page.route("**/api/v1/**", async route => {
  const url = new URL(route.request().url()), path = url.pathname
  let data: any = []
  if (path === "/api/v1/profile") data = {id:1,username:"admin",role:0}
  if (path === "/api/v1/setting") data = {config:{language:"zh-CN"},version:"fixture"}
  if (path === "/api/v1/ssh-login") data = rows
  if (/\/(events|bans)$/.test(path)) {
   requests.push(path + url.search)
   const pageNumber = Number(url.searchParams.get("page") || 1)
   const size = Number(url.searchParams.get("page_size") || 20)
   const search = url.searchParams.get("search") || ""
   // Superseded page 2 replies after page 3, even if abort is not honored by transport.
   await pause(pageNumber === 2 ? 1800 : delay)
   if (fail) { await route.fulfill({json:{success:false,error:"读取失败，请重试"}}).catch(()=>{}); return }
   if (path.endsWith("/events")) data = [{id:path,time:Date.now(),username:path.includes("/1/")?"user-one":"user-two",source_ip:"192.0.2.1",port:22,method:"password",success:true}]
   else {
    const total = search ? (search === "none" ? 0 : 1) : 5259
    const actual = Math.min(pageNumber, Math.max(1,Math.ceil(total / size)))
    data = {items:Array.from({length:Math.min(size,Math.max(0,total-(actual-1)*size))},(_,i)=>({ip:search||"198.18."+Math.floor(((actual-1)*size+i)/256)+"."+(((actual-1)*size+i)%256),banned_at:Date.now(),expires_at:-1})),total,page:actual,page_size:size,complete:true,observed_at:Date.now()}
   }
  }
  await route.fulfill({json:{success:true,data}}).catch(()=>{})
 })
 await page.goto("/dashboard/ssh-login")
 await page.getByRole("button",{name:/测试服务器1/}).click()
 return {requests,errors,setDelay:(n:number)=>delay=n,setFail:(v:boolean)=>fail=v}
}

for (const width of [390,1440]) test("slow reads remain responsive and latest selection wins "+width,async({page})=>{
 await page.setViewportSize({width,height:900})
 const state=await setup(page)
 await page.getByRole("tab",{name:"封禁列表",exact:true}).click()
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(20)
 const size=page.getByLabel("自动封禁每页条数",{exact:true})
 const next=page.getByRole("button",{name:"自动封禁下一页",exact:true})
 await size.selectOption("100")
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(100)
 await expect(page.getByRole("navigation",{name:"自动封禁分页"})).toContainText("1 / 53")
 state.setDelay(700)
 const pager=page.getByRole("navigation",{name:"自动封禁分页"})
 const top=await pager.evaluate(e=>e.getBoundingClientRect().top+scrollY)
 // A background refresh must neither clear the rows nor disable navigation.
 await page.getByRole("button",{name:"刷新",exact:true}).click()
 await expect(size).toBeEnabled()
 expect(Math.abs(await pager.evaluate(e=>e.getBoundingClientRect().top+scrollY)-top)).toBeLessThan(2)
 await expect(next).toBeEnabled()
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(100)
 await next.click()
 await expect(page.getByRole("navigation",{name:"自动封禁分页"})).toContainText("2 / 53")
 await next.click()
 await expect(page.getByRole("navigation",{name:"自动封禁分页"})).toContainText("3 / 53")
 await expect(page.getByTestId("automatic-ban-row").first()).toContainText("198.18.0.200")
 await page.waitForTimeout(2000)
 await expect(page.getByRole("navigation",{name:"自动封禁分页"})).toContainText("3 / 53")
 // Size changes work even while another page is loading.
 await page.getByRole("button",{name:"自动封禁上一页",exact:true}).click()
 await size.selectOption("50")
 await expect(size).toHaveValue("50")
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(50)
 await expect(page.getByRole("navigation",{name:"自动封禁分页"})).toContainText("1 / 106")
 // Search is scoped; no old-page response may reset the new search.
 await page.getByLabel("搜索自动封禁 IP",{exact:true}).fill("203.0.113.7")
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(1)
 await expect(page.getByTestId("automatic-ban-row").first()).toContainText("203.0.113.7")
 await page.getByLabel("搜索自动封禁 IP",{exact:true}).fill("none")
 await expect(page.getByText("没有符合条件的封禁",{exact:true})).toBeVisible()
 await expect(next).toBeDisabled()
 // Error and manual retry remain usable.
 state.setFail(true)
 await page.getByLabel("搜索自动封禁 IP",{exact:true}).fill("retry")
 await expect(page.getByRole("alert")).toContainText("读取失败")
 await expect(size).toBeEnabled()
 state.setFail(false)
 await page.getByRole("button",{name:"刷新",exact:true}).click()
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(1)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:"test-results/ssh-responsive-"+width+(process.env.E2E_SSH_DARK?"-dark":"")+".png",fullPage:true})
 expect(state.errors).toEqual([])
})

test("record refresh keeps visible rows and server switches never leak old records",async({page})=>{
 const state=await setup(page)
 await page.getByRole("tab",{name:"登录记录",exact:true}).click()
 await expect(page.getByText(/账号：user-one/)).toBeVisible()
 state.setDelay(1200)
 await page.getByRole("button",{name:"刷新",exact:true}).click()
 await expect(page.getByText(/账号：user-one/)).toBeVisible()
 await page.getByRole("button",{name:/测试服务器2/}).click()
 await page.getByRole("tab",{name:"登录记录",exact:true}).click()
 await expect(page.getByText(/账号：user-one/)).toHaveCount(0)
 await expect(page.getByText(/账号：user-two/)).toBeVisible()
 // Returning to the same server/tab uses a short-lived browser snapshot.
 await page.getByRole("tab",{name:"设置",exact:true}).click()
 await page.getByRole("tab",{name:"登录记录",exact:true}).click()
 await expect(page.getByText(/账号：user-two/)).toBeVisible({timeout:500})
 expect(state.errors).toEqual([])
})

test("repeated refresh coalesces the current local read",async({page})=>{
 const state=await setup(page)
 await page.getByRole("tab",{name:"登录记录",exact:true}).click()
 await expect(page.getByText(/账号：user-one/)).toBeVisible()
 const before=state.requests.length
 state.setDelay(1500)
 await page.getByRole("button",{name:"刷新",exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();button.click()})
 await expect.poll(()=>state.requests.length).toBe(before+1)
 await page.waitForTimeout(1700)
 expect(state.requests.length).toBe(before+1)
 await expect(page.getByText(/账号：user-one/)).toBeVisible()
 expect(state.errors).toEqual([])
})
