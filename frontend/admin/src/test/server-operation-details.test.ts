import { operationDisplayChanges, publicNoteSnapshotText } from "@/lib/server-operation-details"
import { describe, expect, it } from "vitest"
describe("operation event-time context", () => {
    const changes = [{ field: "ipv4", before: "192.0.2.1", after: "192.0.2.2" }]
    it("shows unchanged observed IPv6 without altering the change list", () => {
        const rows = operationDisplayChanges(changes, {ip_snapshot:[
            {field:"ipv6",before:"2001:db8::1",after:"2001:db8::1",observed:true},
        ]})
        expect(rows).toHaveLength(2);expect(rows[1].status).toBe("未变化");expect(changes).toHaveLength(1)
    })
    it("hides an IPv6 family not obtained for this event, even if an older address was cached", () => {
        for(const address of ["未记录", "2001:db8::1", ""]) {
            expect(operationDisplayChanges(changes,{ip_snapshot:[
                {field:"ipv6",before:address,after:address,observed:false},
            ]})).toEqual(changes)
        }
    })
    it("does not display placeholders for missing old snapshots", () => {
        expect(operationDisplayChanges(changes)).toEqual(changes)
    })
    it("keeps actual dual-stack changes and non-IP rows", () => {
        const both=[...changes,{field:"ipv6",before:"2001:db8::1",after:"2001:db8::2"}]
        expect(operationDisplayChanges(both)).toEqual(both)
        expect(operationDisplayChanges([both[1]])).toEqual([both[1]])
        expect(operationDisplayChanges([{field:"cpu",before:"a",after:"b"}])).toHaveLength(1)
    })
    it("shows acquired addresses and hides families with no address after the event without mutating history", () => {
        for(const field of ["ipv4","ipv6"]) {
            const acquired={field,before:"未记录",after:field==="ipv4"?"192.0.2.1":"2001:db8::1"}
            expect(operationDisplayChanges([acquired])).toEqual([acquired])
            const unavailable=[{field,before:acquired.after,after:"未记录"}]
            expect(operationDisplayChanges(unavailable)).toEqual([])
            expect(unavailable).toHaveLength(1)
        }
    })
    it("formats JSON without interpreting markup", () => {
        expect(publicNoteSnapshotText('{"name":"<script>test</script>"}')).toContain("<script>test</script>")
        expect(publicNoteSnapshotText("plain\ncontent")).toBe("plain\ncontent")
        expect(publicNoteSnapshotText("")).toBe("（空内容，未设置）")
    })
})
