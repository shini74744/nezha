import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBrowserConnectivity } from "@/hooks/use-browser-connectivity";
import type { ConnectivityResult } from "@/lib/connectivity-api";

const targets = (n: number): ConnectivityResult[] =>
	Array.from({ length: n }, (_, i) => ({
		id: String(i),
		name: "Site " + i,
		group: "global",
		host: "site" + i + ".example.com",
		status: "ok",
		samples: [{ status: "ok", delay_ms: 42 }],
		delay_ms: 42,
	}));
afterEach(() => vi.unstubAllGlobals());
function network() {
	let active = 0,
		max = 0;
	const calls: { url: string; signal: AbortSignal; done: () => void }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(_url: string, options: RequestInit) =>
				new Promise<Response>((resolve, reject) => {
					active++;
					max = Math.max(max, active);
					let finished = false;
					const settle = (aborted = false) => {
						if (finished) return;
						finished = true;
						active--;
						aborted
							? reject(new DOMException("Aborted", "AbortError"))
							: resolve({ type: "opaque" } as Response);
					};
					const signal = options.signal!;
					signal.addEventListener("abort", () => settle(true), { once: true });
					calls.push({ url: _url, signal, done: () => settle() });
				}),
		),
	);
	return {
		calls,
		get max() {
			return max;
		},
		get active() {
			return active;
		},
	};
}
describe("browser single-target scheduling", () => {
	it("retests without cooldown, replaces rapid retries and preserves other results", async () => {
		const net = network(),
			input = targets(2),
			{ result } = renderHook(() => useBrowserConnectivity(7));
		act(() => result.current.start(input));
		await act(async () => net.calls.forEach((call) => call.done()));
		await waitFor(() => expect(result.current.run?.state).toBe("complete"));
		const other = result.current.run!.results[1];
		act(() => {
			result.current.retry("0");
			result.current.retry("0");
			result.current.retry("0");
		});
		await waitFor(() => expect(net.calls).toHaveLength(4));
		expect(net.calls[2].signal.aborted).toBe(true);
		expect(result.current.run!.results[1]).toBe(other);
		expect(result.current.run!.fullBatch).toBe(false);
		await act(async () => net.calls[3].done());
		await waitFor(() => expect(result.current.run?.state).toBe("complete"));
		act(() => result.current.retry("0"));
		expect(net.calls).toHaveLength(5);
		await act(async () => net.calls[4].done());
		await waitFor(() => expect(result.current.run?.state).toBe("complete"));
		expect(input[0].delay_ms).toBe(42);
		expect(result.current.run!.results[1]).toBe(other);
	});
	it("allows retries during a batch without duplicate queues or exceeding six requests", async () => {
		const net = network(),
			{ result } = renderHook(() => useBrowserConnectivity(7));
		act(() => result.current.start(targets(8)));
		expect(net.calls).toHaveLength(6);
		act(() => {
			result.current.retry("0");
			result.current.retry("0");
			result.current.retry("7");
		});
		for (let i = 0; i < 6; i++)
			await act(async () => net.calls.slice().forEach((call) => call.done()));
		await waitFor(() => expect(result.current.run?.state).toBe("complete"));
		expect(net.calls).toHaveLength(9);
		expect(net.calls[6].url).toBe("https://site7.example.com/");
		expect(net.max).toBeLessThanOrEqual(6);
		expect(
			result.current.run!.results.every((row) => row.status === "ok"),
		).toBe(true);
	});
	it("stop cancels pending work immediately and a later retry changes only its own row", async () => {
		const net = network(),
			{ result, unmount } = renderHook(() => useBrowserConnectivity(7));
		act(() => result.current.start(targets(9)));
		act(() => result.current.stop());
		expect(net.calls.every((call) => call.signal.aborted)).toBe(true);
		expect(result.current.run!.state).toBe("complete");
		expect(result.current.run!.cancelled).toBe(true);
		await act(async () => {});
		expect(net.calls).toHaveLength(6);
		act(() => result.current.retry("8"));
		expect(net.calls).toHaveLength(7);
		await act(async () => net.calls[6].done());
		await waitFor(() =>
			expect(result.current.run!.results[8].status).toBe("ok"),
		);
		expect(
			result.current
				.run!.results.slice(0, 8)
				.every((row) => row.status === "cancelled"),
		).toBe(true);
		act(() => result.current.retry("8"));
		unmount();
		expect(net.calls[7].signal.aborted).toBe(true);
	});
});
