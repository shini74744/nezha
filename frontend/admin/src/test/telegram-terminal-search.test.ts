import { describe, expect, it } from "vitest"
import { searchTerminalServers } from "../telegram-terminal/search"
const rows = [
 { id: 17, name: "HK.香港母鸡 1", online: true },
 { id: 21, name: "JP.日本服务器", online: false },
 { id: 71, name: "hk 香港 2", online: true },
]
describe("terminal server search", () => {
 it("matches partial names, IDs, multiple keywords and full width letters", () => {
  expect(searchTerminalServers(rows, "hK 香港", false).map(x => x.id)).toEqual([17,71])
  expect(searchTerminalServers(rows, "１７", false).map(x => x.id)).toEqual([17])
  expect(searchTerminalServers(rows, "日本", false).map(x => x.id)).toEqual([21])
  expect(searchTerminalServers(rows, "日本", true)).toEqual([])
  expect(searchTerminalServers(rows, "", false)).toEqual(rows)
  expect(searchTerminalServers(rows, "unknown", false)).toEqual([])
 })
})
