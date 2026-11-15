import { fetcher, FetcherMethod } from "./api"

export interface BackupTarget {
 retain_count?:number; setup_state?:string; setup_error?:string; receiver?: boolean; id: number; name: string; server_id: number; host: string; port: number; user: string
 directory: string; fingerprint: string; auth_type: "password" | "key"; transport: "sftp"; has_secret?: boolean
}
export interface BackupTargetInput extends BackupTarget { password?: string; private_key?: string }
export interface BackupPlan {
 backup_type?: "full" | "incremental"; mode: "manual" | "interval" | "daily"; interval_minutes: number; daily_time: string
 target_ids: number[]; next_at: string | null; encrypt: boolean; has_password?: boolean
}
export interface BackupDelivery {
 id: number; target_id: number; name: string; state: string; phase: string; started_at?: string; finished_at?: string
 processed_bytes: number; total_bytes: number; sent_bytes: number; verified_bytes: number; bytes_per_second: number
 backup_type?: string; parent_id?:number; pruned_at?:string|null; retention_error?:string; archive: string; sha256: string; error: string
}
export interface BackupRun {
 backup_type?:string; id: number; trigger: string; retry_of: number; state: string; phase: string; started_at: string; finished_at?: string
 snapshot_at?: string; total_bytes: number; encrypted: boolean; error: string; deliveries: BackupDelivery[]
}
export interface BackupOverview { time_zone?:string; plan: BackupPlan; targets: BackupTarget[]; active: BackupRun | null; server_time: string }
export interface BackupHistory { items: BackupRun[]; total: number; page: number; page_size: number }
export const backupOverview = () => fetcher<BackupOverview>(FetcherMethod.GET, "/api/v1/backup")
export const backupHistory = (page: number) => fetcher<BackupHistory>(FetcherMethod.GET, `/api/v1/backup/history?page=${page}&page_size=10`)
export const saveBackupPlan = (plan: BackupPlan, backup_password: string) => fetcher(FetcherMethod.PUT, "/api/v1/backup/plan", { ...plan, backup_password })
export const saveBackupTarget = (target: BackupTargetInput) => fetcher<BackupTarget>(FetcherMethod.POST, "/api/v1/backup/targets", target)
export const probeBackupTarget = (target: BackupTargetInput) => fetcher<{fingerprint: string}>(FetcherMethod.POST, "/api/v1/backup/probe", target)
export const prepareBackupTarget = (target: BackupTargetInput) => fetcher<{target: BackupTarget; command: string}>(FetcherMethod.POST, "/api/v1/backup/prepare", target)
export const setupBackupTarget = (id: number) => fetcher<BackupTarget>(FetcherMethod.POST, "/api/v1/backup/setup", {id})
export const deleteBackupTarget = (id: number) => fetcher(FetcherMethod.DELETE, `/api/v1/backup/targets/${id}`)
export const startBackup = (target_ids?: number[], retry_of?: number) => fetcher<{id: number}>(FetcherMethod.POST, "/api/v1/backup/run", {target_ids, retry_of})
export const cancelBackup = (id: number) => fetcher(FetcherMethod.POST, `/api/v1/backup/runs/${id}/cancel`, {})

export const backupCommand = (id:number) => fetcher<{command:string}>(FetcherMethod.GET, `/api/v1/backup/targets/${id}/command`)

export const backupTargetStatus = (id:number) => fetcher<BackupTarget>(FetcherMethod.GET, `/api/v1/backup/targets/${id}/status`)
