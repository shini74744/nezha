import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

export const SettingsTab = ({ className }: { className?: string }) => {
    const { t } = useTranslation()
    const { profile } = useAuth()

    const isAdmin = profile?.role === 0
    const colsClass = isAdmin ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-1"

    return (
        <Tabs defaultValue={window.location.pathname} className={className}>
            <TabsList className={`grid h-auto gap-1 w-full ${colsClass}`}>
                {isAdmin && (
                    <>
                        <TabsTrigger value="/dashboard/settings" asChild>
                            <Link to="/dashboard/settings">{t("Settings")}</Link>
                        </TabsTrigger>
                        <TabsTrigger value="/dashboard/settings/user" asChild>
                            <Link to="/dashboard/settings/user">{t("User")}</Link>
                        </TabsTrigger>
                        <TabsTrigger value="/dashboard/settings/online-user" asChild>
                            <Link to="/dashboard/settings/online-user">{t("OnlineUser")}</Link>
                        </TabsTrigger>
                        <TabsTrigger value="/dashboard/settings/waf" asChild>
                            <Link to="/dashboard/settings/waf">{t("WAF")}</Link>
                        </TabsTrigger>
                    </>
                )}
                <TabsTrigger value="/dashboard/settings/api-tokens" asChild>
                    <Link to="/dashboard/settings/api-tokens">{t("ApiTokens")}</Link>
                </TabsTrigger>
                {isAdmin && <TabsTrigger className="col-start-1" value="/dashboard/settings/appearance" asChild>
                    <Link to="/dashboard/settings/appearance">美化设置</Link>
                </TabsTrigger>}
                {isAdmin && <TabsTrigger value="/dashboard/settings/dashboard-appearance" asChild>
                    <Link to="/dashboard/settings/dashboard-appearance">后台美化设置</Link>
                </TabsTrigger>}
            </TabsList>
        </Tabs>
    )
}
