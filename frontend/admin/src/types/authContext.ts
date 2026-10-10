import { ModelProfile } from "@/types"

export interface AuthContextProps {
    profile: ModelProfile | undefined
    loading: boolean
    login: (username: string, password: string, code?: string) => Promise<"totp-required" | void>
    loginOauth2: () => void
    logout: () => void
}
