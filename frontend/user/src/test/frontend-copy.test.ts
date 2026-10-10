// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import zh from "../locales/zh-CN/translation.json";
const source = (f: string) => readFileSync(new URL("../components/" + f, import.meta.url), "utf8");
describe("public-facing Chinese copy", () => {
 it("uses plain language for connection, history and service errors", () => {
  expect(zh.info.websocketConnecting).toBe("监控连接中");
  expect(zh.info.websocketConnected).toBe("监控已连接");
  expect(zh.info.websocketDisconnected).toBe("监控连接已断开");
  expect(zh.serverDetailChart.tsdbRequired).toBe("历史记录未启用");
  expect(zh.error.backendUnavailableTitle).toBe("暂时无法获取监控数据");
 });
 it("keeps connectivity permissions and timing meaning", () => {
  expect(zh.connectivity.readOnly).toContain("仅管理员或服务器所属用户");
  expect(zh.connectivity.help).toContain("HTTP 请求耗时，并非 Ping 延迟");
  expect(zh.connectivity.status.agent_timeout).toBe("节点未响应，检测超时");
  expect(zh.connectivity.offline).toContain("已有结果仅供参考");
 });
 it("retains interpretation warnings on maps and BGP", () => {
  expect(source("ReturnRouteMap.tsx")).toContain("不代表实际机房或光缆路径");
  expect(source("BGPTopology.tsx")).toContain("BGP 路由观测不代表实际流量路径、网络质量或延迟");
  expect(source("BGPSnapshotCompare.tsx")).toContain("不代表全网新增或撤销");
  expect(source("ServerReturnRoute.tsx")).toContain("未响应不代表故障");
 });
 it("keeps old and offline records clearly incomplete or non-live", () => {
  expect(source("BGPTopology.tsx")).toContain("旧记录信息不完整");
  expect(source("OfflineServerDetail.tsx")).toContain("非实时数据");
  expect(source("OfflineServerDetail.tsx")).toContain("未保存的数据不能补回");
 });
 it("history comparison does not promise a fresh detection", () => {
  for (const f of ["BGPSnapshotCompare.tsx","ReturnRouteCompare.tsx"])
   expect(source(f)).toContain("对比两次历史检测结果，不会重新检测。");
 });
});
