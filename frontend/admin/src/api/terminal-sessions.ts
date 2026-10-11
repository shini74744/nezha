import { FetcherMethod, fetcher } from "./api"
import { ModelCreateTerminalResponse } from "@/types"

export type SessionTerminal = ModelCreateTerminalResponse & { kind?: "native" | "tmux"; keep?: boolean; record_id?: number }
export interface SessionRow {
    id: number; name: string; stream_id: string; source: string; status: string; attached: boolean
    windows: Array<{ id: string; index: number; name: string }>
}
export interface SessionList { native: SessionRow[]; tmux: SessionRow[]; installed: boolean; tmux_error?: string }
export interface InstallState { state: "idle" | "running" | "done" | "failed"; message: string; log?: string }
export const sessionRequest = <T,>(action: string, data: object) =>
    fetcher<T>(FetcherMethod.POST, "/api/v1/terminal-sessions/" + action, data)
export const createSessionTerminal = (serverId: number) =>
    fetcher<SessionTerminal>(FetcherMethod.POST, "/api/v1/terminal", { server_id: serverId, protocol: "session-v1" })
export const keepSession = (streamId: string, enabled: boolean) =>
    sessionRequest<SessionTerminal>("keep", { stream_id: streamId, enabled })
