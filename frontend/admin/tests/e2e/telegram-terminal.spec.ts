import { expect, test, Page } from "@playwright/test"
const base = process.env.TG_TERMINAL_PREVIEW || "http://127.0.0.1:18479/telegram-terminal/"
const rows = [{ id:17, name:"HK.香港母鸡1", online:true },{ id:21, name:"JP.日本母鸡", online:false },{ id:71, name:"HK.香港备用", online:true }]
async function fixture(page: Page, authorized = true, theme = "light") {
 await page.route("https://telegram.org/**",r=>r.fulfill({contentType:"text/javascript",body:""}))
 await page.addInitScript(theme=>{Object.assign(window,{Telegram:{WebApp:{initData:"signed-fixture",colorScheme:theme,ready(){},expand(){}}}})},theme)
 const state={creates:0,inputs:[] as string[],windowCreates:0,windowEnds:0,foreignRequests:[] as string[],revoked:false,uploads:0,uploaded:0}
 let windows=[{id:"@1",index:0,name:"main"}]
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname
  if(!path.startsWith("/api/v1/telegram-terminal/")){state.foreignRequests.push(path);return route.abort()}
  const body=route.request().postDataJSON()
  const action=path.split("/").pop()
  if(action==="bootstrap")return route.fulfill({status:authorized?200:403,json:authorized?{token:"test-only",user_id:10,expires_in:900}:{error:"授权无效或已过期，请从 TG 网页终端菜单重新打开。"}})
  expect(route.request().headers().authorization).toBe("Bearer test-only")
  if(state.revoked)return route.fulfill({status:403,json:{error:"授权已过期"}})
  if(action==="servers")return route.fulfill({json:{servers:rows}})
  if(action==="ui-ticket")return route.fulfill({json:{ticket:body.path}})
  if(action!=="ui")return route.abort()
  let data:unknown=[]
  const p=body.path as string, form=body.data||{}
  if(p==="/api/v1/terminal"){state.creates++;data={session_id:"native-"+state.creates,server_id:17,server_name:rows[0].name,kind:"native",keep:false}}
  else if(p==="/api/v1/terminal-commands")data=[{id:1,name:"测试命令",command:"printf audit",version:1}]
  else if(p.endsWith("/list"))data={native:[],tmux:[{id:2,name:"111",source:"panel",windows}],installed:true}
  else if(p.endsWith("/install-status"))data={state:"idle",message:""}
  else if(p.endsWith("/tmux/attach"))data={session_id:"tmux-2",server_id:17,server_name:rows[0].name,kind:"tmux",record_id:2}
  else if(p.endsWith("/window/create")){state.windowCreates++;windows.push({id:"@2",index:1,name:form.name});data={session_closed:false,windows}}
  else if(p.endsWith("/window/end")){state.windowEnds++;windows=windows.filter(w=>w.id!==form.window);data={session_closed:false,windows}}
  else if(p.startsWith("/api/v1/file?"))data={session_id:"files"}
  return route.fulfill({json:{success:true,data}})
 })
 await page.routeWebSocket("**/api/v1/telegram-terminal/ui-ws",ws=>{
  let file=false,authed=false,remaining:number|null=null
  ws.onMessage(message=>{
   if(!authed){const ticket=JSON.parse(String(message)).ticket;file=ticket.includes("/ws/file/");authed=true;ws.send('{"ready":true}');if(!file)ws.send(Buffer.from("fixture$ "));return}
   if(!file){if(typeof message==="string")state.inputs.push(message);return}
   const buf=Buffer.from(message)
   if(remaining!==null){state.uploaded+=buf.length;remaining-=buf.length;if(remaining<=0){remaining=null;ws.send(Buffer.from("NZUP"))}return}
   if(buf[0]===0){const path=Buffer.from(buf.subarray(1).toString()||"/tmp"),len=Buffer.alloc(4);len.writeUInt32BE(path.length);ws.send(Buffer.concat([Buffer.from("NZFN"),len,path,Buffer.from([0,8]),Buffer.from("test.txt")]))}
   if(buf[0]===2){state.uploads++;remaining=Number(buf.readBigUInt64BE(1));if(remaining===0){remaining=null;ws.send(Buffer.from("NZUP"))}}
  })
 })
 return state
}
for(const width of [320,390,1280])for(const theme of ["light","dark"]){
 test("TG shared terminal UI "+width+" "+theme,async({page},testInfo)=>{
  await page.setViewportSize({width,height:850})
  const state=await fixture(page,true,theme)
  await page.goto(base+"#launch=test")
  await expect(page.locator(".tg-server")).toHaveCount(3)
  expect(state.creates).toBe(0)
  await expect(page.getByRole("button",{name:/JP.日本/})).toBeDisabled()
  await page.getByRole("textbox",{name:"搜索服务器"}).fill("HK 香港")
  await expect(page.locator(".tg-server")).toHaveCount(2)
  await page.getByRole("textbox",{name:"搜索服务器"}).fill("１７")
  await expect(page.locator(".tg-server")).toHaveCount(1)
  await page.screenshot({path:testInfo.outputPath("01-picker.png"),animations:"disabled",fullPage:true})
  await page.locator(".tg-server").click()
  await expect(page.locator("#terminal-command-panel")).toBeVisible()
  await expect(page.getByText("测试命令",{exact:true})).toBeVisible()
  await page.getByText("测试命令",{exact:true}).click()
  await page.screenshot({path:testInfo.outputPath("02-commands.png"),animations:"disabled",fullPage:true})
  await page.getByRole("button",{name:"执行",exact:true}).click()
  await expect.poll(()=>state.inputs.join("")).toContain("printf audit\r")
  await page.getByRole("button",{name:"tmux 会话",exact:true}).click()
  const card=page.locator(".terminal-session-card").filter({hasText:"111"})
  await expect(card.getByRole("button",{name:/添加窗口/})).toBeVisible()
  await card.getByRole("button",{name:/添加窗口/}).click()
  await card.getByRole("textbox").fill("second")
  await card.locator("form").getByRole("button",{name:"添加窗口",exact:true}).click()
  await expect.poll(()=>state.windowCreates).toBe(1)
  await expect(card.getByRole("button",{name:/结束窗口/})).toHaveCount(2)
  await page.screenshot({path:testInfo.outputPath("03-tmux-windows.png"),animations:"disabled",fullPage:true})
  await card.getByRole("button",{name:/结束窗口.*second/}).click()
  await page.getByRole("alertdialog").getByRole("button",{name:"结束窗口",exact:true}).click()
  await expect.poll(()=>state.windowEnds).toBe(1)
  await expect(card.getByRole("button",{name:/添加窗口/})).toBeVisible()
  await page.locator("#terminal-session-panel").getByRole("button",{name:"收起会话",exact:true}).click()
  await page.getByRole("button",{name:"文件管理",exact:true}).click()
  await expect(page.getByRole("dialog",{name:"文件管理"})).toBeVisible()
  await expect(page.getByText("test.txt",{exact:true})).toBeVisible()
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10000 })
  await page.screenshot({path:testInfo.outputPath("04-files.png"),animations:"disabled",fullPage:true})
  await page.locator('input[type="file"]').setInputFiles({name:"test.txt",mimeType:"text/plain",buffer:Buffer.from("tg-upload-test")})
  await page.getByRole("alertdialog").getByRole("button",{name:"确认上传",exact:true}).click()
  await expect.poll(()=>state.uploaded).toBe(14)
  await expect(page.locator(".fm-transfer")).toHaveAttribute("data-state","done")
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  expect(state.foreignRequests).toEqual([])
  expect(await page.evaluate(()=>localStorage.getItem("token"))).toBeNull()
  expect(page.url()).not.toContain("launch")
 })
}
test("foreign identity cannot see inventory",async({page})=>{
 const state=await fixture(page,false);await page.goto(base+"#launch=forwarded")
 await expect(page.getByRole("status")).toContainText("授权无效")
 await expect(page.locator(".tg-server")).toHaveCount(0);expect(state.creates).toBe(0)
})
test("ordinary browser fails closed",async({page})=>{
 await page.route("https://telegram.org/**",r=>r.fulfill({contentType:"text/javascript",body:""}))
 await page.goto(base+"#launch=forwarded")
 await expect(page.getByRole("status")).toContainText("请从 TG 机器人")
 await expect(page.locator(".tg-server")).toHaveCount(0)
})
test("revoked authorization removes terminal and never falls back to cookies",async({page})=>{
 const state=await fixture(page);await page.goto(base+"#launch=test");await page.locator(".tg-server").first().click()
 await expect(page.locator("#terminal-command-panel")).toBeVisible()
 await page.locator("#terminal-command-panel").getByRole("button",{name:"收起快捷命令栏",exact:true}).click()
 state.revoked=true
 await page.getByRole("button",{name:"tmux 会话",exact:true}).click()
 await expect(page.getByRole("alert")).toContainText("授权已过期")
 await expect(page.locator(".terminal-shell")).toHaveCount(0)
 expect(state.foreignRequests).toEqual([])
})
