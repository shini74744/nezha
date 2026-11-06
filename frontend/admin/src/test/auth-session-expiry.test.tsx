import { act, render, cleanup, waitFor } from "@testing-library/react"
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { AuthProvider, useAuth } from "@/hooks/useAuth"
import { useMainStore } from "@/hooks/useMainStore"
import { getProfile } from "@/api/user"
import { notifySessionExpired, cancelSessionRenewal } from "@/api/session-renewal"

vi.mock("@/api/user", () => ({ getProfile: vi.fn(), login: vi.fn(async () => {}) }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock("sonner", () => ({ toast: vi.fn() }))
const navigate = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }))
let auth: ReturnType<typeof useAuth>
function Capture() { auth = useAuth(); return <span>{auth.loading ? "loading" : auth.profile?.id ?? "guest"}</span> }
let cookies = ""
beforeEach(() => {
 cookies = "nz-jwt=fixture" // No CSRF: no renewal fetch is needed by these provider tests.
 Object.defineProperty(document, "cookie", { configurable: true, get: () => cookies })
 useMainStore.setState({ profile: undefined })
 vi.mocked(getProfile).mockReset().mockResolvedValue({ id: 1, role: 0 } as any)
 navigate.mockClear()
})
afterEach(() => { cleanup(); cancelSessionRenewal(); vi.restoreAllMocks() })
async function ready() {
 render(<AuthProvider><Capture /></AuthProvider>)
 await waitFor(() => expect(auth.profile?.id).toBe(1))
}
test.each(["ApiErrorUnauthorized", "Unauthorized"])("confirmed %s clears identity and opens the login explanation", async error => {
 await ready()
 vi.mocked(getProfile).mockRejectedValue(new Error(error))
 await act(async () => { notifySessionExpired(); notifySessionExpired() })
 expect(getProfile).toHaveBeenCalledTimes(2)
 expect(useMainStore.getState().profile).toBeUndefined()
 expect(navigate).toHaveBeenCalledExactlyOnceWith("/dashboard/login?reason=expired", { replace: true })
})
test.each(["network", "Service Unavailable", "Forbidden"])("transient %s profile error does not log out", async error => {
 await ready()
 vi.mocked(getProfile).mockRejectedValue(new Error(error))
 await act(async () => { notifySessionExpired() })
 expect(useMainStore.getState().profile?.id).toBe(1)
 expect(navigate).not.toHaveBeenCalled()
})
test("a valid current profile defeats a stale unauthorized response", async () => {
 await ready()
 await act(async () => { notifySessionExpired() })
 expect(useMainStore.getState().profile?.id).toBe(1)
 expect(navigate).not.toHaveBeenCalled()
})
test.each(["cookie", "login"])("late expiry verification cannot overwrite a new %s", async change => {
 await ready()
 let reject!: (e: Error) => void
 vi.mocked(getProfile).mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r }))
 await act(async () => { notifySessionExpired() })
 if (change === "cookie") cookies = "nz-jwt=another-login"
 else await act(async () => { await auth.login("fixture", "fixture") })
 navigate.mockClear()
 await act(async () => { reject(new Error("ApiErrorUnauthorized")) })
 expect(useMainStore.getState().profile?.id).toBe(1)
 expect(navigate).not.toHaveBeenCalled()
})
