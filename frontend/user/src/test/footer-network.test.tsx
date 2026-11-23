import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaults } from "@/appearance/config";
import {
	FooterNetworkCard,
	footerRequest,
	isBuiltInFooterURL,
	parseFooterIP,
} from "@/appearance/footer-network";

let settings = defaults().features.visitorIP;
vi.mock("@/appearance/context", () => ({ useFeature: () => settings }));
const requests: string[] = [];
beforeEach(() => {
	requests.length = 0;
	settings = {
		...defaults().features.visitorIP,
		ipApiUrls: ["https://ip.test/json"],
		queryTimeout: 200,
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			requests.push(url);
			if (url.includes("cdn-cgi/trace"))
				return new Response("ip=2001:db8::42\nloc=JP\n");
			if (url.includes("/json") || url.includes("geoip"))
				return new Response(
					JSON.stringify({
						ip: "203.0.113.8",
						country: "Japan",
						city: "Tokyo",
						org: "AS64500 Example Network",
					}),
				);
			return new Response("");
		}),
	);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: vi.fn().mockResolvedValue(undefined) },
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
const settle = () =>
	act(async () => {
		for (let i = 0; i < 20; i++) await Promise.resolve();
	});
it("recognizes only the legacy built-in pages and preserves custom URLs", () => {
	for (const url of [
		"https://network.example.invalid/sample-2",
		"https://ip.skk.moe/simple/",
		"https://embed-legacy.ip.skk.moe/simple-dark/",
	])
		expect(isBuiltInFooterURL(url)).toBe(true);
	for (const url of [
		"https://custom.test/simple-dark",
		"https://ip.skk.moe/other",
		"https://ip.skk.moe/simple?custom=yes",
		"invalid",
	])
		expect(isBuiltInFooterURL(url)).toBe(false);
});
it("loads only on visibility; re-opening reuses completed results; manual retry reruns", async () => {
	const close = vi.fn(),
		view = render(<FooterNetworkCard active={false} onClose={close} />);
	await settle();
	expect(requests).toHaveLength(0);
	view.rerender(<FooterNetworkCard active onClose={close} />);
	await settle();
	expect(requests).toHaveLength(7);
	expect(screen.getByRole("button", { name: "重新检测网络" })).toBeEnabled();
	fireEvent.click(screen.getByRole("button", { name: "查看全部检测来源" }));
	expect(screen.getByText("2001:db8::42")).toBeInTheDocument();
	view.rerender(<FooterNetworkCard active={false} onClose={close} />);
	await settle();
	view.rerender(<FooterNetworkCard active onClose={close} />);
	await settle();
	expect(requests).toHaveLength(7);
	fireEvent.click(screen.getByRole("button", { name: "重新检测网络" }));
	await settle();
	expect(requests).toHaveLength(14);
	fireEvent.click(screen.getByRole("button", { name: "收起网络信息" }));
	expect(close).toHaveBeenCalledOnce();
});
it("a failed provider does not discard working sources and a failed probe never becomes 0 ms", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url.includes("geoip") || url.includes("bilibili"))
				throw Error("offline");
			if (url.includes("cdn-cgi/trace"))
				return new Response("ip=2001:db8::1\nloc=US");
			return new Response(JSON.stringify({ ip: "203.0.113.9" }));
		}),
	);
	render(<FooterNetworkCard active onClose={() => {}} />);
	await settle();
	expect(screen.getByText("203.0.113.9")).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "查看全部检测来源" }));
	expect(screen.getAllByText("暂不可用")).toHaveLength(2);
	expect(screen.getByText("Bilibili").parentElement).toHaveTextContent(
		"暂不可用",
	);
	expect(screen.getByText("Bilibili").parentElement).not.toHaveTextContent(
		"ms",
	);
});
it("copies the full IPv6 address, reports clipboard failure and renders provider markup as text", async () => {
	render(<FooterNetworkCard active onClose={() => {}} />);
	await settle();
	fireEvent.click(screen.getByRole("button", { name: "查看全部检测来源" }));
	fireEvent.click(screen.getByRole("button", { name: "复制 Cloudflare IP" }));
	await settle();
	expect(navigator.clipboard.writeText).toHaveBeenCalledWith("2001:db8::42");
	expect(screen.getByRole("status")).toHaveTextContent("IP 已复制");
	vi.mocked(navigator.clipboard.writeText).mockRejectedValue(Error("denied"));
	fireEvent.click(screen.getByRole("button", { name: "复制 Cloudflare IP" }));
	await settle();
	expect(screen.getByRole("status")).toHaveTextContent("复制失败");
	expect(
		parseFooterIP(
			{ ip: "203.0.113.8", org: "<img src=x onerror=alert(1)>" },
			settings,
		).detail,
	).toContain("<img");
});
it("respects display settings, numeric ASN and rejects unusable provider data", () => {
	expect(
		parseFooterIP(
			{ ip: "2001:db8::1", country: "JP", asn: 64500, organization: "Example" },
			settings,
		),
	).toEqual({ ip: "2001:db8::1", detail: "JP · AS64500 · Example" });
	expect(
		parseFooterIP(
			{ ip: "203.0.113.1", country: "JP", asn: 64500, org: "Example" },
			{ showRegion: false, showASN: false, showOrganization: false },
		).detail,
	).toBe("");
	expect(() => parseFooterIP({ ip: "<script>" }, settings)).toThrow();
});
it("times out slow requests and aborts on hide without stale results or leaked timers", async () => {
	vi.useFakeTimers();
	const signals: AbortSignal[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(_url: string, options: RequestInit) =>
				new Promise((_resolve, reject) => {
					const signal = options.signal;
					if (!signal) throw Error("Missing abort signal");
					signals.push(signal);
					signal.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
		),
	);
	const view = render(<FooterNetworkCard active onClose={() => {}} />);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(201);
	});
	expect(screen.getAllByText("请求超时")).toHaveLength(1);
	view.rerender(<FooterNetworkCard active={false} onClose={() => {}} />);
	await settle();
	expect(signals.every((s) => s.aborted)).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});
it("rejects HTTP errors and treats caller cancellation separately from provider failure", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("blocked", { status: 403 })),
	);
	vi.useFakeTimers();
	const c = new AbortController();
	expect(
		await footerRequest(
			{ id: "p", name: "p", url: "https://p.test" },
			c.signal,
			100,
			false,
			settings,
		),
	).toEqual({ error: "暂不可用" });
	c.abort();
	await expect(
		footerRequest(
			{ id: "p", name: "p", url: "https://p.test" },
			c.signal,
			100,
			false,
			settings,
		),
	).rejects.toMatchObject({ name: "AbortError" });
	expect(vi.getTimerCount()).toBe(0);
});
