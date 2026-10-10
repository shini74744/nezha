import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(resolve(process.cwd(), "src", file), "utf8")
describe("admin user-facing copy", () => {
    it.each([
        ["components/alert-rule.tsx", "本次不修改后端"],
        ["components/alert-condition-editor.tsx", "月底行为保持原样"],
        ["components/cron.tsx", "权限仍由后端校验"],
        ["components/server.tsx", "保存使用兼容格式"],
        ["components/telegram-notification-editor.tsx", "去重保存在内存中"],
        ["components/telegram-notification-editor.tsx", "系统目前仅做 JSON / URL 转义"],
        ["components/notification-event-modules.tsx", "首次上报只建立基线"],
        ["routes/dashboard-appearance.tsx", "只读取 NZ_DASHBOARD_CONFIG"],
        ["lib/appearance-manifest.json", "不会加载 jm/xjs"],
        ["components/terminal.tsx", "View console for details."],
    ])("omits implementation copy from %s", (file, text) => {
        expect(read(file)).not.toContain(text)
    })
    it("keeps security and irreversible-action warnings", () => {
        expect(read("components/telegram-menu-settings.tsx")).toContain("明文密码会保存在 TG 聊天记录中")
        expect(read("components/telegram-notification-editor.tsx")).toContain("不受通知正文的 IP 脱敏设置影响")
        expect(read("routes/server-expiry.tsx")).toContain("不代表已实际付款")
        expect(read("components/ConnectivityIconPicker.tsx")).toContain("请勿使用含密钥或私密信息的链接")
        const zh = JSON.parse(read("locales/zh-CN/translation.json"))
        expect(zh.ServerIDReassignConfirm).toContain("面板将自动重启")
        expect(zh.ApiTokenStoreSafely).toContain("任何持有者")
        expect(zh.Results.ThisOperationIsUnrecoverable).toContain("无法恢复")
    })
})
