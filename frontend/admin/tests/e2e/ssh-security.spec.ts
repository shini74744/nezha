import {test,expect} from "@playwright/test"
test.setTimeout(60000)

function fixture(id=1){
 return {id,name:id===1?"香港测试服务器 IPv6 长名称兼容检查":"另一台服务器",policy:{
 enabled:false,success:true,failure:true,notification_group_id:0,ports:[2222],auto_ban:false,
 whitelist_only:false,max_retry:5,find_time:600,ban_time:3600,allowlist:[],
 block_ips:[],block_updated_at:0,revision:1
 },status:{ban_paging:true,ban_total:1,updated_at:Math.floor(Date.now()/1000),revision:1,ports:[2222],banned:["2001:db8:1234:5678:9012:3456:7890:abcd"],ban_ready:true,block_ready:true,migrated:false}}
}
const dark = process.env.E2E_SSH_DARK === "1"
for(const width of (dark ? [390,1440] : [320,390,768,1440])) test("SSH security workflow and layout "+width,async({page})=>{
 await page.setViewportSize({width,height:900})
 await page.addInitScript((dark)=>{localStorage.setItem("i18nextLng","zh-CN");localStorage.setItem("nezha-dashboard-theme",dark?"dark":"light")},dark)
 const rows:any[]=[fixture(),fixture(2)];const writes:any[]=[];const unbans:any[]=[];let eventsReads=0
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname;const method=route.request().method()
  let data:any=[]
  if(path==="/api/v1/profile")data={id:1,username:"admin",role:0}
  if(path==="/api/v1/setting")data={config:{language:"zh-CN"},version:"fixture"}
  if(path==="/api/v1/notification-group")data=[{group:{id:7,name:"测试通知组"},notifications:[1]}]
  if(path==="/api/v1/ssh-login"){
   if(method==="PUT"){const f=route.request().postDataJSON();writes.push(f);rows.find(x=>x.id===f.server_ids[0]).policy=f.policy}
   for(const row of rows)row.status.updated_at=Math.floor(Date.now()/1000)
   data=rows
  }
  if(path.endsWith("/bans"))data={items:rows[0].status.banned.map((ip:string)=>({ip,banned_at:Date.now()-60000,expires_at:-1})),page:1,page_size:20,total:1,complete:true,observed_at:Date.now()}
  if(path.endsWith("/events")){
   eventsReads++;data=[{id:"fixture",time:Date.now(),username:"root",source_ip:"2001:db8:1234:5678:9012:3456:7890:abcd",port:2222,method:"password",success:false,reason:"认证失败"}]
  }
  if(path==="/api/v1/ssh-login/unban"){unbans.push(route.request().postDataJSON());data={id:10}}
  await route.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/ssh-login")
 await expect(page.getByRole("heading",{name:"SSH 安全",exact:true})).toBeVisible()
 await page.getByRole("button",{name:/香港测试服务器/}).click()
 expect(eventsReads).toBe(0)
 await expect(page.getByText("拉黑 ASN",{exact:true})).toHaveCount(0)
 await expect(page.getByLabel("搜索地区",{exact:true})).toHaveCount(0)
 await page.getByRole("checkbox",{name:"启用 SSH 监测",exact:true}).check()
 await page.getByLabel("SSH 通知组",{exact:true}).selectOption("7")
 await page.getByRole("checkbox",{name:"仅白名单模式",exact:true}).check()
 await page.getByRole("button",{name:"保存这台服务器的设置"}).click()
 await expect(page.getByText("仅白名单模式需要至少一个有效 IP 或网段",{exact:true})).toBeVisible()
 expect(writes).toHaveLength(0)
 await page.getByLabel("IP 白名单",{exact:true}).fill("192.0.2.0/24\n2001:db8::/32")
 await page.getByRole("checkbox",{name:"启用自动封禁",exact:true}).check()
 await page.getByLabel("拉黑 IP 网段",{exact:true}).fill("198.51.100.0/24")
 await page.getByRole("button",{name:"保存这台服务器的设置"}).click()
 await expect.poll(()=>writes.length).toBe(1)
 expect(writes[0]).toMatchObject({server_ids:[1],policy:{ports:[2222],whitelist_only:true,auto_ban:true,block_ips:["198.51.100.0/24"],allowlist:["192.0.2.0/24","2001:db8::/32"]}})
 await page.getByRole("tab",{name:"登录记录",exact:true}).click()
 await expect(page.getByText("登录失败",{exact:true})).toBeVisible()
 expect(eventsReads).toBeGreaterThan(0)
 await page.getByRole("tab",{name:"封禁列表",exact:true}).click()
 await expect(page.getByText("2001:db8:1234:5678:9012:3456:7890:abcd",{exact:true})).toBeVisible()
 await page.getByRole("button",{name:"解封",exact:true}).click()
 await expect.poll(()=>unbans.length).toBe(1)
 expect(unbans[0]).toEqual({server_id:1,ip:"2001:db8:1234:5678:9012:3456:7890:abcd"})
 await page.getByRole("button",{name:"移除",exact:true}).click()
 await expect.poll(()=>writes.length).toBe(2)
 expect(writes[1].policy.block_ips).toEqual([])
 expect(writes[1].policy.allowlist).toEqual(["192.0.2.0/24","2001:db8::/32"])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:"test-results/ssh-bans-"+width+(dark?"-dark":"")+".png",fullPage:true})
 await page.getByRole("button",{name:/另一台服务器/}).click()
 await expect(page.getByRole("tab",{name:"设置",exact:true})).toHaveAttribute("aria-selected","true")
 await expect(page.getByRole("checkbox",{name:"仅白名单模式",exact:true})).not.toBeChecked()
 await page.screenshot({path:"test-results/ssh-settings-"+width+(dark?"-dark":"")+".png",fullPage:true})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect(errors).toEqual([])
})
test("SSH page blocks members and does not fetch sensitive data",async({page})=>{
 const sensitive:string[]=[]
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname
  if(path.startsWith("/api/v1/ssh-login"))sensitive.push(path)
  await route.fulfill({json:{success:true,data:path==="/api/v1/profile"?{id:2,username:"member",role:1}:path==="/api/v1/setting"?{config:{language:"zh-CN"}}:[]}})
 })
 await page.goto("/dashboard/ssh-login")
 await expect(page.getByText("仅管理员可以管理 SSH 安全设置。",{exact:true})).toBeVisible()
 expect(sensitive).toEqual([])
})
test("SSH local-record errors never appear as empty success",async({page})=>{
 await page.route("**/api/v1/**",async route=>{
  const p=new URL(route.request().url()).pathname
  if(p.endsWith("/events"))return route.fulfill({json:{success:false,error:"Agent 暂未连接，无法读取本机记录"}})
  await route.fulfill({json:{success:true,data:p==="/api/v1/profile"?{id:1,username:"admin",role:0}:p==="/api/v1/setting"?{config:{language:"zh-CN"}}:p==="/api/v1/ssh-login"?[fixture()]:[]}})
 })
 await page.goto("/dashboard/ssh-login");await page.getByRole("button",{name:/香港测试服务器/}).click()
 await page.getByRole("tab",{name:"登录记录",exact:true}).click()
 await expect(page.getByRole("alert").filter({hasText:"无法读取本机记录"})).toBeVisible()
 await expect(page.getByText("暂无记录",{exact:true})).toHaveCount(0)
})

for(const width of [320,390,1440]) test("SSH search pagination quick actions and toolbar "+width,async({page})=>{
 await page.setViewportSize({width,height:900})
 await page.addInitScript((theme)=>{localStorage.setItem("i18nextLng","zh-CN");localStorage.setItem("nezha-dashboard-theme",theme)},dark?"dark":"light")
 const row:any=fixture();row.policy.enabled=true;row.policy.notification_group_id=7;row.status.ban_paging=true;row.status.ban_total=1005
 row.policy.block_ips=Array.from({length:47},(_,i)=>"203.0.113."+i)
 const all=Array.from({length:1005},(_,i)=>({ip:"198.18."+Math.floor(i/256)+"."+i%256,banned_at:Date.now()-i*1000,expires_at:i===0?-1:Date.now()+60000}))
 const actions:any[]=[];let failBans=false
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 await page.route("**/api/v1/**",async route=>{
  const u=new URL(route.request().url()),p=u.pathname;let data:any=[]
  if(p==="/api/v1/profile")data={id:1,username:"admin",role:0}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"}}
  if(p==="/api/v1/notification-group")data=[{group:{id:7,name:"TG"},notifications:[1]}]
  if(p==="/api/v1/ssh-login")data=[row]
  if(p.endsWith("/bans")){
   if(failBans)return route.fulfill({json:{success:false,error:"Agent 暂未连接，无法读取封禁列表"}})
   const size=Number(u.searchParams.get("page_size")||20),q=(u.searchParams.get("search")||"").toLowerCase()
   const filtered=all.filter(x=>x.ip.includes(q)),n=Math.min(Number(u.searchParams.get("page")||1),Math.max(1,Math.ceil(filtered.length/size)))
   data={items:filtered.slice((n-1)*size,n*size),total:filtered.length,page:n,page_size:size,complete:true,observed_at:Date.now()}
  }
  if(p.endsWith("/events"))data=[{id:"record",time:Date.now(),username:"root",source_ip:"2001:db8:1234:5678:9012:3456:7890:abcd",port:22,method:"password",success:true}]
  if(p==="/api/v1/ssh-login/ip-action"){
   const f=route.request().postDataJSON();actions.push(f);expect(f.server_id).toBe(row.id);expect(f.revision).toBe(row.policy.revision)
   row.policy.revision++;row.status.revision=row.policy.revision
   data={revision:row.policy.revision,command_id:10}
  }
  await route.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/ssh-login");await page.getByRole("button",{name:/香港测试服务器/}).click()
 await expect(page.getByRole("status").filter({hasText:"监测中"})).toHaveClass(/text-emerald-600/)
 await expect(page.getByText(/已完成旧 SSH 防护迁移|由 Agent 原生处理|支持 Linux。记录/)).toHaveCount(0)
 // Reproduce the site's global header background rule: only the local toolbar must avoid it.
 await page.addStyleTag({content:"#root header{background-color:rgb(220,220,220)!important}"})
 const toolbar=page.getByTestId("ssh-page-toolbar")
 expect(await toolbar.evaluate(e=>e.tagName)).toBe("DIV")
 expect(await toolbar.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe("rgba(0, 0, 0, 0)")
 await expect(page.getByRole("link",{name:"返回服务器列表"})).toBeVisible()
 await page.getByRole("tab",{name:"封禁列表",exact:true}).click()
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(20)
 await expect(page.getByText("到期：永久",{exact:true})).toBeVisible()
 await page.getByRole("button",{name:"自动封禁下一页",exact:true}).click()
 await expect(page.getByTestId("automatic-ban-row").first()).toContainText("198.18.0.20")
 await page.getByLabel("搜索自动封禁 IP",{exact:true}).fill("198.18.3.236")
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(1)
 await expect(page.getByTestId("automatic-ban-row").first()).toContainText("198.18.3.236")
 await page.getByTestId("automatic-ban-row").getByRole("button",{name:"白名单",exact:true}).click()
 await expect.poll(()=>actions.length).toBe(1)
 expect(actions[0]).toMatchObject({ip:"198.18.3.236",action:"whitelist"})
 await page.getByLabel("搜索手动黑名单",{exact:true}).fill("203.0.113.46")
 await expect(page.getByText("203.0.113.46",{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:"test-results/ssh-page-bans-"+width+(dark?"-dark":"")+".png",fullPage:true})
 await page.getByRole("tab",{name:"登录记录",exact:true}).click()
 await page.getByRole("button",{name:"白名单",exact:true}).click()
 await expect.poll(()=>actions.length).toBe(2)
 await page.getByRole("button",{name:"拉黑",exact:true}).click()
 await expect.poll(()=>actions.length).toBe(3)
 expect(actions[2]).toMatchObject({ip:"2001:db8:1234:5678:9012:3456:7890:abcd",action:"blacklist"})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:"test-results/ssh-page-records-"+width+(dark?"-dark":"")+".png",fullPage:true})
 failBans=true;await page.getByRole("tab",{name:"封禁列表",exact:true}).click()
 await page.getByLabel("搜索自动封禁 IP",{exact:true}).fill("offline")
 await expect(page.getByRole("alert").filter({hasText:"无法读取封禁列表"})).toBeVisible()
 await expect(page.getByTestId("automatic-ban-row")).toHaveCount(0)
 expect(errors).toEqual([])
})
