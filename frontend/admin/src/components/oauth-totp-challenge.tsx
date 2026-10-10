import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/useAuth"
import { ShieldCheck } from "lucide-react"
import { useState } from "react"

export function OAuthTOTPChallenge({ onBack }: { onBack: () => void }) {
    const { loginOauth2 } = useAuth()
    const [code, setCode] = useState("")
    const [recovery, setRecovery] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    async function verify(event: React.FormEvent) {
        event.preventDefault()
        if (busy) return
        if (!code.trim()) {
            setError("请输入验证码或恢复码")
            return
        }
        setBusy(true)
        setError("")
        try {
            await fetcher(FetcherMethod.POST, "/api/v1/oauth2/totp", { code: code.trim() })
            await loginOauth2()
        } catch (reason) {
            const message = reason instanceof Error ? reason.message : "验证失败，请重试"
            setError(
                message === "ApiErrorTOTPLimited"
                    ? "验证尝试过多，请 5 分钟后重新登录"
                    : message === "ApiErrorTOTPInvalid"
                      ? "验证码或恢复码无效，已使用的验证码不能重复使用"
                      : message,
            )
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="m-auto mt-28 max-w-xs sm:max-w-sm" data-oauth-totp>
            <form className="space-y-5" onSubmit={verify}>
                <div className="space-y-2">
                    <h1 className="flex items-center gap-2 text-xl font-semibold">
                        <ShieldCheck className="size-5" />
                        身份验证
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        GitHub 验证后，还需通过身份验证器才能进入后台。请在 5 分钟内完成。
                    </p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="oauth-totp-code">{recovery ? "恢复码" : "动态验证码"}</Label>
                    <Input
                        id="oauth-totp-code"
                        autoFocus
                        value={code}
                        disabled={busy}
                        inputMode={recovery ? "text" : "numeric"}
                        autoComplete={recovery ? "off" : "one-time-code"}
                        maxLength={recovery ? 64 : 6}
                        spellCheck={false}
                        placeholder={
                            recovery ? "输入一组未使用的恢复码" : "输入验证器中的 6 位数字"
                        }
                        aria-invalid={!!error}
                        aria-describedby={error ? "oauth-totp-error" : undefined}
                        onChange={(e) => setCode(e.target.value)}
                    />
                    <button
                        type="button"
                        disabled={busy}
                        className="text-xs text-muted-foreground underline underline-offset-4"
                        onClick={() => {
                            setRecovery(!recovery)
                            setCode("")
                            setError("")
                        }}
                    >
                        {recovery ? "使用验证器动态码" : "无法使用验证器？使用恢复码"}
                    </button>
                    {error && (
                        <p id="oauth-totp-error" role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "验证中…" : "验证并登录"}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={busy}
                    onClick={onBack}
                >
                    返回登录
                </Button>
            </form>
        </div>
    )
}
