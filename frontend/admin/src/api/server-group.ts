import { ModelServerGroupForm, ModelServerGroupResponseItem } from "@/types"

import { FetcherMethod, fetcher } from "./api"

export const createServerGroup = async (data: ModelServerGroupForm): Promise<number> => {
    return fetcher<number>(FetcherMethod.POST, "/api/v1/server-group", data)
}

export const updateServerGroup = async (id: number, data: ModelServerGroupForm): Promise<void> => {
    return fetcher<void>(FetcherMethod.PATCH, `/api/v1/server-group/${id}`, data)
}

export const deleteServerGroups = async (
    id: number[],
    groups: ModelServerGroupResponseItem[],
): Promise<void> => {
    const revisions = Object.fromEntries(id.map(value => {
        const group = groups.find(item => item.group.id === value)
        if (!group?.revision) throw new Error("分组已变化，请刷新列表后重试")
        return [value, group.revision]
    }))
    const query = new URLSearchParams({ revisions: JSON.stringify(revisions) })
    return fetcher<void>(FetcherMethod.POST, `/api/v1/batch-delete/server-group?${query}`, id)
}

export const getServerGroups = async (): Promise<ModelServerGroupResponseItem[]> => {
    return fetcher<ModelServerGroupResponseItem[]>(FetcherMethod.GET, "/api/v1/server-group", null)
}
