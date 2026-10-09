import { BROWSER_PROBE_WORKERS, runBrowserConnectivity } from "./browser-connectivity";
import { resetProbeTarget, type ProbeReply, type ProbeRequest } from "./browser-connectivity-worker-protocol";

// Dedicated worker: both timestamps, timeouts and every sample stay off the UI thread.
const port = globalThis as unknown as {
 onmessage: ((event: MessageEvent<ProbeRequest>) => void) | null;
 postMessage: (message: ProbeReply) => void;
};
const active = new Map<number, AbortController>();
port.onmessage = ({ data }) => {
 if (data.type === "cancel") { active.get(data.id)?.abort(); return; }
 if (data.type !== "start" || !Number.isSafeInteger(data.id) || active.has(data.id)) return;
 const target = resetProbeTarget(data.target);
 // The main scheduler admits at most six targets. Keep a worker-side guard too.
 if (active.size >= BROWSER_PROBE_WORKERS) {
  port.postMessage({ type: "complete", id: data.id, run: { state: "complete", cancelled: false,
   results: [{ ...target, phase: "complete", status: "browser_error" }] } });
  return;
 }
 const controller = new AbortController();
 active.set(data.id, controller);
 void runBrowserConnectivity([target], controller.signal,
  run => port.postMessage({ type: "update", id: data.id, run }), data.pageURL
 ).then(run => {
  active.delete(data.id);
  port.postMessage({ type: "complete", id: data.id, run });
 }, () => {
  active.delete(data.id);
  port.postMessage({ type: "complete", id: data.id, run: { state: "complete", cancelled: controller.signal.aborted,
   results: [{ ...target, phase: "complete", status: controller.signal.aborted ? "cancelled" : "browser_error" }] } });
 });
};
port.postMessage({ type: "ready" });
