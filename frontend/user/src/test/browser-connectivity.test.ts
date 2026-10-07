import { afterEach, describe, expect, it, vi } from "vitest";
import { browserProbeURL, runBrowserConnectivity, BROWSER_PROBE_TIMEOUT_MS, BROWSER_PROBE_WORKERS } from "@/lib/browser-connectivity";
import type { ConnectivityResult } from "@/lib/connectivity-api";
const targets = (count = 1): ConnectivityResult[] => Array.from({ length: count }, (_, i) => ({
	id: "site-" + i, name: "Site " + i, group: "global", host: "www.example.com",
	status: "ok", phase: "complete", samples: [{ status: "ok", delay_ms: 12 }], delay_ms: 12,
}));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("safe browser destination", () => {
	it.each(["example.com", "WWW.Example.COM", "xn--bcher-kva.de", "1.1.1.1"])("accepts public catalog host %s", host => {
		expect(browserProbeURL(host, "https://panel.example.org/")).toBe("https://" + host.toLowerCase() + "/");
	});
	it.each(["", "localhost", "127.0.0.1", "10.0.0.1", "[::1]", "2130706433", "0x7f000001",
		"www.example.com:443", "www.example.com:80", "a.local", "foo.internal", "foo.lan", "x.home", "x.test",
		"www.example.com/path", "www.example.com?key=secret", "www.example.com#x", "www.example.com@evil.org",
		" www.example.com", "www.example.com ", "www.example.com.", "www..example.com", "https://www.example.com",
		"www.example.com\\evil.org", "PANEL.example.org"])("rejects unsafe or panel host %s", host => {
		expect(browserProbeURL(host, "https://panel.example.org/")).toBeUndefined();
	});
});

describe("ephemeral browser probes", () => {
	it("uses credential-free uncached HEAD, accepts opaque replies and never changes the server snapshot", async () => {
		const fetcher = vi.fn().mockResolvedValue({ type: "opaque", status: 0, ok: false });
		vi.stubGlobal("fetch", fetcher);
		const original = targets(2), before = JSON.stringify(original);
		const updates: unknown[] = [];
		const result = await runBrowserConnectivity(original, new AbortController().signal, run => updates.push(run));
		expect(result.state).toBe("complete");
		expect(result.results.every(r => r.status === "ok" && r.samples.length === 1 && r.delay_ms! >= 0)).toBe(true);
		expect(JSON.stringify(original)).toBe(before);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher.mock.calls[0][0]).toBe("https://www.example.com/");
		expect(fetcher.mock.calls[0][1]).toMatchObject({
			method: "HEAD", mode: "no-cors", credentials: "omit", cache: "no-store",
			referrerPolicy: "no-referrer", redirect: "follow", signal: expect.any(AbortSignal),
		});
		expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
		expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
		expect(updates.length).toBeGreaterThan(0);
	});
	it("uses the required follow mode for no-cors and times the final opaque response", async () => {
		const fetcher = vi.fn().mockResolvedValue({ type: "opaque", status: 0, redirected: true });
		vi.stubGlobal("fetch", fetcher);
		const result = await runBrowserConnectivity(targets(), new AbortController().signal, () => {});
		expect(result.results[0].status).toBe("ok");
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("does not label a browser/CORS/CORP rejection as a node outage", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		const result = await runBrowserConnectivity(targets(), new AbortController().signal, () => {});
		expect(result.results[0]).toMatchObject({ status: "browser_error", phase: "complete", delay_ms: undefined });
	});
	it("rejects unsupported destinations without network access", async () => {
		const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
		const result = await runBrowserConnectivity([{ ...targets()[0], host: "192.168.1.1" }], new AbortController().signal, () => {});
		expect(result.results[0].status).toBe("browser_unsupported");
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("bounds simultaneous requests and times them out before admitting queued work", async () => {
		vi.useFakeTimers();
		let active = 0, peak = 0;
		const fetcher = vi.fn((_url, options) => new Promise((_resolve, reject) => {
			active++; peak = Math.max(active, peak);
			options.signal.addEventListener("abort", () => { active--; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
		}));
		vi.stubGlobal("fetch", fetcher);
		const promise = runBrowserConnectivity(targets(13), new AbortController().signal, () => {});
		expect(fetcher).toHaveBeenCalledTimes(BROWSER_PROBE_WORKERS);
		await vi.advanceTimersByTimeAsync(BROWSER_PROBE_TIMEOUT_MS * 3);
		const result = await promise;
		expect(peak).toBe(BROWSER_PROBE_WORKERS);
		expect(active).toBe(0);
		expect(result.results.every(r => r.status === "timeout")).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("aborts active requests and never starts queued requests after cancellation", async () => {
		vi.useFakeTimers();
		const signals: AbortSignal[] = [];
		vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
			signals.push(options.signal);
			options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
		})));
		const controller = new AbortController();
		const promise = runBrowserConnectivity(targets(100), controller.signal, () => {});
		controller.abort();
		const result = await promise;
		expect(signals).toHaveLength(BROWSER_PROBE_WORKERS);
		expect(signals.every(signal => signal.aborted)).toBe(true);
		expect(result.cancelled).toBe(true);
		expect(result.results.every(r => r.status === "cancelled")).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("does no work for an already cancelled run and caps malformed oversized catalogs", async () => {
		const fetcher = vi.fn().mockResolvedValue({ type: "opaque" }); vi.stubGlobal("fetch", fetcher);
		const controller = new AbortController(); controller.abort();
		await runBrowserConnectivity(targets(), controller.signal, () => {});
		expect(fetcher).not.toHaveBeenCalled();
		const result = await runBrowserConnectivity(targets(200), new AbortController().signal, () => {});
		expect(result.results).toHaveLength(120);
		expect(fetcher).toHaveBeenCalledTimes(120);
	});
});
