import { expect, test } from "@playwright/test"

const base = process.env.TG_TERMINAL_PREVIEW || "http://127.0.0.1:18479/telegram-terminal/"
const rows = [
 { id:17, name:"HK.香港母鸡1", online:true },
 { id:21, name:"JP.日本母鸡", online:false },
 { id:71, name:"HK.香港备用", online:true },
]
async function fixture(page: import("@playwright/test").Page, authorized = true) {
 await page.route("https://telegram.org/**", r => r.fulfill({contentType:"text/javascript",body:""}))
 await page.addInitScript(() => {
  Object.assign(window, { Telegram:{WebApp:{initData:"signed-fixture",ready(){},expand(){}}} })
 })
 let connects = 0
 await page.route("**/api/v1/telegram-terminal/**", async route => {
  const path = new URL(route.request().url()).pathname.split("/").pop()
  if (path === "bootstrap") {
   await route.fulfill({status:authorized?200:403,json:authorized?{token:"test-only"}:{error:"授权无效或已过期，请从 TG 网页终端菜单重新打开。"}})
  } else if(path === "servers") await route.fulfill({json:{servers:rows}})
  else if(path === "connect"){connects++;await route.fulfill({json:{ticket:"single-use-fixture"}})}
  else await route.abort()
 })
 await page.routeWebSocket("**/api/v1/telegram-terminal/ws", ws => {
  ws.onMessage(message => {
   if(typeof message === "string" && message.includes('"ticket"')) ws.send('{"ready":true}')
   else ws.send("fixture$ ")
  })
 })
 return () => connects
}
for (const width of [390,1280]) {
 test("TG terminal selection, search and explicit connection "+width,async({page})=>{
  await page.setViewportSize({width,height:850})
  const count=await fixture(page)
  await page.goto(base+"#launch=test-link")
  await expect(page.getByText("选择服务器",{exact:true}).first()).toBeVisible()
  await expect(page.locator(".server")).toHaveCount(3)
  expect(count()).toBe(0)
  await expect(page.getByRole("button",{name:/JP.日本/})).toBeDisabled()
  await page.getByPlaceholder(/搜索名称/).fill("HK 香港")
  await expect(page.locator(".server")).toHaveCount(2)
  await page.getByPlaceholder(/搜索名称/).fill("１７")
  await expect(page.locator(".server")).toHaveCount(1)
  await page.screenshot({path:"test-results/tg-terminal-picker-"+width+".png",fullPage:true})
  await page.locator(".server").click()
  await expect(page.locator("#badge")).toHaveText("已连接")
  expect(count()).toBe(1)
  await page.getByRole("button",{name:"Ctrl+C",exact:true}).click()
  await page.screenshot({path:"test-results/tg-terminal-shell-"+width+".png",fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  await page.getByRole("button",{name:"断开 / 换服务器"}).click()
  await expect(page.locator("#picker")).toBeVisible()
  await expect(page.locator("#shell")).toBeHidden()
  expect(await page.evaluate(()=>localStorage.getItem("token"))).toBeNull()
  expect(page.url()).not.toContain("launch")
 })
}
test("foreign identity cannot see inventory or connect",async({page})=>{
 const count=await fixture(page,false)
 await page.goto(base+"#launch=forwarded-link")
 await expect(page.locator("#status")).toContainText("授权无效")
 await expect(page.locator("#picker")).toBeHidden()
 await expect(page.locator(".server")).toHaveCount(0)
 expect(count()).toBe(0)
})
test("opening in ordinary browser fails closed",async({page})=>{
 await page.route("https://telegram.org/**",r=>r.fulfill({contentType:"text/javascript",body:""}))
 await page.goto(base+"#launch=forwarded-link")
 await expect(page.locator("#status")).toContainText("绑定账号的 TG 私聊")
 await expect(page.locator("#picker")).toBeHidden()
})
