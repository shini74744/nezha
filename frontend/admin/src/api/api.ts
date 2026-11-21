import { readCookie, renewSessionIfNeeded, notifySessionExpired } from "./session-renewal"
import { isTelegramTerminal, telegramUIRequest } from "@/lib/terminal-transport"

interface CommonResponse<T> {
    success: boolean
    error: string
    data: T
}

function buildUrl(path: string, data?: any): string {
    if (!data) return path
    const url = new URL(window.location.origin + path)
    for (const key in data) {
        url.searchParams.append(key, data[key])
    }
    return url.toString()
}

export enum FetcherMethod {
    GET = "GET",
    POST = "POST",
    PUT = "PUT",
    PATCH = "PATCH",
    DELETE = "DELETE",
}

const csrfCookieName = "nz-csrf"
const csrfHeaderName = "X-CSRF-Token"

function isUnsafeMethod(method: FetcherMethod): boolean {
    return method !== FetcherMethod.GET
}

// Only attach the CSRF token to same-origin requests. Keying on HTTP method
// alone would leak the nz-csrf value to any absolute cross-origin URL a caller
// passes in; the double-submit token is meaningful only to our own backend.
function isSameOrigin(path: string): boolean {
    try {
        return new URL(path, window.location.origin).origin === window.location.origin
    } catch {
        return false
    }
}

// Double-submit CSRF: backend requires X-CSRF-Token == nz-csrf cookie on
// cookie-authenticated unsafe methods.
function csrfHeaders(method: FetcherMethod, path: string): Record<string, string> {
    if (!isUnsafeMethod(method)) return {}
    if (!isSameOrigin(path)) return {}
    const token = readCookie(csrfCookieName)
    return token ? { [csrfHeaderName]: token } : {}
}

export async function fetcher<T>(method: FetcherMethod, path: string, data?: any, signal?: AbortSignal): Promise<T> {
    if (isTelegramTerminal()) return telegramUIRequest<T>(method, path, data)
    const requestToken = readCookie("nz-jwt")
    const notifyExpired = (backendAccess?: "required" | "blocked") => {
        if (isSameOrigin(path) && new URL(path, window.location.origin).pathname !== "/api/v1/login" && readCookie("nz-jwt") === requestToken) notifySessionExpired({ token: requestToken, backendAccess })
    }
    let response
    if (method === FetcherMethod.GET || method === FetcherMethod.DELETE) {
        response = await fetch(buildUrl(path, data), {
            method: method,
            signal,
            headers: csrfHeaders(method, path),
        })
    } else {
        response = await fetch(path, {
            method: method,
            signal,
            headers: {
                "Content-Type": "application/json",
                ...csrfHeaders(method, path),
            },
            body: data ? JSON.stringify(data) : null,
        })
    }
    if (!response.ok) {
        const access = response.headers.get("X-Nezha-Backend-Access")
        const inDashboard = window.location.pathname === "/dashboard" || window.location.pathname.startsWith("/dashboard/")
        if ((access === "required" || access === "blocked") && inDashboard) {
            notifyExpired(access)
            throw new Error(access === "blocked" ? "后台访问暂时受限，请重新验证。" : "登录已过期，请重新登录。")
        }
        if (response.status === 401) notifyExpired()
        // HTTP/2 responses may have no statusText. Never display an empty error.
        throw new Error(response.status === 401 ? "ApiErrorUnauthorized" :
            response.status === 403 ? "没有访问权限，请检查账号权限。" : response.statusText || "请求失败（HTTP " + response.status + "），请稍后重试。")
    }
    const text = await response.text()
    if (text !== "") {
        let responseData: CommonResponse<T>
        try {
            responseData = JSON.parse(text)
        } catch {
            throw new Error("invalid server response")
        }
        if (!responseData.success) {
            if (response.status === 200 && responseData.error === "ApiErrorUnauthorized") notifyExpired()
            throw new Error(responseData.error)
        }
        if (isSameOrigin(path) && path !== "/api/v1/logout") void renewSessionIfNeeded()
        return responseData.data
    }
    if (isSameOrigin(path) && path !== "/api/v1/logout") void renewSessionIfNeeded()
    return undefined as T
}

export async function swrFetcher<T>(input: string | URL | globalThis.Request, init?: RequestInit) {
    // SWR 默认不带 init，method 为 undefined：必须落到 GET，否则 fetcher 会走
    // 带 body 的分支并对只读请求附加 CSRF 头，把 token 暴露到 GET 请求上。
    const method = (init?.method as FetcherMethod) ?? FetcherMethod.GET
    return fetcher<T>(method, input.toString(), init?.body)
}
