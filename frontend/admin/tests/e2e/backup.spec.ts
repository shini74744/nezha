import { expect, test } from "@playwright/test"

const baseTarget={retain_count:15,id:1,name:"构建机备份",server_id:9,host:"192.0.2.10",port:2022,user:"ddnb_123456789abc_12345678",directory:"/var/lib/ddnezha-backup/backups",fingerprint:"SHA256:fixture",auth_type:"key",receiver:true,transport:"sftp",has_secret:true}
const good={id:1,target_id:1,name:"构建机备份",state:"success",phase:"completed",started_at:"2026-11-15T10:00:00+08:00",finished_at:"2026-11-15T10:02:00+08:00",processed_bytes:10000,total_bytes:10000,sent_bytes:8000,verified_bytes:8000,archive:"/var/lib/ddnezha-backup/backups/ddnezha-123456789abc/backup.tar.gz.age",sha256:"a".repeat(64)}
const failed={...good,id:2,target_id:2,name:"外部备份机器",state:"failed",phase:"failed",error:"目标磁盘空间不足，备份未完成",archive:"",sha256:"",sent_bytes:2000,processed_bytes:3000,verified_bytes:0}
const run={id:12,state:"partial",phase:"completed",trigger:"manual",started_at:"2026-11-15T10:00:00+08:00",finished_at:"2026-11-15T10:02:00+08:00",encrypted:true,total_bytes:10000,deliveries:[good,failed]}
for(const width of [320,390,768,1440]) for(const theme of ["light","dark"])
test(`backup multi-target details ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:900})
 await page.addInitScript(theme=>localStorage.setItem("nezha-dashboard-theme",theme),theme)
 let plan:any={backup_type:"full",mode:"interval",interval_minutes:60,daily_time:"03:00",target_ids:[1,2],encrypt:true,has_password:true,next_at:"2026-11-15T11:02:00+08:00"}
 const writes:any[]=[];const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 await page.route("**/api/v1/**",async r=>{
  const p=new URL(r.request().url()).pathname;let data:any=[]
  if(p==="/api/v1/profile")data={id:1,role:0,username:"admin"}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(p==="/api/v1/backup")data={plan,targets:[baseTarget,{...baseTarget,id:2,name:"外部备份机器",server_id:0}],active:null,server_time:"2026-11-15T10:03:00+08:00"}
  if(p==="/api/v1/backup/history")data={items:[run],total:21,page:Number(new URL(r.request().url()).searchParams.get("page")),page_size:10}
  if(r.request().method()!=="GET"){
   writes.push({p,body:r.request().postDataJSON()})
   if(p==="/api/v1/backup/plan")plan={...plan,...r.request().postDataJSON()}
   if(p==="/api/v1/backup/run")data={id:13}
  }
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/settings/backup",{waitUntil:"domcontentloaded"})
 await expect(page.getByRole("heading",{name:"数据备份",exact:true})).toBeVisible()
 await expect(page.getByText("下次备份时间",{exact:true})).toBeVisible()
 await expect(page.getByLabel("备份类型",{exact:true})).toHaveValue("full")
 await expect(page.getByLabel("备份方式",{exact:true}).locator("option[value=realtime]")).toHaveCount(0)
 await page.getByLabel("备份类型",{exact:true}).selectOption("incremental")
 await expect(page.getByRole("link",{name:"下载 构建机备份 第 12 轮备份",exact:true})).toHaveAttribute("href","/api/v1/backup/deliveries/1/download")
 await page.getByRole("button",{name:"查看详情",exact:true}).click()
 await expect(page.getByText("目标磁盘空间不足，备份未完成",{exact:true})).toBeVisible()
 await expect(page.getByRole("progressbar")).toHaveCount(2)
 await expect(page.getByRole("progressbar").first()).toHaveAttribute("aria-valuenow","100")
 await expect(page.getByRole("progressbar").nth(1)).toHaveAttribute("aria-valuenow","30")
 expect(await page.locator("body").evaluate(e=>e.scrollWidth<=window.innerWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath(`backup-${width}-${theme}.png`),fullPage:true})
 await page.getByRole("button",{name:"重试此目标",exact:true}).click()
 await expect.poll(()=>writes.length).toBe(1)
 expect(writes[0]).toEqual({p:"/api/v1/backup/run",body:{target_ids:[2],retry_of:12}})
 await page.getByRole("button",{name:"下一页",exact:true}).click()
 await expect(page.getByText("2 / 3",{exact:true})).toBeVisible()
 await page.getByLabel("加密备份包").uncheck()
 await page.getByLabel("选择备份目标 外部备份机器").uncheck()
 await page.getByRole("button",{name:"保存设置",exact:true}).click()
 await expect.poll(()=>writes.length).toBe(2)
 expect(writes[1].body.backup_type).toBe("incremental");expect(writes[1].body.encrypt).toBe(false);expect(writes[1].body.target_ids).toEqual([1])
 expect(JSON.stringify(writes)).not.toContain("PRIVATE KEY")
 expect(errors).toEqual([])
})
test("backup receiver setup handles Agent disabled and keeps unique manual command",async({page})=>{
 const requests:any[]=[]
 await page.route("**/api/v1/**",async r=>{
  const p=new URL(r.request().url()).pathname;let data:any=[]
  if(p==="/api/v1/profile")data={id:1,role:0,username:"admin"}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(p==="/api/v1/backup")data={plan:{mode:"manual",interval_minutes:60,daily_time:"03:00",target_ids:[],encrypt:false},targets:[],active:null}
  if(p==="/api/v1/backup/history")data={items:[],total:0}
  if(p==="/api/v1/server")data=[{id:9,name:"构建机",geoip:{ip:{ipv4_addr:"192.0.2.10"}}}]
  if(p==="/api/v1/backup/prepare"){requests.push(r.request().postDataJSON());data={target:{...baseTarget,fingerprint:"SHA256:pending"},command:"fixture-only unique receiver install command"}}
  if(p==="/api/v1/backup/setup")return r.fulfill({json:{success:false,error:"Agent 已关闭远程命令，无法自动安装，请手动安装"}})
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/settings/backup",{waitUntil:"domcontentloaded"})
 await page.getByRole("button",{name:"添加目标",exact:true}).click()
 await expect(page.getByLabel("保留份数",{exact:true})).toHaveValue("15")
 await page.getByLabel("服务器",{exact:true}).selectOption("9")
 await expect(page.getByLabel("服务器地址",{exact:true})).toHaveValue("192.0.2.10")
 await expect(page.getByLabel("备份端口",{exact:true})).toHaveValue("2022")
 await page.getByRole("button",{name:"自动对接",exact:true}).click()
 await expect(page.getByRole("alert")).toContainText("Agent 已关闭远程命令")
 await expect(page.getByRole("textbox",{name:"手动对接命令",exact:true})).toHaveValue("fixture-only unique receiver install command")
 await page.getByRole("button",{name:"自动对接",exact:true}).click()
 expect(requests).toHaveLength(1)
 await expect(page.getByRole("alert")).toContainText("手动安装")
})
test("non-admin has no backup API access or entry",async({page})=>{
 const requested:string[]=[]
 await page.route("**/api/v1/**",async r=>{
  const p=new URL(r.request().url()).pathname;requested.push(p)
  let data:any=[]
  if(p==="/api/v1/profile")data={id:2,role:1,username:"viewer"}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/settings/backup",{waitUntil:"domcontentloaded"})
 await expect(page.getByText("仅管理员可以管理数据备份。")).toBeVisible()
 expect(requested.filter(p=>p.startsWith("/api/v1/backup"))).toEqual([])
 await expect(page.getByRole("tab",{name:"数据备份",exact:true})).toHaveCount(0)
})

for(const background of [false,true]) test("receiver setup polls and survives dialog close "+background,async({page},info)=>{
 await page.setViewportSize({width:390,height:844})
 let target:any=null,complete=false,polls=0
 await page.route("**/api/v1/**",async r=>{
  const p=new URL(r.request().url()).pathname;let data:any=[]
  if(p==="/api/v1/profile")data={id:1,role:0,username:"admin"}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(p==="/api/v1/backup")data={plan:{mode:"manual",interval_minutes:60,daily_time:"03:00",target_ids:[],encrypt:false},targets:target?[{...target,setup_state:complete?"success":target.setup_state}]:[],active:null,time_zone:"Asia/Shanghai"}
  if(p==="/api/v1/backup/history")data={items:[],total:0}
  if(p==="/api/v1/server")data=[{id:9,name:"构建机",geoip:{ip:{ipv4_addr:"192.0.2.10"}}}]
  if(p==="/api/v1/backup/prepare"){target={...baseTarget,fingerprint:"SHA256:pending"};data={target,command:"fixture public command"}}
  if(p==="/api/v1/backup/setup"){target.setup_state="installing";data=target}
  if(p==="/api/v1/backup/targets/1/status"){polls++;if(!background)complete=true;data={...target,setup_state:complete?"success":"installing"}}
  return r.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/settings/backup",{waitUntil:"domcontentloaded"})
 await page.getByRole("button",{name:"添加目标",exact:true}).click()
 await expect(page.getByLabel("保留份数",{exact:true})).toHaveValue("15")
 await page.getByLabel("服务器",{exact:true}).selectOption("9")
 await page.getByRole("button",{name:"自动对接",exact:true}).click()
 await expect(page.getByText("正在安装备份接收端，可关闭窗口并稍后查看结果。",{exact:true})).toBeVisible()
 expect(await page.getByRole("dialog").evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath("receiver-setup-mobile.png")})
 if(background){
  await page.getByRole("button",{name:"关闭，后台继续",exact:true}).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText("正在安装接收端…",{exact:true})).toBeVisible()
  complete=true
  await expect(page.getByText("正在安装接收端…",{exact:true})).toHaveCount(0,{timeout:8000})
 }else{
  await expect(page.getByRole("dialog")).toHaveCount(0,{timeout:8000})
  expect(polls).toBeGreaterThan(0)
 }
})
