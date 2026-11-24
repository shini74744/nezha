import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VisitorDownload } from "../../../../appearance/site/visitor-download";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function payload(size: number) {
	return new Response(new Uint8Array(size), {
		headers: { "Content-Type": "application/octet-stream" },
	});
}

it("measures received bytes on click and allows a new measurement", async () => {
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	const fetcher = vi.fn(async (url: string, options: RequestInit) => {
		expect(options.cache).toBe("no-store");
		const bytes = Number(new URL(url).searchParams.get("bytes"));
		now += bytes / 2500;
		return payload(bytes);
	});
	vi.stubGlobal("fetch", fetcher);
	const { getByRole } = render(<VisitorDownload />);
	const button = getByRole("button");
	expect(fetcher).not.toHaveBeenCalled();
	for (const calls of [2, 4]) {
		await act(async () => {
			fireEvent.click(button);
			fireEvent.click(button);
		});
		expect(button).toHaveTextContent("20.00 Mbps");
		expect(fetcher).toHaveBeenCalledTimes(calls);
	}
});

it("uses a larger sample after a short transfer within the 8 MiB budget", async () => {
	let now = 0;
	const sizes: number[] = [];
	vi.spyOn(performance, "now").mockImplementation(() => now);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const bytes = Number(new URL(url).searchParams.get("bytes"));
			sizes.push(bytes);
			now += sizes.length === 1 ? 300 : bytes / 10000;
			return payload(bytes);
		}),
	);
	const { getByRole } = render(<VisitorDownload />);
	await act(async () => {
		fireEvent.click(getByRole("button"));
	});
	expect(getByRole("button")).toHaveTextContent("Cloudflare ↓ 80.00 Mbps");
	expect(sizes).toHaveLength(3);
	expect(sizes[2]).toBeGreaterThan(sizes[1]);
	expect(sizes.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(
		8 * 1024 * 1024,
	);
});

it.each([
	() => new Response(null, { status: 503 }),
	() => new Response("portal", { headers: { "Content-Type": "text/html" } }),
	() => payload(7),
])("rejects unusable samples and enables retry", async (invalid) => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => invalid()),
	);
	const { getByRole } = render(<VisitorDownload />);
	await act(async () => {
		fireEvent.click(getByRole("button"));
	});
	expect(getByRole("button")).toHaveTextContent("测速失败");
	expect(getByRole("button")).toBeEnabled();
});

it("times out, then cancels a retry when the widget leaves the page", async () => {
	vi.useFakeTimers();
	const signals: AbortSignal[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					const signal = options.signal as AbortSignal;
					signals.push(signal);
					signal.addEventListener("abort", () => reject(new Error("abort")), {
						once: true,
					});
				}),
		),
	);
	const view = render(<VisitorDownload />);
	const button = view.getByRole("button");
	fireEvent.click(button);
	expect(button).toBeDisabled();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(12000);
	});
	expect(button).toHaveTextContent("测速超时");
	fireEvent.click(button);
	view.unmount();
	expect(signals).toHaveLength(2);
	expect(signals.every((signal) => signal.aborted)).toBe(true);
});
