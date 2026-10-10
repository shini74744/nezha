import { ModelNotification, ModelNotificationForm } from "@/types"

import { FetcherMethod, fetcher } from "./api"

// Secrets are loaded only for an explicitly opened, write-authorized editor.
export const getNotificationEditor = (id: number): Promise<ModelNotification> =>
    fetcher<ModelNotification>(FetcherMethod.GET, `/api/v1/notification/${id}/editor`)

export const createNotification = async (data: ModelNotificationForm): Promise<number> => {
    return fetcher<number>(FetcherMethod.POST, "/api/v1/notification", data)
}

export const updateNotification = async (
    id: number,
    data: ModelNotificationForm,
): Promise<void> => {
    return fetcher<void>(FetcherMethod.PATCH, `/api/v1/notification/${id}`, data)
}

export const deleteNotification = async (id: number[]): Promise<void> => {
    return fetcher<void>(FetcherMethod.POST, "/api/v1/batch-delete/notification", id)
}

export const getNotification = async (): Promise<ModelNotification[]> => {
    return fetcher<ModelNotification[]>(FetcherMethod.GET, "/api/v1/notification", null)
}

export const getTelegramMenuStatus = (
    id: number,
): Promise<import("@/lib/telegram-menu").TelegramMenuStatus> =>
    fetcher(FetcherMethod.GET, `/api/v1/notification/${id}/telegram-menu/status`)

export interface TelegramBotSettings {
    id: number
    name: string
    config: import("@/lib/telegram-menu").TelegramMenuConfig
    eligible: boolean
    reason?: string
    status: import("@/lib/telegram-menu").TelegramMenuStatus
}
export const getTelegramBots = (): Promise<TelegramBotSettings[]> =>
    fetcher(FetcherMethod.GET, "/api/v1/telegram-bot")
export const saveTelegramBot = (
    id: number,
    config: import("@/lib/telegram-menu").TelegramMenuConfig,
): Promise<TelegramBotSettings> =>
    fetcher(FetcherMethod.PATCH, `/api/v1/notification/${id}/telegram-menu`, {
        telegram_menu: config,
    })
