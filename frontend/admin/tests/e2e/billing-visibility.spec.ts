import { test, expect } from "@playwright/test";
import { createServer } from "../../../user/src/test/fixtures";

for (const width of [320, 390, 1440]) test("billing controls save and keep layout " + width, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript(() => localStorage.setItem("language", "zh-CN"));
  const original = { billingDataMod: { amount: "0", cycle: "Month", endDate: "0000-00-00T23:59:59+08:00" }, planDataMod: { bandwidth: "300Mbps" }, custom: "keep" };
  let server: any = { id: 11, host: { version: "1.0.11" }, name: "显示开关测试", display_index: 0, user_id: 1, uuid: "fixture", public_note: JSON.stringify(original), note: "", enable_ddns: false, hide_for_guest: false };
  const updates: any[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname; let data: any = [];
    if (path === "/api/v1/profile") data = { id: 1, username: "admin", role: 0 };
    if (path === "/api/v1/setting") data = { config: { site_name: "测试", language: "zh-CN" } };
    if (path === "/api/v1/server") data = [server];
    if (path === "/api/v1/server/11" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON(); updates.push(body); server = { ...server, ...body };
    }
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto("http://127.0.0.1:18611/dashboard/");
  const edit = page.getByRole("row").filter({ hasText: "显示开关测试" }).getByRole("button", { name: "编辑服务器", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog").first();
  const price = page.getByRole("switch", { name: "显示金额", exact: true });
  const expiry = page.getByRole("switch", { name: "显示剩余天数", exact: true });
  await expect(price).toBeChecked(); await expect(expiry).toBeChecked();
  await price.scrollIntoViewIfNeeded();
  for (const flag of ["showPrice", "showExpiry"]) {
    const control = dialog.locator('[data-billing-visibility="' + flag + '"]');
    expect(await control.evaluate(el => {
      const r = el.getBoundingClientRect(), row = el.parentElement!, a = row.firstElementChild!.getBoundingClientRect(), p = row.getBoundingClientRect();
      return r.right <= innerWidth && r.left >= 0 && r.bottom <= p.bottom + 1 && Math.abs(r.top + r.height / 2 - a.top - a.height / 2) < 3 && row.scrollWidth <= row.clientWidth + 1 && a.height < 20;
    })).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("billing-controls.png") });
  await price.click(); await expect(expiry).toBeChecked();
  await dialog.locator('button[type="submit"]').click(); await expect.poll(() => updates.length).toBe(1);
  expect(JSON.parse(updates[0].public_note)).toMatchObject({ ...original, billingDataMod: { ...original.billingDataMod, showPrice: "0" } });
  await edit.click(); await expect(price).not.toBeChecked(); await expect(expiry).toBeChecked();
  await expiry.click(); await price.click();
  await dialog.getByRole("button", { name: "原始文本", exact: true }).click();
  const raw = dialog.getByRole("textbox", { name: "公开备注原始文本" });
  expect(JSON.parse(await raw.inputValue()).账单信息).toMatchObject({ 显示金额: true, 显示剩余天数: false });
  await dialog.getByRole("button", { name: "自定义字段", exact: true }).click();
  await dialog.locator('button[type="submit"]').click(); await expect.poll(() => updates.length).toBe(2);
  await page.reload(); await edit.click();
  await expect(price).toBeChecked(); await expect(expiry).not.toBeChecked();
  expect(JSON.parse(server.public_note)).toMatchObject({ ...original, billingDataMod: { ...original.billingDataMod, showPrice: "1", showExpiry: "0" } });
  expect(errors).toEqual([]);
});

for (const [theme, port] of [["default", 18612], ["paper", 18613], ["doraemon", 18614]] as const)
for (const width of [390, 1440]) test("billing visibility live across " + theme + " " + width, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript(() => { localStorage.setItem("language", "zh-CN"); localStorage.setItem("inline", "0"); localStorage.setItem("showMap", "0"); localStorage.setItem("showServices", "0"); });
  const now = Date.now(), sockets: any[] = [], errors: string[] = [];
  let seq = 0;
  const servers = ["0", "-1", "31USD"].map((amount, i) => createServer({ id: i + 1, name: ["免费节点", "按量节点", "付费节点"][i], last_active: new Date(now).toISOString(), public_note: JSON.stringify({ billingDataMod: { amount, cycle: "Month", startDate: new Date(now - 86400000).toISOString(), endDate: new Date(now + 20 * 86400000).toISOString(), autoRenewal: "0" } }) }));
  const tick = () => sockets.forEach(ws => ws.send(JSON.stringify({ now: now + ++seq * 3000, online: 3, servers })));
  page.on("pageerror", e => errors.push(e.message));
  await page.routeWebSocket("**/api/v1/ws/server", ws => { sockets.push(ws); tick(); });
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname; let data: any = [];
    if (path === "/api/v1/setting") data = { config: { site_name: "显示验证", language: "zh-CN", user_template: theme === "default" ? "user-dist" : theme + "-dist" } };
    if (path.includes("/service")) data = { services: {}, cycle_transfer_stats: {} };
    if (path === "/api/v1/server-traffic") data = {};
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto("http://127.0.0.1:" + port + "/");
  const cards = page.locator(theme === "doraemon" ? "[data-dora-card]" : "[data-server-card]");
  await expect(cards).toHaveCount(3);
  for (const [showPrice, showExpiry] of [["1", "1"], ["0", "1"], ["1", "0"], ["0", "0"], ["1", "1"]]) {
    servers[0].public_note = JSON.stringify({ ...JSON.parse(servers[0].public_note), billingDataMod: { ...JSON.parse(servers[0].public_note).billingDataMod, showPrice, showExpiry } });
    tick();
    const first = cards.filter({ hasText: "免费节点" });
    if (showPrice === "1") await expect(first.locator("[data-billing-price]:visible")).toHaveCount(1);
    else await expect(first.locator("[data-billing-price]")).toHaveCount(0);
    if (showExpiry === "1") await expect(first.locator("[data-billing-expiry]:visible")).toHaveCount(1);
    else {
      await expect(first.locator("[data-billing-expiry]")).toHaveCount(0);
      await expect(first.locator("[data-expiry-progress]")).toHaveCount(0);
    }
    await expect(cards.filter({ hasText: "付费节点" }).locator("[data-billing-price]:visible")).toContainText("31USD");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("billing-" + theme + ".png"), fullPage: true });
  expect(errors).toEqual([]);
});
