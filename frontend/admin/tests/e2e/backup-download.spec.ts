import { expect,test } from "@playwright/test"

for(const width of [320,390,1440])test(`backup download machine choice and external retention ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900})
 const saved:any[]=[]
 const target={id:1,name:"备份机器 A",server_id:0,host:"192.0.2.10",port:22,user:"backup",directory:"/srv/backups",fingerprint:"SHA256:test",auth_type:"password",transport:"sftp",has_secret:true,retain_count:15}
 const common={state:"success",phase:"completed",started_at:"2026-11-15T10:00:00+08:00",finished_at:"2026-11-15T10:01:00+08:00",total_bytes:100,sent_bytes:80,verified_bytes:80,processed_bytes:100,sha256:"a".repeat(64)}
 const deliveries=[{...common,id:10,target_id:1,name:"备份机器 A",backup_type:"full",archive:"/srv/backups/backup-a.tar.gz"},{...common,id:11,target_id:2,name:"备份机器 B",parent_id:5,backup_type:"incremental",archive:"/srv/backups/backup-b.tar.gz.age"},{...common,id:12,target_id:3,name:"已清理机器",pruned_at:"2026-11-15T10:02:00+08:00",archive:"/srv/backups/expired.tar.gz"}]
 await page.route("**/api/v1/**",async route=>{
  const p=new URL(route.request().url()).pathname;let data:any=[]
  if(p==="/api/v1/profile")data={id:1,role:0,username:"admin"}
  if(p==="/api/v1/setting")data={config:{language:"zh-CN"},version:"test"}
  if(p==="/api/v1/backup")data={plan:{mode:"manual",backup_type:"incremental",target_ids:[1],encrypt:false,interval_minutes:60,daily_time:"03:00"},targets:[target],active:null}
  if(p==="/api/v1/backup/history")data={items:[{id:20,trigger:"manual",state:"success",deliveries,total_bytes:100,...{started_at:common.started_at,finished_at:common.finished_at}}],total:1}
  if(p==="/api/v1/backup/targets"&&route.request().method()==="POST"){saved.push(route.request().postDataJSON());data=saved.at(-1)}
  return route.fulfill({json:{success:true,data}})
 })
 await page.goto("/dashboard/settings/backup",{waitUntil:"domcontentloaded"})
 const select=page.getByRole("combobox",{name:"第 20 轮下载机器",exact:true})
 await expect(select.locator("option")).toHaveCount(2)
 await select.selectOption("11")
 const chosen=page.getByRole("link",{name:"下载 备份机器 B 第 20 轮备份",exact:true})
 await expect(chosen).toHaveAttribute("href","/api/v1/backup/deliveries/11/download")
 await expect(chosen).toHaveText("下载恢复包")
 await page.context().route("**/api/v1/backup/deliveries/11/download",route=>route.fulfill({status:200,headers:{"content-type":"application/octet-stream","content-disposition":'attachment; filename="test-backup.tar"'},body:"verified fixture bytes"}))
 const receiving=page.waitForEvent("download")
 await chosen.click()
 const downloaded=await receiving
 expect(downloaded.suggestedFilename()).toBe("test-backup.tar")
 await downloaded.saveAs(info.outputPath("test-backup.tar"))
 expect(await downloaded.failure()).toBeNull()
 await page.getByRole("button",{name:"查看详情",exact:true}).click()
 await expect(page.getByText("包含基础包及所需增量",{exact:true})).toBeVisible()
 await expect(page.getByText("已按保留设置清理",{exact:false})).toBeVisible()
 expect(await page.locator("body").evaluate(e=>e.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath(`download-${width}.png`),fullPage:true})
 await page.getByRole("button",{name:"编辑",exact:true}).click()
 await expect(page.getByLabel("保留份数",{exact:true})).toHaveValue("15")
 await page.getByLabel("保留份数",{exact:true}).fill("7")
 await page.getByRole("button",{name:"保存目标",exact:true}).click()
 await expect.poll(()=>saved.length).toBe(1)
 expect(saved[0].retain_count).toBe(7)
 expect(saved[0].server_id).toBe(0)
 await page.getByRole("button",{name:"添加目标",exact:true}).click()
 await expect(page.getByLabel("保留份数",{exact:true})).toHaveValue("15")
})
