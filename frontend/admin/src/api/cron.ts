import { ModelCronForm } from "@/types"

import { FetcherMethod, fetcher } from "./api"

export const createCron = async (data: ModelCronForm): Promise<number> => {
    return fetcher<number>(FetcherMethod.POST, "/api/v1/cron", data)
}

export const updateCron = async (id: number, data: ModelCronForm): Promise<void> => {
    return fetcher<void>(FetcherMethod.PATCH, `/api/v1/cron/${id}`, data)
}

export const deleteCron = async (id: number[]): Promise<void> => {
    return fetcher<void>(FetcherMethod.POST, "/api/v1/batch-delete/cron", id)
}

export const runCron = async (id: number): Promise<void> => {
    return fetcher<void>(FetcherMethod.POST, `/api/v1/cron/${id}/manual`, null)
}

export interface CronPreview {
    timezone: string
    next: string[]
}
export const previewCron = (scheduler: string): Promise<CronPreview> =>
    fetcher<CronPreview>(FetcherMethod.POST, "/api/v1/cron/preview", { scheduler })
