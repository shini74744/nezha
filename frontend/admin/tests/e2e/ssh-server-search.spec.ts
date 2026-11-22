import { test, expect } from "@playwright/test";

for (const width of [320, 390, 1440]) test("SSH server search by name ID IPv4 IPv6 " + width, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => localStorage.setItem("language", "zh-CN"));
  const policy = { enabled:false,success:false,failure:false,notification_group_id:0,ports:[22],auto_ban:false,whitelist_only:false,max_retry:3,find_time:86400,ban_time:-1,allowlist:[],block_ips:[],revision:1 };
  const rows: any[] = [
    { id:21,name:"香港测试节点",ip:{ipv4_addr:"192.0.2.18",ipv6_addr:"2001:db8:abcd::18"},policy,status:{updated_at:0,revision:1} },
    { id:32,name:"Tokyo Node",ip:{ipv6_addr:"2001:db8:ffff::32"},policy,status:{updated_at:0,revision:1} },
    { id:43,name:"从未上报地址",policy,status:{updated_at:0,revision:1} }
  ];
  const writes: string[] = [], errors: string[] = [];
  let reads = 0;
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/v1/**", route => {
    const p = new URL(route.request().url()).pathname;
    if(route.request().method() !== "GET") writes.push(p);
    if(p === "/api/v1/ssh-login") reads++;
    const data = p === "/api/v1/profile" ? {id:1,username:"admin",role:0} : p === "/api/v1/setting" ? {config:{language:"zh-CN"}} : p === "/api/v1/ssh-login" ? rows : [];
    return route.fulfill({json:{success:true,data}});
  });
  await page.goto("/dashboard/ssh-login");
  const search = page.getByRole("textbox", {name:"搜索服务器",exact:true});
  const list = page.getByLabel("SSH 服务器列表", {exact:true});
  await expect(list.getByRole("button")).toHaveCount(3);
  await expect(search).toHaveAttribute("placeholder", "搜索名称、ID 或 IP");
  for (const [query, expected] of [
    ["香港", "香港测试节点"], ["tOkYo", "Tokyo Node"], ["43", "从未上报地址"],
    ["192.0.2.18", "香港测试节点"], [" 192.0.2. ", "香港测试节点"],
    ["2001:DB8:ABCD::18", "香港测试节点"], ["FFFF::", "Tokyo Node"]
  ]) {
    await search.fill(query);
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list.getByRole("button")).toContainText(expected);
  }
  await search.fill("203.0.113.99");
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list).toContainText("没有符合条件的服务器");
  await search.fill("192.0.2.18");
  await list.getByRole("button").click();
  await expect(page.getByRole("heading",{name:"香港测试节点",exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox",{name:"启用 SSH 监测",exact:true})).not.toBeChecked();
  rows[0].ip = {ipv4_addr:"198.51.100.88",ipv6_addr:"2001:db8::88"};
  const before = reads;
  await page.getByRole("button",{name:"刷新",exact:true}).click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(list.getByRole("button")).toHaveCount(0);
  await search.fill("198.51.100.");
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await search.fill("   ");
  await expect(list.getByRole("button")).toHaveCount(3);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path:info.outputPath("ssh-ip-search.png"),fullPage:true});
});
