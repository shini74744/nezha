import { reorderServers } from "@/components/server-sort-dialog"
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
