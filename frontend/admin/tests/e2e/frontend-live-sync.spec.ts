import {test, expect, type Page, type WebSocketRoute} from "@playwright/test";
import {createServer} from "../../../user/src/test/fixtures";

async function setup(page: Page, variant: string, color = "light") {
 const origin = process.env[variant === "default" ? "NIC_USER_URL" : "NIC_DORAEMON_URL"]!;
 await page.clock.install();
 await page.addInitScript(({color}) => {
  localStorage.setItem("language", "zh-CN");
  localStorage.setItem("vite-ui-theme", color);
  localStorage.setItem("doraemon-sky", color);
  localStorage.setItem("inline", "0");
  localStorage.setItem("doraemon:inline", "0");
  sessionStorage.setItem("server_8_public_note", JSON.stringify({planDataMod: {extra: "旧会话标签"}}));
 }, {color});
 const note = (amount: string, bandwidth: string, extra: string) => JSON.stringify({
  billingDataMod: {amount, cycle: "Month", endDate: "2099-11-25T00:00:00+08:00"},
  planDataMod: {bandwidth, trafficVol: "2TB/月", extra},
 });
 const state = {
  servers: [
   createServer({id: 7, name: "同步测试甲", public_note: note("12USD", "1Gbps", "原始标签")}),
   createServer({id: 8, name: "同步测试乙"}),
  ],
  groups: [{group: {id: 1, name: "测试分组"}, servers: [7, 8]}],
  groupRequests: 0,
  sockets: [] as WebSocketRoute[],
  documents: 0,
  note,
 };
 page.on("request", request => {if (request.resourceType() === "document") state.documents++;});
 const send = (ws: WebSocketRoute, complete: boolean) => {
  const now = Date.now();
  ws.send(JSON.stringify({
   now, online: 1,
   ...(complete ? {public_note_complete: true} : {}),
   servers: state.servers.map(server => {
    const {public_note, ...rest} = server;
    return {...rest, last_active: new Date(now).toISOString(),
     ...(complete && public_note ? {public_note} : {})};
   }),
  }));
 };
 const tick = (complete = true) => send(state.sockets[state.sockets.length - 1], complete);
 await page.routeWebSocket("**/api/v1/ws/server", ws => {
  state.sockets.push(ws);
  send(ws, true);
 });
 await page.route("**/*", async route => {
  const u = new URL(route.request().url());
  if (u.origin !== origin) return route.abort();
  if (!u.pathname.startsWith("/api/")) return route.continue();
  let data: any = [];
  if (u.pathname === "/api/v1/profile") return route.fulfill({json: {error: "ApiErrorUnauthorized"}});
  if (u.pathname === "/api/v1/setting") data = {config: {
   language: "zh-CN", site_name: "实时同步测试", custom_code: "",
   appearance_config: '{"version":1,"enabled":false,"features":{}}',
   doraemon_appearance_config: '{"version":1,"enabled":false,"features":{}}',
  }};
  else if (u.pathname === "/api/v1/service") data = {services: {}, cycle_transfer_stats: {}};
  else if (u.pathname === "/api/v1/server-group") {
   state.groupRequests++;
   data = state.groups;
  }
  return route.fulfill({json: {success: true, data}});
 });
 await page.goto(origin + "/");
 await expect(page.getByText("同步测试甲", {exact: true}).first()).toBeVisible();
 return {state, tick};
}

const cards = (page: Page) => page.locator("[data-server-card], [data-dora-card]");

for (const variant of ["default", "doraemon"]) for (const width of [390, 1440]) for (const color of ["light", "dark"]) {
 test(`edits clears deletes and re-adds without reload ${variant} ${width} ${color}`, async ({page}, info) => {
  await page.setViewportSize({width, height: 900});
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const {state, tick} = await setup(page, variant, color);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page)).not.toContainText(["旧会话标签", "旧会话标签"]);
  await page.getByRole("button", {name: "Sort metric"}).click();
  await page.getByRole("menuitemradio", {name: "CPU", exact: true}).click();
  const count = state.sockets.length;
  const group = page.locator("[data-group-switch]");
  await group.getByRole("button", {name: "测试分组", exact: true}).click();
  await expect(group.getByRole("button", {name: "测试分组", exact: true})).toHaveAttribute("aria-pressed", "true");

  state.servers[1].state.cpu = 23;
  state.servers[0].name = "同步修改甲";
  state.servers[0].public_note = state.note("29USD", "2Gbps", "Changed标签");
  tick();
  const updated = cards(page).filter({hasText: "同步修改甲"});
  await expect(updated).toContainText("2Gbps");
  await expect(updated).toContainText("Changed标签");
  await expect(updated).toContainText("29");
  await expect(page.getByRole("button", {name: "Sort metric"})).toHaveText("CPU");
  await expect(cards(page).first()).toContainText("同步测试乙");
  await expect(page.getByText("同步测试甲", {exact: true})).toHaveCount(0);
  await expect(page.getByText("原始标签", {exact: true})).toHaveCount(0);
  tick(false);
  await expect(updated).toContainText("Changed标签");
  await expect(group.getByRole("button", {name: "测试分组", exact: true})).toHaveAttribute("aria-pressed", "true");

  state.servers[0].public_note = "";
  tick();
  await expect(updated).not.toContainText("Changed标签");
  await expect(updated).not.toContainText("2Gbps");
  await expect(updated).not.toContainText("29");
  state.servers = [state.servers[1]];
  tick();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByText("同步修改甲", {exact: true})).toHaveCount(0);
  state.servers = [];
  tick();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator(".server-empty-state")).toBeVisible();
  state.servers = [createServer({id: 7, name: "重用编号新机器"})];
  tick();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText("重用编号新机器");
  await expect(cards(page)).not.toContainText("Changed标签");
  expect(state.sockets).toHaveLength(count);
  expect(state.documents).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path: info.outputPath("live-synchronized.png")});
  expect(errors).toEqual([]);
 });
}

for (const variant of ["default", "doraemon"]) for (const width of [390, 1440]) {
 test(`group edits and removal refresh automatically ${variant} ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const {state, tick} = await setup(page, variant);
  const group = page.locator("[data-group-switch]");
  await group.getByRole("button", {name: "测试分组", exact: true}).click();
  await expect(cards(page)).toHaveCount(2);
  const requests = state.groupRequests;
  state.groups[0].servers = [8];
  tick(false);
  await page.clock.fastForward(11000);
  await expect.poll(() => state.groupRequests).toBeGreaterThan(requests);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText("同步测试乙");
  await expect(group.getByRole("button", {name: "测试分组", exact: true})).toHaveAttribute("aria-pressed", "true");
  state.groups = [{group: {id: 1, name: "重命名分组"}, servers: [8]}];
  tick(false);
  await page.clock.fastForward(11000);
  await expect(group.getByRole("button", {name: "重命名分组", exact: true})).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await group.getByRole("button", {name: "重命名分组", exact: true}).click();
  await expect(cards(page)).toHaveCount(1);
  state.groups = [];
  tick(false);
  await page.clock.fastForward(11000);
  await expect(group).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
  expect(state.documents).toBe(1);
 });

 test(`silent open connection recovers without reload ${variant} ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const {state} = await setup(page, variant);
  const count = state.sockets.length;
  state.servers = [createServer({id: 8, name: "恢复后最新机器"})];
  // No close/error event: the OPEN socket stops delivering snapshots.
  await page.clock.fastForward(16000);
  await expect(cards(page)).toHaveCount(2);
  await page.clock.fastForward(3500);
  await expect.poll(() => state.sockets.length).toBe(count + 1);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText("恢复后最新机器");
  await expect(page.getByText("同步测试甲", {exact: true})).toHaveCount(0);
  expect(state.documents).toBe(1);
 });
}
