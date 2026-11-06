import { cancelSessionRenewal, startSessionRenewal, renewSessionIfNeeded, readCookie, SESSION_EXPIRED_EVENT } from "@/api/session-renewal"
import { getProfile, login as loginRequest } from "@/api/user"
import { AuthContextProps } from "@/types"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { useMainStore } from "./useMainStore"

const AuthContext = createContext<AuthContextProps>({
    profile: undefined,
    loading: true,
    login: async () => {},
    loginOauth2: () => {},
    logout: () => {},
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
                    authEpoch.current++
                    cancelSessionRenewal()
                    // Commit the login route before the auth guard observes the cleared profile.
                    navigate("/dashboard/login?reason=expired", { replace: true, flushSync: true })
                    setProfile(undefined)
                }
            } finally { checking = false }
        }
        const onExpired = () => { void checkExpired() }
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
        return () => { active = false; window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired) }
    }, [profile?.id, loading, navigate, setProfile])

    useEffect(() => {
        if (!loading && profile) return startSessionRenewal()
    }, [loading, profile?.id])

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

    const logout = useCallback(() => {
        cancelSessionRenewal()
        authEpoch.current++
        document.cookie.split(";").forEach(function (c) {
            document.cookie = c
                .replace(/^ +/, "")
                .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/")
        })
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
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
    return useContext(AuthContext)
}
