import { Oauth2RequestType, getOauth2RedirectURL } from "@/api/oauth2"
import { OAuthTOTPChallenge } from "@/components/oauth-totp-challenge"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { OAuthProviderIcon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/hooks/useAuth"
import useSetting from "@/hooks/useSetting"
import { zodResolver } from "@hookform/resolvers/zod"
import i18next from "i18next"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

const formSchema = z.object({
    username: z.string().min(2, {
        message: i18next.t("Results.UsernameMin", { number: 2 }),
    }),
    password: z.string().min(1, {
        message: i18next.t("Results.PasswordRequired"),
    }),
    code: z.string().max(64),
})

function Login() {
    const { login, loginOauth2 } = useAuth()
    const { data: settingData } = useSetting()
    const [needsTOTP, setNeedsTOTP] = useState(false)
    const [recovery, setRecovery] = useState(false)
    const [oauthChallenge, setOAuthChallenge] = useState(
        () => new URLSearchParams(window.location.search).get("oauth2_totp") === "1",
    )

    useEffect(() => {
        const oauth2 = new URLSearchParams(window.location.search).get("oauth2")
        if (oauth2) {
            loginOauth2()
        }
    }, [loginOauth2])

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
            password: "",
            code: "",
        },
    })

    const username = form.watch("username"),
        password = form.watch("password")
    useEffect(() => {
        setNeedsTOTP(false)
        form.setValue("code", "")
    }, [username, password, form])
    useEffect(() => {
        if (needsTOTP) form.setFocus("code")
    }, [needsTOTP, form])
    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (needsTOTP && !values.code.trim()) {
            form.setError("code", { message: recovery ? "请输入恢复码" : "请输入 6 位动态验证码" })
            return
        }
        if (
            (await login(
                values.username,
                values.password,
                needsTOTP ? values.code.trim() : undefined,
            )) === "totp-required"
        ) {
            setNeedsTOTP(true)
        }
    }

    async function loginWith(provider: string) {
        try {
            const redirectUrl = await getOauth2RedirectURL(provider, Oauth2RequestType.LOGIN)
            window.location.assign(redirectUrl.redirect!)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const { t } = useTranslation()

    if (oauthChallenge)
        return (
            <OAuthTOTPChallenge
                onBack={() => {
                    window.history.replaceState({}, document.title, window.location.pathname)
                    setOAuthChallenge(false)
                }}
            />
        )

    return (
        <div className="mt-28 sm:max-w-sm m-auto max-w-xs">
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                    <FormField
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t("Username")}</FormLabel>
                                <FormControl>
                                    <Input placeholder="admin" autoComplete="username" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t("Password")}</FormLabel>
                                <FormControl>
                                    <Input
                                        type="password"
                                        placeholder="admin"
                                        autoComplete="current-password"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {needsTOTP && (
                        <div className="space-y-2">
                            <FormField
                                control={form.control}
                                name="code"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{recovery ? "恢复码" : "动态验证码"}</FormLabel>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                placeholder={
                                                    recovery
                                                        ? "输入一组未使用的恢复码"
                                                        : "输入验证器中的 6 位数字"
                                                }
                                                inputMode={recovery ? "text" : "numeric"}
                                                autoComplete={recovery ? "off" : "one-time-code"}
                                                maxLength={recovery ? 64 : 6}
                                                spellCheck={false}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <button
                                type="button"
                                className="text-xs text-muted-foreground underline underline-offset-4"
                                onClick={() => {
                                    setRecovery(!recovery)
                                    form.setValue("code", "")
                                    form.clearErrors("code")
                                }}
                            >
                                {recovery ? "使用验证器动态码" : "无法使用验证器？使用恢复码"}
                            </button>
                        </div>
                    )}
                    <Button
                        disabled={form.formState.isSubmitting}
                        type="submit"
                        className="w-full rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                    >
                        {t("Login")}
                    </Button>
                </form>
                {settingData?.config?.oauth2_providers &&
                    settingData?.config?.oauth2_providers.length > 0 && (
                        <section className="flex items-center my-3 w-full">
                            <Separator className="flex-1" />
                            <div className="flex justify-center text-xs text-muted-foreground w-full max-w-[100px]">
                                OAuth2
                            </div>
                            <Separator className="flex-1" />
                        </section>
                    )}
            </Form>
            <div className="mt-3 flex flex-col gap-3">
                {settingData?.config?.oauth2_providers?.map((p: string) => (
                    <Button
                        key={p}
                        className="w-full rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] bg-muted text-primary hover:bg-muted/80 hover:text-primary/80"
                        onClick={() => loginWith(p)}
                    >
                        <OAuthProviderIcon provider={p} className="size-4" />
                        {p}
                    </Button>
                ))}
            </div>
        </div>
    )
}

export default Login
