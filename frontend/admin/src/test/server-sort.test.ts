import { filterSortableServers, moveServerToPosition, reorderServers } from "@/components/server-sort-dialog"
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

describe("server sort search", () => {
    const rows = [
        { id: 91, name: "HK-Taiwan 物理机" },
        { id: 17, name: "普通节点" },
        { id: 204, name: "HK-Japan [test]" },
    ] as ModelServer[]
    it("matches trimmed case-insensitive names, Chinese and system IDs", () => {
        expect(filterSortableServers(rows, "  hK- ")).toEqual([
            { server: rows[0], index: 0 }, { server: rows[2], index: 2 },
        ])
        expect(filterSortableServers(rows, "物理机").map(x => x.server.id)).toEqual([91])
        expect(filterSortableServers(rows, "204")).toEqual([{ server: rows[2], index: 2 }])
        expect(filterSortableServers(rows, "2")).toEqual([{ server: rows[2], index: 2 }])
        expect(filterSortableServers(rows, "[test]").map(x => x.server.id)).toEqual([204])
        expect(filterSortableServers(rows, "不存在")).toEqual([])
    })
    it("preserves the full list and global indices after moving a filtered result", () => {
        expect(filterSortableServers(rows, "  ").map(x => x.server)).toEqual(rows)
        const reordered = moveServerToPosition(rows, 204, 2)
        expect(filterSortableServers(reordered, "hk").map(x => [x.server.id, x.index])).toEqual([[91, 0], [204, 1]])
        expect(reordered.map(x => x.id)).toEqual([91, 204, 17])
        expect(rows.map(x => x.id)).toEqual([91, 17, 204])
        expect(filterSortableServers([], "")).toEqual([])
    })
})
