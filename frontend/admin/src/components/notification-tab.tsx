import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"

export const NotificationTab = ({ className }: { className?: string }) => {
    const { t } = useTranslation()
    const location = useLocation()
    const { profile } = useAuth()
    const admin = profile?.role === 0

    return (
        <Tabs defaultValue={location.pathname} className={className}>
            <TabsList className={"grid w-full " + (admin ? "grid-cols-3" : "grid-cols-2")}>
                <TabsTrigger value="/dashboard/notification" asChild>
                    <Link to="/dashboard/notification">{t("Notifier")}</Link>
                </TabsTrigger>
                <TabsTrigger value="/dashboard/alert-rule" asChild>
                    <Link to="/dashboard/alert-rule">{t("AlertRule")}</Link>
                </TabsTrigger>
                {admin && <TabsTrigger value="/dashboard/server-expiry" asChild><Link to="/dashboard/server-expiry" className="text-xs sm:text-sm">服务器到期通知</Link></TabsTrigger>}
            </TabsList>
        </Tabs>
    )
}
