import { test as base, expect, type Page } from "@playwright/test"
import { defaults } from "./appearance-fixture"

async function read(page: Page) {
    const response = await page.request.get("/api/v1/setting/appearance")
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.success).toBe(true)
    return body.data
}
async function save(page: Page, revision: string, config: unknown) {
    const csrf = (await page.context().cookies()).find(cookie => cookie.name === "nz-csrf")?.value
    expect(csrf).toBeTruthy()
    const response = await page.request.patch("/api/v1/setting/appearance", {
        headers: { "X-CSRF-Token": csrf! }, data: { revision, config },
    })
    expect(response.ok()).toBe(true)
    expect((await response.json()).success).toBe(true)
}
export const test = base.extend<{
    isolatedAppearance: (configure: (config: ReturnType<typeof defaults>) => void) => Promise<void>
}>({
    isolatedAppearance: async ({ page, baseURL }, provideFixture) => {
        let original: Awaited<ReturnType<typeof read>> | undefined
        await provideFixture(async configure => {
            // These writes are allowed only against the explicit disposable test installation.
            expect(process.env.E2E_REAL_BACKEND).toBe("1")
            expect(baseURL).toBe("http://127.0.0.1:18476")
            original = await read(page)
            const config = defaults()
            configure(config)
            await save(page, original.revision, config)
        })
        if (original) {
            const current = await read(page)
            await save(page, current.revision, original.config)
        }
    },
})
export { expect }
