import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { fetcher, FetcherMethod } from "@/api/api"
import { SESSION_EXPIRED_EVENT, cancelSessionRenewal } from "@/api/session-renewal"
let cookies = ""
const expired = vi.fn()
beforeEach(() => {
 cookies = "nz-jwt=fixture"
 Object.defineProperty(document, "cookie", { configurable: true, get: () => cookies })
 vi.stubGlobal("fetch", vi.fn())
 expired.mockClear()
 window.addEventListener(SESSION_EXPIRED_EVENT, expired)
})
afterEach(() => {
 window.removeEventListener(SESSION_EXPIRED_EVENT, expired)
 cancelSessionRenewal(); vi.unstubAllGlobals()
})
test.each([200, 401])("signals explicit auth failure with HTTP %s (even with empty statusText)", async status => {
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: false, error: "ApiErrorUnauthorized" }), { status }))
 await expect(fetcher(FetcherMethod.GET, "/api/v1/server")).rejects.toThrow("ApiErrorUnauthorized")
 expect(expired).toHaveBeenCalledTimes(1)
})
test.each(["/api/v1/login", "https://other.example/api/v1/server"])("does not invalidate the session for %s", async path => {
 vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 401 }))
 await expect(fetcher(FetcherMethod.POST, path)).rejects.toThrow()
 expect(expired).not.toHaveBeenCalled()
})
test.each([403, 503])("HTTP %s with an unauthorized text remains a non-auth failure", async status => {
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: false, error: "ApiErrorUnauthorized" }), { status }))
 await expect(fetcher(FetcherMethod.GET, "/api/v1/server")).rejects.toThrow()
 expect(expired).not.toHaveBeenCalled()
})
test("ignores unauthorized replies for a replaced cookie", async () => {
 vi.mocked(fetch).mockImplementation(async () => {
  cookies = "nz-jwt=new-login"
  return new Response("{}", { status: 401 })
 })
 await expect(fetcher(FetcherMethod.GET, "/api/v1/server")).rejects.toThrow()
 expect(expired).not.toHaveBeenCalled()
})


test.each(["/dashboard", "/dashboard/", "/dashboard/service"])("backend gate expiry is handled on %s", async path => {
 window.history.replaceState({}, "", path)
 vi.mocked(fetch).mockResolvedValue(new Response("", { status: 403, headers: { "X-Nezha-Backend-Access": "required" } }))
 await expect(fetcher(FetcherMethod.GET, "/api/v1/server")).rejects.toThrow("登录已过期，请重新登录")
 expect(expired).toHaveBeenCalledTimes(1)
 expect(expired.mock.calls[0][0].detail).toEqual({ token: "fixture", backendAccess: "required" })
})
test("HTTP/2 forbidden responses have a useful message without logging out", async () => {
 vi.mocked(fetch).mockResolvedValue(new Response("", { status: 403 }))
 await expect(fetcher(FetcherMethod.GET, "/api/v1/server")).rejects.toThrow("没有访问权限")
 expect(expired).not.toHaveBeenCalled()
})
