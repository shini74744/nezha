import { getTelegramBots } from "@/api/notification"
import { NotificationTab } from "@/components/notification-tab"
import { NotifierCard } from "@/components/notifier"
import { TelegramMenuSettings } from "@/components/telegram-menu-settings"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { Link } from "react-router-dom"
import useSWR from "swr"

export default function TelegramBotPage() {
    const { data, error, isLoading, mutate } = useSWR("telegram-bot-settings", getTelegramBots, {
        refreshInterval: 5000,
    })
    const [selected, setSelected] = useState<number>()
    const current = data?.find((item) => item.id === selected) ?? data?.[0]
    const reload = async () => {
        await mutate()
        return undefined
    }
    return (
        <div className="px-3 pb-6">
            <div className="my-6 flex flex-wrap items-center gap-3">
                <NotificationTab className="w-full sm:flex-1 sm:max-w-2xl" />
            </div>
            <div className="max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="text-xl font-semibold">TG 机器人设置</h1>
                    <NotifierCard mutate={reload} triggerLabel="添加 TG 通知" />
                </div>
                {isLoading ? (
                    <p role="status" className="text-sm text-muted-foreground">
                        正在加载…
                    </p>
                ) : error ? (
                    <div role="alert" className="space-y-3 rounded-xl border p-5">
                        <p>无法读取 TG 通知，请重试。</p>
                        <Button variant="outline" onClick={() => mutate()}>
                            重新加载
                        </Button>
                    </div>
                ) : !current ? (
                    <div className="rounded-xl border bg-card/80 p-6 text-center">
                        <p className="font-medium">尚未添加 TG 通知</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            请先添加 TG 通知，添加后才能启用机器人配置。
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-3">
                            <label htmlFor="tg-notification" className="text-sm">
                                TG 通知
                            </label>
                            <select
                                id="tg-notification"
                                value={current.id}
                                className="h-9 min-w-0 max-w-full flex-1 rounded-md border bg-background px-3 text-sm sm:max-w-sm"
                                onChange={(event) => setSelected(Number(event.target.value))}
                            >
                                {data?.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} · #{item.id}
                                    </option>
                                ))}
                            </select>
                            <Link
                                to="/dashboard/notification"
                                className="text-sm underline underline-offset-4"
                            >
                                管理通知
                            </Link>
                        </div>
                        <TelegramMenuSettings key={current.id} value={current} onSaved={mutate} />
                    </>
                )}
            </div>
        </div>
    )
}
