import { test, expect, type Page } from "@playwright/test"
import { createServer } from "../../../user/src/test/fixtures"

const start = new Date("2026-11-06T00:00:00Z")
const token = (now: number) => "header." + Buffer.from(JSON.stringify({
 uid: "fixture-user", keyId: "shared-session", orig_iat: now / 1000,
})).toString("base64url") + ".signature"

for (const variant of ["default", "doraemon"]) for (const width of [390, 1440]) {
 test("visible public page preserves hidden admin session for three hours " + variant + " " + width, async ({ context }) => {
  test.setTimeout(180_000)
  const origin = process.env[variant === "default" ? "NIC_USER_URL" : "NIC_DORAEMON_URL"]!
  const admin = await context.newPage()
  const front = await context.newPage()
  let expires = start.getTime() + 3_600_000
  let publicRenewals = 0
  let rejected = 0
  let adminPolls = 0
  const errors: string[] = []
  const documents = new Map<Page, number>()
  // Playwright clock is shared across every page in this browser context.
  await admin.clock.install({ time: start })
  await context.addCookies([
   { name: "nz-jwt", value: token(start.getTime()), url: origin },
   { name: "nz-csrf", value: "fixture-csrf", url: origin },
  ])
  await context.addInitScript(() => {
   localStorage.setItem("language", "zh-CN")
   localStorage.setItem("inline", "0")
   localStorage.setItem("doraemon:inline", "0")
   ;(window as any).__renewalResponsesRead = 0
   const original = window.fetch.bind(window)
   window.fetch = async (...args) => {
    const response = await original(...args)
    if (String(args[0]).includes("/api/v1/refresh-token")) {
     const json = response.json.bind(response)
     response.json = async () => {
      try { return await json() }
      finally { (window as any).__renewalResponsesRead++ }
     }
    }
    return response
   }
  })
  for (const page of [admin, front]) {
   await page.setViewportSize({ width, height: 900 })
   documents.set(page, 0)
   page.on("pageerror", e => errors.push(e.message))
   page.on("request", r => { if (r.resourceType() === "document") documents.set(page, documents.get(page)! + 1) })
   await page.routeWebSocket("**/api/v1/ws/server", ws => {
    const send = () => ws.send(JSON.stringify({ now: Date.now(), online: 1, public_note_complete: true,
     servers: [createServer({ id: 7, name: "会话连续性测试" })] }))
    send()
    ws.onMessage(() => send())
   })
   await page.route("**/*", async route => {
    if (page.isClosed()) return route.abort()
    const path = new URL(route.request().url())
    if (path.origin !== origin) return route.abort()
    if (!path.pathname.startsWith("/api/")) return route.continue()
    const now = await page.evaluate(() => Date.now())
    if (path.pathname === "/api/v1/refresh-token") {
     expect(route.request().headers()["x-csrf-token"]).toBe("fixture-csrf")
     if (now >= expires) {
      rejected++
      return route.fulfill({ json: { success: false, error: "ApiErrorUnauthorized" } })
     }
     if (page === front) publicRenewals++
     expires = now + 3_600_000
     const next = token(now)
     return route.fulfill({ headers: { "Set-Cookie": "nz-jwt=" + next + "; Path=/; SameSite=Lax" },
      json: { success: true, data: { token: next } } })
    }
    let data: any = []
    if (path.pathname === "/api/v1/profile") {
     if (now >= expires) return route.fulfill({ json: { success: false, error: "ApiErrorUnauthorized" } })
     data = { id: 1, role: 0, username: "fixture" }
    }
    if (path.pathname === "/api/v1/setting") data = { config: {
     language: "zh-CN", site_name: "会话连续性测试", custom_code: "",
     appearance_config: '{"version":1,"enabled":false,"features":{}}',
     doraemon_appearance_config: '{"version":1,"enabled":false,"features":{}}',
    }, version: "test" }
    if (path.pathname === "/api/v1/server") {
     adminPolls++
     if (now >= expires) return route.fulfill({ json: { success: false, error: "ApiErrorUnauthorized" } })
     data = [{ id: 7, name: "会话连续性测试", uuid: "fixture-7", display_index: 7,
      user_id: 1, host: { version: "1.0.9" }, note: "", public_note: "" }]
    }
    if (path.pathname === "/api/v1/server/nic-change-reminders") data = {}
    if (path.pathname === "/api/v1/service") data = { services: {}, cycle_transfer_stats: {} }
    return route.fulfill({ json: { success: true, data } })
   })
  }
  await admin.goto(origin + "/dashboard")
  await expect(admin.locator(".server-list-table tbody")).toContainText("会话连续性测试", { timeout: 15000 })
  await expect.poll(() => admin.evaluate(() => (window as any).__renewalResponsesRead)).toBe(1)
  await admin.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }))
  await front.goto(origin + "/")
  await expect(front.getByText("会话连续性测试", { exact: true }).first()).toBeVisible()
  await expect.poll(() => front.evaluate(() => (window as any).__renewalResponsesRead)).toBe(1)
  for (let i = 0; i < 36; i++) {
   const before = publicRenewals
   await admin.clock.fastForward(330_100)
   await expect.poll(() => publicRenewals).toBe(before + 1)
   await expect.poll(() => front.evaluate(() => (window as any).__renewalResponsesRead)).toBe(before + 1)
  }
  expect(rejected).toBe(0)
  await front.close()
  await admin.evaluate(() => {
   Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
   document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"))
  })
  await expect(admin.locator(".server-list-table tbody")).toContainText("会话连续性测试", { timeout: 15000 })
  await expect(admin).not.toHaveURL(/login/)
  expect(documents.get(admin)).toBe(1); expect(documents.get(front)).toBe(1)
  await expect.poll(() => admin.evaluate(() => (window as any).__renewalResponsesRead)).toBe(2)
  // Now the server revokes the session: one confirmation redirects without a manual refresh.
  expires = 0
  await admin.clock.fastForward(330_100)
  await expect(admin).toHaveURL(/login\?reason=expired/)
  await expect(admin.getByRole("status")).toContainText("登录已过期，请重新登录")
  const polls = adminPolls
  await admin.clock.fastForward(60_100)
  expect(adminPolls).toBe(polls)
  expect(errors).toEqual([])
 })
}
