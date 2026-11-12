import {test,expect} from "@playwright/test"
test.setTimeout(120000)
for (const width of [320,390,1440]) for (const dark of [false,true]) test("SSH backend parity "+width+" "+dark,async({page})=>{
 await page.setViewportSize({width,height:900})
 await page.addInitScript(d=>{localStorage.setItem("i18nextLng","zh-CN");localStorage.setItem("nezha-dashboard-theme",d?"dark":"light")},dark)
 const policy={backend:"native",enabled:true,success:false,failure:false,notification_group_id:0,ports:[2222],auto_ban:true,whitelist_only:false,max_retry:3,find_time:86400,ban_time:-1,allowlist:["192.0.2.1"],block_ips:["198.51.100.0/24"],block_updated_at:0,revision:1}
 const row:any={id:19,name:"香港测试服务器 长名称网卡与网络命名空间",policy,status:{backend:"native",backend_selection:true,updated_at:Date.now()/1000,revision:1,source:"journal",ports:[2222],banned:[],ban_total:0,ban_paging:true,ban_ready:true,block_ready:true}}
 const writes:any[]=[];const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname
  let data:any=[]
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0}
  if(path==="/api/v1/setting")data={config:{language:"zh-CN"}}
  if(path==="/api/v1/ssh-login"){
   if(route.request().method()==="PUT"){const f=route.request().postDataJSON();writes.push(f);row.policy={...f.policy,revision:row.policy.revision+1};row.status.message="正在安装 Fail2ban，原防护保持运行"}
   data=[row]
  }
  await route.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/ssh-login",{waitUntil:"domcontentloaded"})
 await page.getByRole("button",{name:/香港测试服务器/}).click()
 await expect(page.getByLabel("防护方式",{exact:true})).toHaveValue("native")
 await page.getByLabel("防护方式",{exact:true}).selectOption("fail2ban")
 expect(writes).toHaveLength(0)
 await expect(page.getByLabel("拉黑 IP 网段",{exact:true})).toHaveValue("198.51.100.0/24")
 await expect(page.getByLabel("IP 白名单",{exact:true})).toHaveValue("192.0.2.1")
 await page.getByRole("checkbox",{name:"仅白名单模式",exact:true}).check()
 await expect(page.getByLabel("失败次数",{exact:true})).toHaveValue("3")
 await expect(page.getByLabel("统计时间",{exact:true})).toHaveValue("86400")
 await page.getByRole("button",{name:"保存这台服务器的设置"}).click()
 await expect.poll(()=>writes.length).toBe(1)
 expect(writes[0].policy).toMatchObject({...policy,backend:"fail2ban",whitelist_only:true})
 await expect(page.getByRole("status").filter({hasText:"正在安装 Fail2ban"})).toBeVisible()
 await expect(page.getByLabel("防护方式",{exact:true})).toHaveValue("fail2ban")
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:"test-results/ssh-backend-"+width+"-"+dark+".png",fullPage:true})
 expect(errors).toEqual([])
})
test("Legacy Agent cannot silently apply Fail2ban as native",async({page})=>{
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname
  const data=path.endsWith("/profile")?{id:1,username:"admin",role:0}:path.endsWith("/setting")?{config:{language:"zh-CN"}}:path.endsWith("/ssh-login")?[{id:1,name:"旧版 Agent",policy:{enabled:false,ports:[22],allowlist:[],block_ips:[],revision:0},status:{updated_at:0}}]:[]
  await route.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/ssh-login",{waitUntil:"domcontentloaded"})
 await page.getByRole("button",{name:/旧版 Agent/}).click()
 await expect(page.getByRole("option",{name:"Fail2ban",exact:true})).toHaveJSProperty("disabled",true)
 await expect(page.getByText("升级 Linux Agent 后可选择 Fail2ban。",{exact:true})).toBeVisible()
})
