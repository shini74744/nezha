import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserConnectivityRunner, PROBE_WORKER_STARTUP_MS } from "@/lib/browser-connectivity-worker-client";
import type { ProbeReply, ProbeRequest } from "@/lib/browser-connectivity-worker-protocol";
import type { ConnectivityResult } from "@/lib/connectivity-api";

const target: ConnectivityResult = { id: "youtube", name: "YouTube", group: "usa", host: "yt3.ggpht.com",
 status: "ok", phase: "complete", samples: [{ status: "ok", delay_ms: 999 }], delay_ms: 999 };
class FakeWorker {
 static instances: FakeWorker[] = [];
 onmessage: ((event: MessageEvent<ProbeReply>) => void) | null = null;
 onerror: ((event: ErrorEvent) => void) | null = null;
 onmessageerror: (() => void) | null = null;
 postMessage = vi.fn<(packet: ProbeRequest) => void>();
 terminate = vi.fn();
 constructor() { FakeWorker.instances.push(this); }
 reply(data: ProbeReply) { this.onmessage?.({ data } as MessageEvent<ProbeReply>); }
}
const progress = (delay = 12) => ({ state: "running" as const, cancelled: false, results: [{
 ...target, phase: "running" as const, samples: [{ status: "ok" as const, delay_ms: delay }], delay_ms: delay,
}] });
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("local worker transport", () => {
 it("shares one worker, preserves worker timings and streams partial results before completion", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const runner = createBrowserConnectivityRunner("https://panel.example.org/server/7");
  const first = vi.fn(), second = vi.fn();
  const a = runner.run({ ...target, url: "https://private.example.org/?secret=1" } as any, new AbortController().signal, first);
  const b = runner.run({ ...target, id: "other" }, new AbortController().signal, second);
  expect(FakeWorker.instances).toHaveLength(1);
  const worker = FakeWorker.instances[0];
  expect(worker.postMessage).not.toHaveBeenCalled();
  worker.reply({ type: "ready" });
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  const packet = worker.postMessage.mock.calls[0][0];
  expect(packet).toMatchObject({ type: "start", pageURL: "https://panel.example.org/server/7" });
  expect(JSON.stringify(packet)).not.toMatch(/private|secret|999/);
  worker.reply({ type: "update", id: 1, run: progress(0) });
  expect(first).toHaveBeenCalledWith(progress(0));
  expect(second).not.toHaveBeenCalled();
  worker.reply({ type: "complete", id: 2, run: { ...progress(20), state: "complete" } });
  worker.reply({ type: "complete", id: 1, run: { ...progress(12.345), state: "complete" } });
  expect((await a).results[0].delay_ms).toBe(12.345);
  expect((await b).results[0].delay_ms).toBe(20);
  expect(fetcher).not.toHaveBeenCalled();
  runner.dispose(); expect(worker.terminate).toHaveBeenCalledTimes(1);
 });
 it("waits for cancellation acknowledgement, retains dots and ignores late worker messages", async () => {
  const runner = createBrowserConnectivityRunner(), controller = new AbortController(), update = vi.fn();
  const promise = runner.run(target, controller.signal, update), worker = FakeWorker.instances[0];
  worker.reply({ type: "ready" });
  worker.reply({ type: "update", id: 1, run: progress(10) });
  controller.abort();
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "cancel", id: 1 });
  worker.reply({ type: "update", id: 1, run: progress(88) });
  worker.reply({ type: "complete", id: 1, run: { ...progress(99), state: "complete" } });
  const run = await promise;
  expect(run.cancelled).toBe(true); expect(run.results[0].samples[0].delay_ms).toBe(10);
  expect(update).toHaveBeenCalledTimes(1);
  worker.reply({ type: "update", id: 1, run: progress(77) });
  expect(update).toHaveBeenCalledTimes(1); runner.dispose();
 });
 it("cancels before startup without sending probes and disposes pending work", async () => {
  const runner = createBrowserConnectivityRunner(), c = new AbortController(), w = FakeWorker.instances[0];
  const p = runner.run(target, c.signal, vi.fn()); c.abort();
  expect((await p).cancelled).toBe(true);
  w.reply({ type: "ready" }); expect(w.postMessage).not.toHaveBeenCalled();
  const pending = runner.run(target, new AbortController().signal, vi.fn());
  runner.dispose(); runner.dispose();
  expect((await pending).cancelled).toBe(true);
  expect(w.terminate).toHaveBeenCalledTimes(1);
  expect((await runner.run(target, new AbortController().signal, vi.fn())).cancelled).toBe(true);
 });
 it.each(["missing", "constructor", "error", "messageerror", "post", "startup", "stalled"])(
  "falls back without hanging when the worker is %s", async mode => {
   vi.useFakeTimers();
   const fetcher = vi.fn().mockResolvedValue({ type: "opaque" }); vi.stubGlobal("fetch", fetcher);
   if (mode === "missing") vi.stubGlobal("Worker", undefined);
   if (mode === "constructor") vi.stubGlobal("Worker", class { constructor() { throw Error("CSP"); } });
   const runner = createBrowserConnectivityRunner("https://panel.example.org/"), update = vi.fn();
   const p = runner.run(target, new AbortController().signal, update), w = FakeWorker.instances[0];
   if (mode === "error") w.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
   if (mode === "messageerror") w.onmessageerror?.();
   if (mode === "post") { w.postMessage.mockImplementation(() => { throw Error("closed"); }); w.reply({ type: "ready" }); }
   if (mode === "startup") await vi.advanceTimersByTimeAsync(PROBE_WORKER_STARTUP_MS);
   if (mode === "stalled") { w.reply({ type: "ready" }); await vi.advanceTimersByTimeAsync(41000); }
   const run = await p;
   expect(run.results[0].samples).toHaveLength(10); expect(run.results[0].status).toBe("ok");
   expect(fetcher).toHaveBeenCalledTimes(12);
   expect(update.mock.calls.map(([r]) => r.results[0].samples.length)).toEqual([0,1,2,3,4,5,6,7,8,9,10]);
   runner.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
 it("passes the document host into fallback validation instead of the worker asset URL", async () => {
  vi.stubGlobal("Worker", undefined); const f = vi.fn(); vi.stubGlobal("fetch", f);
  const runner = createBrowserConnectivityRunner("https://yt3.ggpht.com/");
  const run = await runner.run(target, new AbortController().signal, vi.fn());
  expect(run.results[0].status).toBe("browser_unsupported"); expect(f).not.toHaveBeenCalled(); runner.dispose();
 });
 it("aborts fallback requests on dispose without admitting another round", async () => {
  vi.useFakeTimers(); vi.stubGlobal("Worker", undefined);
  let signal: AbortSignal | undefined;
  const f = vi.fn((_url, options) => new Promise((_resolve, reject) => {
   signal = options.signal; signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })); vi.stubGlobal("fetch", f);
  const runner = createBrowserConnectivityRunner(), p = runner.run(target, new AbortController().signal, vi.fn());
  runner.dispose();
  expect(signal?.aborted).toBe(true); expect((await p).cancelled).toBe(true);
  await vi.runAllTimersAsync(); expect(f).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
 });
});
