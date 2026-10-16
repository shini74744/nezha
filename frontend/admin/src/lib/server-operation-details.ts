export interface OperationChange {
    field: string
    before: string
    after: string
}
export interface OperationDetails {
    ip_snapshot?: (OperationChange & { observed: boolean })[]
    public_note?: { before: string; after: string }
}
export interface DisplayOperationChange extends OperationChange {
    status?: string
}

// Keep event-time context out of the real change count. Never fill an old
// snapshot with the node's current address or infer it from a different page.
export function operationDisplayChanges(
    changes: OperationChange[],
    details?: OperationDetails | null,
): DisplayOperationChange[] {
    const isIP = (field: string) => field === "ipv4" || field === "ipv6"
    if (!changes.some((change) => isIP(change.field))) return changes
    const ipRows = ["ipv4", "ipv6"].map((field): DisplayOperationChange => {
        const changed = changes.find((change) => change.field === field)
        if (changed) return changed
        const snapshot = details?.ip_snapshot?.find((item) => item.field === field)
        if (!snapshot)
            return {
                field,
                before: "当时未记录",
                after: "当时未记录",
                status: "旧记录未保存此项快照",
            }
        return {
            field,
            before: snapshot.before,
            after: snapshot.after,
            status: !snapshot.observed
                ? snapshot.after === "未记录"
                    ? "本次未获取"
                    : "本次未获取，显示最近有效地址"
                : snapshot.before === snapshot.after
                  ? "未变化"
                  : undefined,
        }
    })
    let inserted = false
    return changes.flatMap((change) => {
        if (!isIP(change.field)) return [change]
        if (inserted) return []
        inserted = true
        return ipRows
    })
}

export function publicNoteSnapshotText(text: string): string {
    if (text === "") return "（空内容，未设置）"
    try {
        return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
        return text
    }
}
