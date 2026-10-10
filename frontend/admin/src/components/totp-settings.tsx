import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ChevronDown, ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

type Status = {
    enabled: boolean
    recovery_remaining: number
    github_enabled: boolean
    password_enabled: boolean
}
type Setup = { secret: string; qr_code: string; expires_at: number }
const endpoint = "/api/v1/profile/totp"
function errorText(error: unknown) {
    const message = error instanceof Error ? error.message : "操作失败，请重试"
    if (message === "ApiErrorTOTPInvalid") return "验证码或恢复码无效；已使用的验证码不能重复使用"
    if (message === "ApiErrorTOTPLimited") return "验证尝试过多，请 5 分钟后重试"
    return message
}

export function TOTPSettings({ passwordDisabled = false }: { passwordDisabled?: boolean }) {
    const [status, setStatus] = useState<Status>()
    const [failed, setFailed] = useState(false)
    const [setup, setSetup] = useState<Setup>()
    const [codes, setCodes] = useState<string[]>([])
    const [password, setPassword] = useState("")
    const [code, setCode] = useState("")
    const [busy, setBusy] = useState(false)
    const [reload, setReload] = useState(0)
    const [githubEnabled, setGithubEnabled] = useState(false)
    const [passwordEnabled, setPasswordEnabled] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const policyChanged =
        !!status &&
        (githubEnabled !== status.github_enabled || passwordEnabled !== status.password_enabled)
    function applyStatus(value: Status) {
        setStatus(value)
        setGithubEnabled(value.github_enabled)
        setPasswordEnabled(value.password_enabled)
    }
    function toggleSettings() {
        if (expanded) {
            if (status) applyStatus(status)
            setPassword("")
            setCode("")
        }
        setExpanded(!expanded)
    }
    useEffect(() => {
        let active = true
        setFailed(false)
        fetcher<Status>(FetcherMethod.GET, endpoint)
            .then((value) => {
                if (active) {
                    applyStatus(value)
                }
            })
            .catch(() => {
                if (active) setFailed(true)
            })
        return () => {
            active = false
        }
    }, [reload])

    async function submit(
        action: "setup" | "confirm" | "disable" | "recovery" | "cancel" | "policy",
    ) {
        if (busy) return
        if (!password) {
            toast.error("请输入当前账号密码")
            return
        }
        if (["confirm", "disable", "recovery", "policy"].includes(action) && !code.trim()) {
            toast.error("请输入验证码或恢复码")
            return
        }
        setBusy(true)
        try {
            const result = await fetcher<Setup & Status & { recovery_codes: string[] }>(
                FetcherMethod.POST,
                endpoint + "/" + action,
                {
                    password,
                    code: code.trim(),
                    ...(action === "policy"
                        ? { github_enabled: githubEnabled, password_enabled: passwordEnabled }
                        : {}),
                },
            )
            if (action === "setup") {
                setSetup(result)
                setCodes([])
                setCode("")
            } else if (action === "policy") {
                applyStatus(result)
                setPassword("")
                setCode("")
                setExpanded(false)
                toast.success("登录验证设置已保存")
            } else {
                setSetup(undefined)
                setPassword("")
                setCode("")
                setCodes(result?.recovery_codes || [])
                const bound = action !== "disable" && action !== "cancel"
                applyStatus({
                    enabled: bound,
                    recovery_remaining: result?.recovery_codes?.length || 0,
                    github_enabled: bound && action !== "confirm" && !!status?.github_enabled,
                    password_enabled: bound && (action === "confirm" || !!status?.password_enabled),
                })
                if (!bound) setExpanded(false)
                toast.success(
                    action === "confirm"
                        ? "验证器已绑定，账号密码登录保护已开启，请保存恢复码"
                        : action === "disable"
                          ? "验证器已解除绑定"
                          : action === "cancel"
                            ? "已取消绑定"
                            : "恢复码已更新，旧恢复码已失效",
                )
            }
        } catch (error) {
            toast.error(errorText(error))
        } finally {
            setBusy(false)
        }
    }
    function downloadCodes() {
        const blob = new Blob(
            [
                "Nezha 身份验证器恢复码（每组只能使用一次）\n请离线妥善保管，不要分享。\n\n" +
                    codes.join("\n"),
            ],
            { type: "text/plain;charset=utf-8" },
        )
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "nezha-recovery-codes.txt"
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    return (
        <Card className="@container w-full min-w-0" data-totp-settings>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 p-4 pb-3 sm:p-5 sm:pb-3">
                <CardTitle className="flex items-center gap-2 text-xl">
                    <ShieldCheck className="size-5" />
                    身份验证器
                </CardTitle>
                {status && (
                    <p
                        className="order-last w-full text-xs font-medium @min-[30rem]:order-none @min-[30rem]:w-auto"
                        role="status"
                    >
                        {status.enabled ? "已绑定" : "未绑定"}
                        {status.enabled && (
                            <span className="ml-2 font-normal text-muted-foreground">
                                剩余 {status.recovery_remaining} 组恢复码
                            </span>
                        )}
                    </p>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-1 px-2 text-xs"
                    onClick={toggleSettings}
                    disabled={busy || !!setup || codes.length > 0}
                    aria-label={expanded ? (policyChanged ? "取消修改" : "收起设置") : "展开设置"}
                    aria-expanded={expanded}
                    aria-controls="totp-settings-panel"
                >
                    <span className="hidden @min-[24rem]:inline">
                        {expanded ? (policyChanged ? "取消修改" : "收起设置") : "展开设置"}
                    </span>
                    <ChevronDown
                        className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                </Button>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 sm:p-5 sm:pt-0">
                <p className="text-xs leading-relaxed text-muted-foreground">
                    开启需额外验证，关闭则无需动态码。
                </p>
                {passwordDisabled && (
                    <p className="text-xs text-muted-foreground">
                        当前账号已禁用密码登录；下方开关只控制二次验证，不会重新开放密码登录。
                    </p>
                )}
                {status && (
                    <div className="max-w-2xl space-y-2">
                        <div className="grid grid-cols-1 gap-2 @min-[24rem]:grid-cols-2">
                            {[
                                {
                                    id: "totp-password-login",
                                    label: "账号密码登录",
                                    value: passwordEnabled,
                                    set: setPasswordEnabled,
                                },
                                {
                                    id: "totp-github",
                                    label: "GitHub 登录",
                                    value: githubEnabled,
                                    set: setGithubEnabled,
                                },
                            ].map((item) => (
                                <div
                                    key={item.id}
                                    className="flex min-h-10 items-center justify-between gap-3 rounded-md border px-3 py-1.5"
                                >
                                    <Label htmlFor={item.id} className="text-sm">
                                        {item.label}
                                    </Label>
                                    <Switch
                                        id={item.id}
                                        checked={item.value}
                                        disabled={busy || !status.enabled || codes.length > 0}
                                        aria-describedby="totp-policy-hint"
                                        onCheckedChange={(value) => {
                                            item.set(value)
                                            setExpanded(true)
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                        <p
                            id="totp-policy-hint"
                            className="text-xs leading-relaxed text-muted-foreground"
                            role="status"
                        >
                            {!status.enabled
                                ? "请展开设置绑定验证器；绑定后默认保护账号密码登录。"
                                : policyChanged
                                  ? "尚未保存：请在下方验证身份后保存。"
                                  : !status.password_enabled && !status.github_enabled
                                    ? "两种登录均不需要验证器；绑定已保留，可随时重新开启。"
                                    : "开关已保存，开启的登录方式需额外验证。"}
                        </p>
                    </div>
                )}
                {!status ? (
                    <div role="status" className="text-sm">
                        {failed ? (
                            <>
                                读取状态失败。
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setReload((v) => v + 1)}
                                >
                                    重试
                                </Button>
                            </>
                        ) : (
                            "正在读取状态…"
                        )}
                    </div>
                ) : codes.length > 0 ? (
                    <section className="max-w-2xl space-y-3" aria-label="恢复码">
                        <p className="text-xs leading-relaxed">
                            恢复码仅在此时展示。每组只能使用一次，不能单独登录；请离线保存，不要发给他人。
                        </p>
                        <pre className="max-w-full select-all overflow-x-auto rounded-md border bg-muted p-3 text-xs leading-6">
                            {codes.join("\n")}
                        </pre>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-10 sm:h-9"
                                onClick={downloadCodes}
                            >
                                下载恢复码
                            </Button>
                            <Button size="sm" className="h-10 sm:h-9" onClick={() => setCodes([])}>
                                我已保存
                            </Button>
                        </div>
                    </section>
                ) : (
                    <div id="totp-settings-panel" hidden={!expanded} className="border-t pt-3">
                        <form
                            className="grid max-w-2xl grid-cols-1 gap-3 @min-[30rem]:grid-cols-2"
                            onSubmit={(event) => {
                                event.preventDefault()
                                void submit(
                                    setup
                                        ? "confirm"
                                        : status.enabled
                                          ? policyChanged
                                              ? "policy"
                                              : "recovery"
                                          : "setup",
                                )
                            }}
                        >
                            <div className="min-w-0 space-y-1.5">
                                <Label htmlFor="totp-password" className="text-xs">
                                    当前账号密码
                                </Label>
                                <Input
                                    id="totp-password"
                                    className="h-10 sm:h-9"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    maxLength={72}
                                    disabled={busy}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                            {(setup || status.enabled) && (
                                <div className="min-w-0 space-y-1.5">
                                    <Label htmlFor="totp-code" className="text-xs">
                                        {setup ? "6 位动态验证码" : "动态验证码或恢复码"}
                                    </Label>
                                    <Input
                                        id="totp-code"
                                        className="h-10 sm:h-9"
                                        value={code}
                                        inputMode={setup ? "numeric" : "text"}
                                        autoComplete="one-time-code"
                                        maxLength={setup ? 6 : 64}
                                        disabled={busy}
                                        onChange={(e) => setCode(e.target.value)}
                                    />
                                </div>
                            )}
                            {setup && (
                                <section className="col-span-full grid min-w-0 gap-3 @min-[30rem]:grid-cols-[192px_minmax(0,1fr)]">
                                    <img
                                        src={setup.qr_code}
                                        width={192}
                                        height={192}
                                        className="max-w-full rounded-md border bg-white p-2"
                                        alt="身份验证器绑定二维码"
                                    />
                                    <div className="min-w-0 space-y-3">
                                        <p className="text-xs leading-relaxed text-muted-foreground">
                                            使用身份验证器扫码，或手动输入密钥。10
                                            分钟内输入动态码，验证成功后才会启用。
                                        </p>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="totp-secret" className="text-xs">
                                                手动绑定密钥
                                            </Label>
                                            <Input
                                                id="totp-secret"
                                                value={setup.secret}
                                                readOnly
                                                autoComplete="off"
                                                className="h-10 select-all font-mono text-xs sm:h-9"
                                            />
                                        </div>
                                    </div>
                                </section>
                            )}
                            <div className="col-span-full flex flex-wrap gap-2">
                                <Button
                                    type="submit"
                                    size="sm"
                                    className="h-10 sm:h-9"
                                    disabled={busy}
                                >
                                    {busy
                                        ? "处理中…"
                                        : setup
                                          ? "验证并启用"
                                          : status.enabled
                                            ? policyChanged
                                                ? "保存登录设置"
                                                : "重新生成恢复码"
                                            : "开始绑定"}
                                </Button>
                                {setup && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-10 sm:h-9"
                                        disabled={busy}
                                        onClick={() => void submit("cancel")}
                                    >
                                        取消绑定
                                    </Button>
                                )}
                                {status.enabled && (
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        className="h-10 sm:h-9"
                                        disabled={busy || policyChanged}
                                        onClick={() => void submit("disable")}
                                    >
                                        解除绑定
                                    </Button>
                                )}
                            </div>
                            {status.enabled && (
                                <p className="col-span-full text-xs leading-relaxed text-muted-foreground">
                                    保存开关、更新恢复码或解除绑定均需验证身份，并退出其它会话。更新恢复码会使旧码失效；解除绑定会清除密钥。
                                </p>
                            )}
                        </form>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
