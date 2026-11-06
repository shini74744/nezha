import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fetchLoginUser } from "@/lib/nezha-api";
import { cancelSessionRenewal, renewSessionIfNeeded, SESSION_EXPIRED_EVENT } from "../../../shared/session-renewal";

let cookie = "";
let visible = true;
let expires = 0;
let renewals = 0;
let failing = false;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
 vi.useFakeTimers();
 vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
 cancelSessionRenewal();
 expires = Date.now() + 3_600_000; renewals = 0; failing = false; visible = true;
 cookie = "nz-jwt=fixture; nz-csrf=csrf";
 Object.defineProperty(document, "cookie", { configurable: true, get: () => cookie });
 vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
 vi.stubGlobal("fetch", vi.fn(async (input) => {
  if (String(input).includes("refresh-token")) {
   renewals++;
   if (failing) return json({ success: false, error: "ApiErrorUnauthorized" }, 503);
   if (Date.now() >= expires) return json({ success: false, error: "ApiErrorUnauthorized" });
   expires = Date.now() + 3_600_000;
   return json({ success: true });
  }
  return Date.now() < expires ? json({ success: true, data: { id: 1, role: 0 } })
   : json({ success: false, error: "ApiErrorUnauthorized" });
 }));
});
afterEach(() => {
 cancelSessionRenewal(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test.each(["readable", "HttpOnly"])("public profile polling keeps %s session valid for three hours", async kind => {
 if (kind === "HttpOnly") cookie = "nz-csrf=csrf";
 for (let i = 0; i <= 360; i++) {
  expect((await fetchLoginUser())?.data?.id).toBe(1);
  await vi.advanceTimersByTimeAsync(30_000);
 }
 expect(renewals).toBe(37);
});

test("failed renewal retries within 30 seconds and 503 cannot emit an expiry", async () => {
 const expired = vi.fn();
 window.addEventListener(SESSION_EXPIRED_EVENT, expired);
 try {
  failing = true;
  expect((await fetchLoginUser())?.data?.id).toBe(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(renewals).toBe(1); expect(expired).not.toHaveBeenCalled();
  failing = false;
  await vi.advanceTimersByTimeAsync(30_000);
  await fetchLoginUser(); await vi.advanceTimersByTimeAsync(0);
  expect(renewals).toBe(2);
 } finally { window.removeEventListener(SESSION_EXPIRED_EVENT, expired); }
});

test("CSRF cookie seeded later does not postpone the first renewal", async () => {
 cookie = "nz-jwt=fixture";
 await fetchLoginUser(); expect(renewals).toBe(0);
 cookie += "; nz-csrf=csrf";
 await fetchLoginUser(); expect(renewals).toBe(1);
});

test("hidden pages do not extend expiry and a later profile returns logged out", async () => {
 visible = false;
 await fetchLoginUser(); expect(renewals).toBe(0);
 await vi.advanceTimersByTimeAsync(3_600_001);
 visible = true;
 expect(await fetchLoginUser()).toBeNull();
 expect(renewals).toBe(0);
});


test("a new authenticated HttpOnly login for the same user resumes renewal", async () => {
 cookie = "nz-csrf=csrf";
 expires = 0;
 await renewSessionIfNeeded(1);
 expect(renewals).toBe(1);
 expires = Date.now() + 3_600_000;
 await vi.advanceTimersByTimeAsync(30_000);
 await fetchLoginUser(); await vi.advanceTimersByTimeAsync(0);
 expect(renewals).toBe(2);
});
