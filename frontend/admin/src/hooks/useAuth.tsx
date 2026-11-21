import { cancelSessionRenewal, startSessionRenewal, renewSessionIfNeeded, readCookie, SESSION_EXPIRED_EVENT, type SessionExpiry } from "@/api/session-renewal"
import { getProfile, login as loginRequest, logout as logoutRequest } from "@/api/user"
import { AuthContextProps } from "@/types"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { flushSync } from "react-dom"
import { SWRConfig } from "swr"

import { useMainStore } from "./useMainStore"

const AuthContext = createContext<AuthContextProps>({
    profile: undefined,
    loading: true,
    login: async () => {},
    loginOauth2: () => {},
    logout: async () => {},
})

// Admin is role 0 on the backend. A missing/non-numeric role must never
// collapse to 0, or a malformed profile response would be treated as admin
// client-side; default unknown roles to a non-admin value instead.
const NON_ADMIN_ROLE = 1
function normalizeRole(role: unknown): number {
    return typeof role === "number" && Number.isFinite(role) ? role : NON_ADMIN_ROLE
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const profile = useMainStore((store) => store.profile)
    const setProfile = useMainStore((store) => store.setProfile)
    const [loading, setLoading] = useState(true)
    const { t } = useTranslation()

    // An explicit login/logout (or its getProfile) resolving while the initial
    // mount probe is still in flight must win: bump this so the stale probe's
    // result is discarded instead of clobbering the authenticated state.
    const authEpoch = useRef(0)
    const logoutPending = useRef(false)
    const [loggingOut, setLoggingOut] = useState(false)

    useEffect(() => {
        const epoch = authEpoch.current
        ;(async () => {
            try {
                const user = await getProfile()
                if (authEpoch.current !== epoch) return
                user.role = normalizeRole(user.role)
                setProfile(user)
            } catch {
                if (authEpoch.current !== epoch) return
                setProfile(undefined)
            } finally {
                setLoading(false)
            }
        })()
    }, [setProfile])

    const navigate = useNavigate()

    useEffect(() => {
        if (!profile || loading) return
        let active = true
        let checking = false
        const endSession = (backendAccess?: "required" | "blocked") => {
            if (!active) return
            active = false
            authEpoch.current++
            cancelSessionRenewal()
            if (!backendAccess) document.cookie = "nz-jwt=; Max-Age=0; Path=/; SameSite=Lax"
            const destination = "/dashboard/login" + (backendAccess === "blocked" ? "" : "?reason=expired")
            // Unmount protected views before the rejected request can render a stale-data toast.
            flushSync(() => {
                navigate(destination, { replace: true, flushSync: true })
                setProfile(undefined)
                setLoading(false)
            })
            toast.dismiss()
            // The access-password gate must be re-entered through the server, not the SPA.
            if (backendAccess) window.location.replace(destination)
        }
        const checkExpired = async () => {
            if (checking) return
            checking = true
            const epoch = authEpoch.current
            const token = readCookie("nz-jwt")
            try {
                // Confirm the current session before reacting to an old request or another tab.
                const current = await getProfile()
                if (active && authEpoch.current === epoch && readCookie("nz-jwt") === token) void renewSessionIfNeeded(current.id)
            } catch (error) {
                const message = error instanceof Error ? error.message : ""
                if (active && authEpoch.current === epoch && readCookie("nz-jwt") === token &&
                    (message === "ApiErrorUnauthorized" || message === "Unauthorized")) {
                    endSession()
                }
            } finally { checking = false }
        }
        const onExpired = (event: Event) => {
            const detail = (event as CustomEvent<SessionExpiry | undefined>).detail
            if (detail && detail.token === readCookie("nz-jwt")) {
                // A current request already confirmed expiry. A second profile probe
                // can hang, or succeed when only the separate backend gate expired.
                queueMicrotask(() => {
                    if (active && detail.token === readCookie("nz-jwt")) endSession(detail.backendAccess)
                })
            } else if (!detail) void checkExpired()
        }
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
        return () => { active = false; window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired) }
    }, [profile?.id, loading, navigate, setProfile])

    useEffect(() => {
        if (!loading && profile && !loggingOut) return startSessionRenewal()
    }, [loading, profile?.id, loggingOut])

    const login = useCallback(
        async (
            username: string,
            password: string,
            code?: string,
        ): Promise<"totp-required" | void> => {
            try {
                await loginRequest(username, password, code)
                const user = await getProfile()
                authEpoch.current++
                user.role = normalizeRole(user.role)
                setProfile(user)
                navigate("/dashboard")
            } catch (error: any) {
                const msg = error?.message
                if (msg === "ApiErrorTOTPRequired") return "totp-required"
                if (msg === "ApiErrorTOTPInvalid" || msg === "ApiErrorTOTPLimited") {
                    toast(
                        msg === "ApiErrorTOTPLimited"
                            ? "验证尝试过多，请 5 分钟后重试"
                            : "验证码或恢复码无效，已使用的验证码不能重复使用",
                    )
                    return "totp-required"
                }
                if (msg === "ApiErrorUnauthorized" || msg === "Unauthorized") {
                    toast(t("InvalidUsernameOrPassword"))
                } else {
                    toast(msg || t("NetworkError"))
                }
            } finally {
                // An explicit login resolves auth regardless of the still-pending
                // mount probe; clear loading so ProtectedRoute stops blanking.
                setLoading(false)
            }
        },
        [navigate, setProfile, t],
    )

    const loginOauth2 = useCallback(async () => {
        try {
            const user = await getProfile()
            authEpoch.current++
            user.role = normalizeRole(user.role)
            setProfile(user)
            navigate("/dashboard")
        } catch (error: any) {
            toast(error.message)
        } finally {
            setLoading(false)
            window.history.replaceState({}, document.title, window.location.pathname)
        }
    }, [navigate, setProfile])

    const logout = useCallback(async () => {
        if (logoutPending.current) return
        logoutPending.current = true
        setLoggingOut(true)
        cancelSessionRenewal()
        const epoch = ++authEpoch.current
        try {
            await logoutRequest()
        } catch (error) {
            const message = error instanceof Error ? error.message : ""
            // An already expired session also satisfies server-side logout.
            if (message !== "ApiErrorUnauthorized" && message !== "Unauthorized") {
                if (authEpoch.current === epoch) toast("退出登录失败，请重试。服务器尚未确认会话退出。")
                return
            }
        } finally {
            logoutPending.current = false
            setLoggingOut(false)
        }
        if (authEpoch.current !== epoch) return
        document.cookie = "nz-jwt=; Max-Age=0; Path=/; SameSite=Lax"
        setProfile(undefined)
        setLoading(false)
        navigate("/dashboard/login", { replace: true })
    }, [navigate, setProfile])

    const value = useMemo(
        () => ({
            profile,
            loading,
            login,
            loginOauth2,
            logout,
        }),
        [profile, loading, login, loginOauth2, logout],
    )
    // Isolate each login's SWR cache. Late responses from an expired login can
    // only update its abandoned cache, never the next user's session.
    const cache = useMemo(() => new Map(), [profile?.id])
    const swr = useMemo(() => ({ provider: () => cache }), [cache])
    return <AuthContext.Provider value={value}><SWRConfig key={profile?.id ?? "guest"} value={swr}>{children}</SWRConfig></AuthContext.Provider>
}

export const useAuth = () => {
    return useContext(AuthContext)
}
