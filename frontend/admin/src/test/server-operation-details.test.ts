import { operationDisplayChanges, publicNoteSnapshotText } from "@/lib/server-operation-details"
import { describe, expect, it } from "vitest"

describe("operation event-time context", () => {
    const changes = [{ field: "ipv4", before: "192.0.2.1", after: "192.0.2.2" }]
    it("shows unchanged IPv6 without altering the change list", () => {
        const rows = operationDisplayChanges(changes, {
            ip_snapshot: [
                { field: "ipv6", before: "2001:db8::1", after: "2001:db8::1", observed: true },
            ],
        })
        expect(rows).toHaveLength(2)
        expect(rows[1].status).toBe("未变化")
        expect(changes).toHaveLength(1)
    })
    it("never labels an unobserved family unchanged", () => {
        expect(
            operationDisplayChanges(changes, {
                ip_snapshot: [
                    { field: "ipv6", before: "2001:db8::1", after: "2001:db8::1", observed: false },
                ],
            })[1].status,
        ).toBe("本次未获取，显示最近有效地址")
        expect(
            operationDisplayChanges(changes, {
                ip_snapshot: [
                    { field: "ipv6", before: "未记录", after: "未记录", observed: false },
                ],
            })[1].status,
        ).toBe("本次未获取")
    })
    it("does not fabricate missing old snapshots", () => {
        const row = operationDisplayChanges(changes)[1]
        expect(row.after).toBe("当时未记录")
        expect(row.status).toBe("旧记录未保存此项快照")
    })
    it("keeps real dual-stack changes and non-IP rows", () => {
        const both = [...changes, { field: "ipv6", before: "2001:db8::1", after: "2001:db8::2" }]
        expect(operationDisplayChanges(both)).toEqual(both)
        expect(operationDisplayChanges([{ field: "cpu", before: "a", after: "b" }])).toHaveLength(1)
        expect(operationDisplayChanges([both[1]])[0].field).toBe("ipv4")
    })
    it("formats JSON for reading without interpreting markup", () => {
        expect(publicNoteSnapshotText('{"name":"<script>test</script>"}')).toContain(
            "<script>test</script>",
        )
        expect(publicNoteSnapshotText("plain\ncontent")).toBe("plain\ncontent")
        expect(publicNoteSnapshotText("")).toBe("（空内容，未设置）")
    })
})
