import {test, expect} from "@playwright/test";

for (const width of [320, 390, 1440]) test("offline server IP remains visible and refreshes " + width, async ({page}, info) => {
  await page.setViewportSize({width, height:900});
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors:string[] = [], writes:string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const ipv6 = "2001:db8:1234:5678:abcd:ef01:2345:6789";
  const rows = [
    {id:82,name:"离线双栈节点",uuid:"offline-dual",geoip:{ip:{ipv4_addr:"192.0.2.82",ipv6_addr:ipv6}}},
    {id:83,name:"离线 IPv6 节点",uuid:"offline-v6",geoip:{ip:{ipv6_addr:"2001:db8::83"}}},
    {id:84,name:"从未上报节点",uuid:"never",geoip:{ip:{}}},
  ].map(s => ({...s,host:{},state:{},last_active:"0001-01-01T00:00:00Z",owner:{id:1,username:"admin"},display_index:0,hide_for_guest:false,enable_ddns:false}));
  await page.route("**/api/v1/**", route => {
    const p = new URL(route.request().url()).pathname;
    if(route.request().method() !== "GET") writes.push(p);
    const data = p === "/api/v1/profile" ? {id:1,username:"admin",role:0} : p === "/api/v1/setting" ? {config:{language:"zh-CN"}} : p === "/api/v1/server" ? rows : [];
    return route.fulfill({json:{success:true,data}});
  });
  await page.goto("/dashboard/");
  const row = page.getByRole("row").filter({hasText:"离线双栈节点"});
  await expect(row).toContainText("192.0.2.82/" + ipv6);
  const sameHeightAsPlainText = await row.locator('[data-column="ip"] .server-text').evaluate(cell => {
    const original = cell.cloneNode(false) as HTMLElement;
    original.textContent = cell.textContent;
    cell.after(original);
    const sameHeight = cell.getBoundingClientRect().height === original.getBoundingClientRect().height;
    original.remove();
    return sameHeight;
  });
  expect(sameHeightAsPlainText).toBe(true);
  const ipButton = (address:string) => page.getByRole("button").and(page.getByText(address, {exact:true}));
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await ipButton("192.0.2.82").click();
  await expect.poll(clipboard).toBe("192.0.2.82");
  await ipButton(ipv6).click();
  await expect.poll(clipboard).toBe(ipv6);
  await ipButton("2001:db8::83").press("Enter");
  await expect.poll(clipboard).toBe("2001:db8::83");
  await expect(page.getByRole("row").filter({hasText:"从未上报节点"}).locator('[data-column="ip"] [role="button"]')).toHaveCount(0);
  await expect(page.getByRole("row").filter({hasText:"离线 IPv6 节点"})).toContainText("2001:db8::83");
  await expect(page.getByRole("row").filter({hasText:"从未上报节点"})).not.toContainText("192.0.2.");
  await page.reload();
  await expect(row).toContainText("192.0.2.82/" + ipv6);
  rows[0].geoip.ip = {ipv4_addr:"198.51.100.82",ipv6_addr:""};
  await expect(row).toContainText("198.51.100.82", {timeout:12000});
  await expect(row).not.toContainText(ipv6);
  await expect(row).not.toContainText("192.0.2.82");
  await ipButton("198.51.100.82").click();
  await expect.poll(clipboard).toBe("198.51.100.82");
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path:info.outputPath("offline-ip.png"),fullPage:true});
});
