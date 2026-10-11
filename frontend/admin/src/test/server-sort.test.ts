import { moveServerToPosition, reorderServers } from "@/components/server-sort-dialog"
import { ModelServer } from "@/types"
import { describe, expect, it } from "vitest"

const servers = [1, 2, 3].map((id) => ({ id, name: `server-${id}` })) as ModelServer[]

describe("server drag sorting", () => {
    it("moves an earlier item before a later target", () => {
        expect(reorderServers(servers, 1, 3, false).map((server) => server.id)).toEqual([2, 1, 3])
    })

    it("can move an item to the very end", () => {
        expect(reorderServers(servers, 1, 3, true).map((server) => server.id)).toEqual([2, 3, 1])
    })

    it("moves a later item before an earlier target", () => {
        expect(reorderServers(servers, 3, 1, false).map((server) => server.id)).toEqual([3, 1, 2])
    })
})

describe("server position input", () => {
    it("moves position 14 to 11 and shifts old 11 through 13 without changing system IDs", () => {
        const rows = Array.from({ length: 16 }, (_, i) => ({ id: 100 + i, name: "node-" + i })) as ModelServer[]
        const next = moveServerToPosition(rows, 113, 11)
        expect(next.slice(10, 14).map(row => row.id)).toEqual([113, 110, 111, 112])
        expect([...next].map(row => row.id).sort()).toEqual(rows.map(row => row.id).sort())
        expect(rows[13].id).toBe(113)
    })
    it("supports first, last, unchanged and rejects invalid positions", () => {
        expect(moveServerToPosition(servers, 1, 3).map(row => row.id)).toEqual([2, 3, 1])
        expect(moveServerToPosition(servers, 3, 1).map(row => row.id)).toEqual([3, 1, 2])
        for (const position of [0, -1, 4, 1.5, NaN]) expect(moveServerToPosition(servers, 1, position)).toBe(servers)
        expect(moveServerToPosition(servers, 1, 1)).toBe(servers)
        expect(moveServerToPosition(servers, 999, 1)).toBe(servers)
    })
})
