import type { ConnectivityResult } from "./connectivity-api";
import type { BrowserConnectivityRun } from "./browser-connectivity";

export type ProbeTarget = Pick<ConnectivityResult, "id" | "name" | "group" | "host" | "icon">;
export type ProbeRequest =
 | { type: "start"; id: number; target: ProbeTarget; pageURL: string }
 | { type: "cancel"; id: number };
export type ProbeReply =
 | { type: "ready" }
 | { type: "update" | "complete"; id: number; run: BrowserConnectivityRun };

// Never send cached results, private URLs, or administrator options to the worker.
export function resetProbeTarget({ id, name, group, host, icon }: ProbeTarget): ConnectivityResult {
 return { id, name, group, host, icon, status: "pending", phase: "queued", samples: [] };
}

export function cancelledProbe(run: BrowserConnectivityRun): BrowserConnectivityRun {
 return { state: "complete", cancelled: true, results: run.results.map(row =>
  row.phase === "complete" ? row : { ...row, status: "cancelled", phase: "complete" }) };
}
