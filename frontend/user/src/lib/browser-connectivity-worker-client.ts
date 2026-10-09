import type { ConnectivityResult } from "./connectivity-api";
import {
 BROWSER_PROBE_ROUNDS, BROWSER_PROBE_TIMEOUT_MS, BROWSER_PROBE_WARMUPS,
 runBrowserConnectivity, type BrowserConnectivityRun,
} from "./browser-connectivity";
import { cancelledProbe, resetProbeTarget, type ProbeReply, type ProbeRequest } from "./browser-connectivity-worker-protocol";

export const PROBE_WORKER_STARTUP_MS = 3000;
const JOB_TIMEOUT_MS = (BROWSER_PROBE_WARMUPS + BROWSER_PROBE_ROUNDS) * BROWSER_PROBE_TIMEOUT_MS + 5000;
type Job = {
 id: number; target: ConnectivityResult; signal: AbortSignal; controller: AbortController;
 latest: BrowserConnectivityRun; update: (run: BrowserConnectivityRun) => void;
 resolve: (run: BrowserConnectivityRun) => void; abort: () => void;
 timer?: ReturnType<typeof setTimeout>; direct?: boolean;
};

// One worker per local session, shared by the existing bounded target scheduler.
// Only finished sample durations cross threads: UI/message delays are never timed.
export function createBrowserConnectivityRunner(pageURL: string = location.href) {
 let worker: Worker | undefined, ready = false, disposed = false, nextID = 0;
 let startup: ReturnType<typeof setTimeout> | undefined;
 const jobs = new Map<number, Job>();
 const finish = (job: Job, run: BrowserConnectivityRun) => {
  if (!jobs.delete(job.id)) return;
  clearTimeout(job.timer);
  job.signal.removeEventListener("abort", job.abort);
  job.resolve(run);
 };
 const publish = (job: Job, run: BrowserConnectivityRun) => {
  if (!jobs.has(job.id) || job.signal.aborted) return;
  job.latest = run;
  job.update(run);
 };
 const direct = (job: Job) => {
  if (job.direct || !jobs.has(job.id)) return;
  job.direct = true;
  clearTimeout(job.timer);
  if (job.signal.aborted) { finish(job, cancelledProbe(job.latest)); return; }
  // On worker failure start a fresh set; never mix partial runs or clock domains.
  void runBrowserConnectivity([job.target], job.controller.signal,
   run => publish(job, run), pageURL
  ).then(run => finish(job, run), () => finish(job, { state: "complete", cancelled: job.signal.aborted,
   results: [{ ...job.target, phase: "complete", status: job.signal.aborted ? "cancelled" : "browser_error" }] }));
 };
 const terminate = () => {
  clearTimeout(startup);
  if (worker) {
   worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
   worker.terminate(); worker = undefined;
  }
  ready = false;
 };
 const fallback = () => {
  terminate();
  for (const job of jobs.values()) direct(job);
 };
 const send = (message: ProbeRequest) => {
  try { worker?.postMessage(message); } catch { fallback(); }
 };
 const start = (job: Job) => {
  if (!worker) { direct(job); return; }
  if (!ready) return;
  job.timer = setTimeout(fallback, JOB_TIMEOUT_MS);
  send({ type: "start", id: job.id, target: job.target, pageURL });
 };
 try {
  if (typeof Worker !== "undefined") {
   worker = new Worker(new URL("./browser-connectivity.worker.ts", import.meta.url), {
    type: "module", name: "nezha-local-connectivity",
   });
   worker.onmessage = ({ data }: MessageEvent<ProbeReply>) => {
    if (data?.type === "ready") {
     if (ready) return;
     ready = true; clearTimeout(startup);
     for (const job of jobs.values()) start(job);
     return;
    }
    if (!data || !("id" in data)) return;
    const job = jobs.get(data.id);
    if (!job) return; // Late messages from an aborted/replaced target are ignored.
    if (data.type === "update") publish(job, data.run);
    else if (data.type === "complete") finish(job, job.signal.aborted ? cancelledProbe(job.latest) : data.run);
   };
   worker.onerror = event => { event.preventDefault(); fallback(); };
   worker.onmessageerror = fallback;
   startup = setTimeout(fallback, PROBE_WORKER_STARTUP_MS);
  }
 } catch { terminate(); }

 return {
  run(target: ConnectivityResult, signal: AbortSignal, update: (run: BrowserConnectivityRun) => void): Promise<BrowserConnectivityRun> {
   const clean = resetProbeTarget(target);
   const initial: BrowserConnectivityRun = { state: "running", cancelled: false, results: [clean] };
   if (disposed || signal.aborted) return Promise.resolve(cancelledProbe(initial));
   return new Promise(resolve => {
    const job: Job = { id: ++nextID, target: clean, signal, controller: new AbortController(), latest: initial,
     update, resolve, abort: () => {
      job.controller.abort();
      if (job.direct) return;
      if (!ready || !worker) finish(job, cancelledProbe(job.latest));
      else send({ type: "cancel", id: job.id });
     } };
    jobs.set(job.id, job);
    signal.addEventListener("abort", job.abort, { once: true });
    start(job);
   });
  },
  dispose() {
   if (disposed) return;
   disposed = true; terminate();
   for (const job of jobs.values()) {
    job.controller.abort();
    finish(job, cancelledProbe(job.latest));
   }
  },
 };
}
export type BrowserConnectivityRunner = ReturnType<typeof createBrowserConnectivityRunner>;
