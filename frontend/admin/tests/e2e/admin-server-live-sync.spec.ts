import {test, expect, type Page} from "@playwright/test";

async function setup(page: Page, width: number, theme: string) {
 await page.setViewportSize({width, height: 900});
 await page.addInitScript(theme => localStorage.setItem("nezha-dashboard-theme", theme), theme);
 const node = (id: number, name: string) => ({
  id, name, uuid: "fixture-" + id, display_index: id, user_id: 1, host: {version: "1.0.9"},
  public_note: "", note: "原备注", hide_for_guest: false, hide_for_display: false,
 });
 const state = {servers: [node(7, "原机器甲"), node(8, "原机器乙")], count: 0, fail: false, documents: 0, writes: [] as string[], node};
 page.on("request", request => {if (request.resourceType() === "document") state.documents++;});
 await page.route("**/api/v1/**", async route => {
  const path = new URL(route.request().url()).pathname;
  let data: any = [];
  if (path === "/api/v1/profile") data = {id: 1, username: "admin", role: 0};
  if (path === "/api/v1/setting") data = {config: {language: "zh-CN"}, version: "test"};
  if (path === "/api/v1/server") {
   state.count++;
   if (state.fail) return route.fulfill({status: 503, json: {success: false, error: "temporary"}});
   data = state.servers;
  }
  if (path === "/api/v1/server/nic-change-reminders") data = {};
  if (route.request().method() !== "GET" && path !== "/api/v1/refresh-token") state.writes.push(path);
  await route.fulfill({json: {success: true, data}});
 });
 await page.goto("/dashboard");
 await expect(row(page, 7)).toBeVisible();
 return state;
}
const rows = (page: Page) => page.locator(".server-list-table tbody tr");
const row = (page: Page, id: number) => rows(page).filter({
 has: page.locator('td[data-column="id"]').filter({hasText: new RegExp("^" + id + "$")}),
});
const tick = async (page: Page, state: {count: number}) => {
 const before = state.count;
 await expect.poll(() => state.count, {timeout: 12000}).toBeGreaterThan(before);
};

for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
 test(`new machines refresh while selections and unsaved edits stay on the right ID ${width} ${theme}`, async ({page}, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const state = await setup(page, width, theme);
  await row(page, 8).getByRole("checkbox", {includeHidden: true}).check();
  await row(page, 8).getByRole("button", {name: "编辑服务器", exact: true}).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.locator('input[name="name"]');
  await expect(input).toHaveValue("原机器乙");
  await input.fill("尚未提交的名称");
  state.servers = [state.node(9, "刚上线的新机器"), state.servers[0], {...state.servers[1], name: "后台外部修改乙"}];
  await tick(page, state);
  await expect(row(page, 9)).toHaveCount(1);
  await expect(row(page, 8)).toContainText("后台外部修改乙");
  await expect(input).toHaveValue("尚未提交的名称");
  await expect(row(page, 8).getByRole("checkbox", {includeHidden: true})).toBeChecked();
  await expect(row(page, 7).getByRole("checkbox", {includeHidden: true})).not.toBeChecked();
  await expect(row(page, 9).getByRole("checkbox", {includeHidden: true})).not.toBeChecked();
  await dialog.getByRole("button", {name: "Close", exact: true}).click();
  await row(page, 8).getByRole("button", {name: "编辑服务器", exact: true}).click();
  await expect(input).toHaveValue("后台外部修改乙");
  await dialog.getByRole("button", {name: "Close", exact: true}).click();
  state.servers = state.servers.filter(s => s.id !== 8);
  await tick(page, state);
  await expect(row(page, 8)).toHaveCount(0);
  await expect(page.locator('.server-list-table tbody button[role="checkbox"][data-state="checked"]')).toHaveCount(0);
  state.servers = [...state.servers, state.node(8, "同编号替换机器")];
  await tick(page, state);
  await expect(row(page, 8)).toContainText("同编号替换机器");
  await expect(row(page, 8).getByRole("checkbox", {includeHidden: true})).not.toBeChecked();
  expect(state.documents).toBe(1);
  expect(state.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path: info.outputPath("admin-live-list.png")});
  expect(errors).toEqual([]);
 });
}

for (const width of [390, 1440]) test("temporary failure retains rows and online event recovers " + width, async ({page}) => {
 const state = await setup(page, width, "light");
 await row(page, 8).getByRole("checkbox", {includeHidden: true}).check();
 state.fail = true;
 await tick(page, state);
 await expect(row(page, 7)).toBeVisible();
 await expect(row(page, 8).getByRole("checkbox", {includeHidden: true})).toBeChecked();
 state.fail = false;
 state.servers = [state.node(7, "恢复后的最新名称"), state.node(8, "原机器乙"), state.node(9, "恢复时新机器")];
 await page.evaluate(() => window.dispatchEvent(new Event("online")));
 await expect(row(page, 9)).toContainText("恢复时新机器", {timeout: 15000});
 await expect(row(page, 7)).toContainText("恢复后的最新名称");
 await expect(row(page, 8).getByRole("checkbox", {includeHidden: true})).toBeChecked();
 expect(state.documents).toBe(1);
 expect(state.writes).toEqual([]);
});
