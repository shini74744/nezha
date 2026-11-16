import { test, expect } from "@playwright/test"

for (const width of [390, 1440]) for (const failure of ["gate", "jwt", "jwt-http"]) test(`expiry removes cached server data ${failure} ${width}`, async ({ page }) => {
 await page.setViewportSize({ width, height: 900 })
 const baseURL = test.info().project.use.baseURL as string
 await page.context().addCookies([{ name: "nz-jwt", value: "fixture-session", url: baseURL }])
 let expired = false, profileCalls = 0, serverCalls = 0
 let leaving: any
 await page.exposeFunction("expiryLeaving", (snapshot: any) => { leaving = snapshot })
 await page.addInitScript(() => window.addEventListener("beforeunload", () => {
  void (window as any).expiryLeaving({ oldData: document.body.innerText.includes("过期后必须消失的旧机器"), profile: JSON.parse(localStorage.getItem("mainStore") || "{}").state?.profile })
 }))
 const errors: string[] = []
 page.on("pageerror", e => errors.push(e.message))
 // A gate redirect must request the protected HTML entry again. Hold that
 // navigation to inspect that the old DOM was already removed before it arrives.
 let releaseDocument!: () => void
 const heldDocument = new Promise<void>(r => { releaseDocument = r })
 await page.route("**/dashboard/login?reason=expired", async route => {
  if (!route.request().isNavigationRequest()) return route.continue()
  await heldDocument
  await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<html lang="zh-CN"><h1>后台访问验证</h1><p role="status">登录已过期，请重新登录。</p></html>' })
 })
 await page.route("**/api/v1/**", async route => {
  const path = new URL(route.request().url()).pathname
  let data: any = []
  if (path === "/api/v1/profile") {
   profileCalls++
   // Public identity may still be valid after the separate access gate expires.
   // No second probe should be necessary to process definitive API expiry.
   data = { id: 1, role: 0, username: "admin" }
  }
  if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
  if (path === "/api/v1/server/nic-change-reminders") data = {}
  if (path === "/api/v1/server") {
   serverCalls++
   if (expired) {
    if (failure === "gate") return route.fulfill({ status: 403, headers: { "X-Nezha-Backend-Access": "required" }, body: "" })
    return route.fulfill({ status: failure === "jwt-http" ? 401 : 200, json: { error: "ApiErrorUnauthorized" } })
   }
   data = [{ id: 7, name: "过期后必须消失的旧机器", uuid: "fixture-7", display_index: 7, user_id: 1, host: {}, note: "", public_note: "" }]
  }
  return route.fulfill({ json: { success: true, data } })
 })
 await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
 await expect(page.locator(".server-list-table tbody")).toContainText("过期后必须消失的旧机器")
 expired = true
 if (failure === "gate") {
  await expect.poll(() => leaving, { timeout: 12000 }).toBeDefined()
  expect(leaving.oldData).toBe(false)
  expect(leaving.profile).toBeUndefined()
  releaseDocument()
 }
 await expect(page.getByText("过期后必须消失的旧机器")).toHaveCount(0, { timeout: 12000 })
 await expect(page).toHaveURL(/login\?reason=expired/)
 await expect(page.getByRole("status")).toContainText("登录已过期，请重新登录")
 await expect(page.locator(".server-list-table")).toHaveCount(0)
 await expect(page.getByText(/获取资源时出错/)).toHaveCount(0)
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mainStore") || "{}").state?.profile)).toBeUndefined()
 const stoppedAt = serverCalls
 await page.waitForTimeout(5500)
 expect(serverCalls).toBe(stoppedAt)
 expect(profileCalls).toBe(1)
 expect(errors).toEqual([])
 releaseDocument()
})

test("non-auth permission failures keep the valid page and show a nonempty explanation", async ({ page }) => {
 let denied = false
 await page.route("**/api/v1/**", async route => {
  const path = new URL(route.request().url()).pathname
  let data: any = []
  if (path === "/api/v1/profile") data = { id: 1, role: 0, username: "admin" }
  if (path === "/api/v1/setting") data = { config: { language: "zh-CN" }, version: "test" }
  if (path === "/api/v1/server/nic-change-reminders") data = {}
  if (path === "/api/v1/server") {
   if (denied) return route.fulfill({ status: 403, body: "" })
   data = [{ id: 7, name: "有效会话机器", uuid: "fixture-7", host: {}, note: "", public_note: "" }]
  }
  return route.fulfill({ json: { success: true, data } })
 })
 await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
 await expect(page.getByText("有效会话机器")).toBeVisible()
 denied = true
 await expect(page.getByText(/没有访问权限/)).toBeVisible({ timeout: 12000 })
 await expect(page).toHaveURL(/\/dashboard$/)
 await expect(page.getByText("有效会话机器")).toBeVisible()
})
