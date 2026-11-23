import { FetcherMethod, fetcher } from "./api"

export interface ServerServicePreference {
    service_id: number
    color?: string
}
export interface ServerServiceChoice {
    id: number
    name: string
    chart_color: string
    default_included: boolean
}
export interface ServerServicesView {
    services: ServerServicePreference[]
    available: ServerServiceChoice[]
}
export const getServerServices = (id: number) =>
    fetcher<ServerServicesView>(FetcherMethod.GET, `/api/v1/server/${id}/services`)
export const setServerServices = (id: number, services: ServerServicePreference[]) =>
    fetcher<ServerServicesView>(FetcherMethod.PUT, `/api/v1/server/${id}/services`, { services })
