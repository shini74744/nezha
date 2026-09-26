import { swrFetcher } from "@/api/api"
import { useAuth } from "@/hooks/useAuth"
import { ModelSettingResponse } from "@/types"
import useSWR from "swr"

export default function useSetting() {
    const { profile, loading } = useAuth()
    // Guest settings omit admin-only fields. Never reuse that cache after login,
    // or expose a previous user's settings after logout/account changes.
    const key = loading ? null : ["/api/v1/setting", profile?.id ?? "guest", profile?.role ?? "guest"] as const
    return useSWR<ModelSettingResponse>(key, ([url]) => swrFetcher<ModelSettingResponse>(url))
}
