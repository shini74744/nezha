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
    const recorded = (value: string) =>
        Boolean(value?.trim()) && !["未记录", "当时未记录", "未获取", "—", "-"].includes(value.trim())
    const ipRows = ["ipv4", "ipv6"].flatMap((field): DisplayOperationChange[] => {
        const changed = changes.find((change) => change.field === field)
        if (changed) return recorded(changed.after) ? [changed] : []
        const snapshot = details?.ip_snapshot?.find((item) => item.field === field)
        // Missing/unobserved families have no row, including previously cached addresses.
        // This is presentation only: saved changes and change counts are untouched.
        if (!snapshot?.observed || !recorded(snapshot.after)) return []
        return [{
            field,
            before: snapshot.before,
            after: snapshot.after,
            status: snapshot.before === snapshot.after ? "未变化" : undefined,
        }]
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
