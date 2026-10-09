import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, act, fireEvent, cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { AppearanceProvider } from "@/appearance/context";
import { defaults } from "@/appearance/config";
import {
	NativeDesktopSponsor,
	NativeMobileSponsor,
} from "@/appearance/native-sponsor";
import {
	NativeClockPart,
	NativeCounter,
	NativeQuote,
	NativeSideImage,
} from "@/appearance/native-layout-widgets";
import {
	NativeVisitorIP,
	parseVisitorBase,
	visitorText,
} from "@/appearance/native-visitor-ip";
import { NativeParticleEffects } from "@/appearance/native-particles";
import {
	NativeProtection,
	NativeFont,
	NativeAnalytics,
} from "@/appearance/native-environment";
let width = 1366;
function config(keys: string[]) {
	const c = defaults();
	c.enabled = true;
	for (const [key, f] of Object.entries(c.features))
		f.enabled = keys.includes(key);
	return c;
}
beforeEach(() => {
	vi.useFakeTimers();
	width = 1366;
	vi.stubGlobal("innerWidth", width);
	vi.stubGlobal("scrollY", 0);
	vi.stubGlobal(
		"matchMedia",
		vi.fn((q: string) => ({
			matches: q.includes("min-width")
				? width >= Number(q.match(/\d+/)?.[0])
				: q.includes("max-width")
					? width <= Number(q.match(/\d+/)?.[0])
					: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Desktop");
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const advance = async (ms = 50) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
};
function mount(
	c: ReturnType<typeof defaults>,
	children: React.ReactNode,
	path = "/",
) {
	const tree = () => (
		<StrictMode>
			<MemoryRouter initialEntries={[path]}>
				<AppearanceProvider raw={JSON.stringify(c)}>
					{children}
				</AppearanceProvider>
			</MemoryRouter>
		</StrictMode>
	);
	const view = render(tree());
	return { ...view, refresh: () => view.rerender(tree()) };
}
describe("native layout and lifecycle", () => {
	it("sponsor belongs to its layout slot and removes timers on disable", async () => {
		const c = config(["sponsor"]);
		Object.assign(c.features.sponsor, {
			shrinkDuration: 100,
			stayDuration: 300,
			fadeDuration: 100,
		});
		const v = mount(
			c,
			<div data-testid="controls">
				<NativeDesktopSponsor />
			</div>,
		);
		const node = v.container.querySelector("#bmWrap")!;
		expect(node.parentElement).toHaveAttribute("data-native-sponsor-slot");
		expect(document.body.querySelector(":scope > #bmWrap")).toBeNull();
		await advance(150);
		await advance(350);
		await advance(150);
		expect(node).toHaveStyle({ display: "none" });
		c.features.sponsor.enabled = false;
		v.refresh();
		expect(v.container.querySelector("#bmWrap")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("desktop homeOnly and detail layout slots never duplicate", () => {
		const c = config(["sponsor"]);
		const v = mount(
			c,
			<>
				<NativeDesktopSponsor />
				<NativeDesktopSponsor detail />
			</>,
			"/server/1",
		);
		expect(v.container.querySelector("#bmWrap")).toBeNull();
		c.features.sponsor.homeOnly = false;
		v.refresh();
		expect(v.container.querySelectorAll("#bmWrap")).toHaveLength(1);
		expect(
			v.container.querySelector(".nz-sponsor-detail #bmWrap"),
		).not.toBeNull();
	});
	it("mobile sponsor is owned by footer and needs no scroll positioning", () => {
		width = 390;
		const c = config(["sponsor"]);
		const v = mount(
			c,
			<footer>
				<NativeMobileSponsor />
			</footer>,
		);
		const node = v.container.querySelector("#bmWrap")!;
		expect(node.parentElement?.tagName).toBe("FOOTER");
		expect((node as HTMLElement).style.position).toBe("");
		fireEvent.scroll(window);
		expect(v.container.querySelector("#bmWrap")).toBe(node);
		c.features.sponsor.mobile = false;
		v.refresh();
		expect(v.container.querySelector("#bmWrap")).toBeNull();
	});
	it("desktop counter belongs to the header but stays in the screen corner and reacts to scroll", async () => {
		const c = config(["counter"]);
		const v = mount(
			c,
			<header>
				<NativeCounter />
			</header>,
		);
		const slot = v.container.querySelector("[data-native-counter]")!;
		expect(slot.parentElement?.tagName).toBe("HEADER");
		expect(slot).toHaveStyle({ opacity: 1, position: "fixed", top: "0px", right: "0px" });
		vi.stubGlobal("scrollY", 100);
		fireEvent.scroll(window);
		await advance();
		expect(slot).toHaveStyle({ opacity: 0 });
		c.enabled = false;
		v.refresh();
		expect(v.container.querySelector("[data-native-counter]")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("clock colors the supplied time and restores inherited color without scanning DOM", () => {
		const c = config(["clock"]);
		c.features.clock.hourStartColor = "#000000";
		c.features.clock.hourEndColor = "#ffffff";
		const v = mount(
			c,
			<NativeClockPart unit="hour" value={23}>
				23
			</NativeClockPart>,
		);
		expect(v.getByText("23")).toHaveStyle({ color: "rgb(255, 255, 255)" });
		c.enabled = false;
		v.refresh();
		expect(v.getByText("23").style.color).toBe("");
	});
	it("quote aborts pending requests and removes color timers", async () => {
		let signal: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn((_url, options) => {
				signal = options.signal;
				return new Promise((_resolve, reject) =>
					signal!.addEventListener("abort", () => reject(Error("abort"))),
				);
			}),
		);
		const c = config(["quote"]),
			v = mount(c, <NativeQuote />);
		await advance();
		expect(v.container.querySelector("#message")).not.toBeNull();
		c.enabled = false;
		v.refresh();
		await advance();
		expect(signal?.aborted).toBe(true);
		expect(v.container.querySelector("#message")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("quote never requests on mobile", async () => {
		width = 390;
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		mount(config(["quote"]), <NativeQuote />);
		await advance();
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("native particles are bounded, click-through and cleared on unmount", async () => {
		const c = config(["heart", "fragments", "stars"]),
			v = mount(c, <NativeParticleEffects />);
		for (let i = 0; i < 100; i++)
			fireEvent.click(document, { clientX: 20, clientY: 30 });
		await advance();
		expect(
			v.container.querySelectorAll("[data-native-particles] > span").length,
		).toBeLessThanOrEqual(240);
		expect(v.container.querySelector(".heart")).not.toBeNull();
		expect(document.body.querySelector(":scope > .heart")).toBeNull();
		await advance(2300);
		expect(
			v.container.querySelectorAll("[data-native-particles] > span"),
		).toHaveLength(0);
		v.unmount();
		expect(vi.getTimerCount()).toBe(0);
		fireEvent.click(document);
		expect(document.querySelector(".heart")).toBeNull();
	});
	it.each([
		390, 1366,
	])("snow honors count on %i and cleans up", async (viewport) => {
		width = viewport;
		const c = config(["snow"]);
		Object.assign(c.features.snow, { interval: 100, count: 4, mobileCount: 2 });
		const v = mount(c, <NativeParticleEffects />);
		await advance(700);
		expect(v.container.querySelectorAll(".snowflake")).toHaveLength(
			width === 390 ? 2 : 4,
		);
		v.unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("side image supports keyboard movement inside viewport", () => {
		const v = mount(config(["sideImage"]), <NativeSideImage />);
		const node = v.getByRole("button");
		expect(node).toHaveStyle({ left: "50px" });
		fireEvent.keyDown(node, { key: "ArrowRight" });
		expect(node).toHaveStyle({ left: "60px" });
	});
	it("protection leaves inputs editable and removes listeners on disable", () => {
		const c = config(["protection"]);
		const v = mount(
			c,
			<>
				<NativeProtection />
				<input />
				<p>content</p>
			</>,
		);
		expect(fireEvent.contextMenu(v.getByText("content"))).toBe(false);
		expect(fireEvent.contextMenu(v.getByRole("textbox"))).toBe(true);
		c.enabled = false;
		v.refresh();
		expect(fireEvent.contextMenu(v.getByText("content"))).toBe(true);
		expect(v.container.querySelector("[data-native-protection]")).toBeNull();
	});
	it("font and analytics disable without retaining their nodes", () => {
		const c = config(["font", "analytics"]);
		c.features.analytics.measurementId = "G-TEST123";
		const v = mount(
			c,
			<>
				<NativeFont />
				<NativeAnalytics />
			</>,
		);
		expect(document.querySelector("#nz-google-analytics")).not.toBeNull();
		expect(document.querySelector("[data-native-font]")).not.toBeNull();
		c.enabled = false;
		v.refresh();
		expect(
			document.querySelector("#nz-google-analytics,[data-native-font]"),
		).toBeNull();
		expect((window as any)["ga-disable-G-TEST123"]).toBe(true);
	});
});
const full = {
	ip: "203.0.113.9",
	country: "Japan",
	city: "Tokyo",
	asn: "AS64500",
	org: "AS64500 Example Net",
};
function ipConfig() {
	const c = config(["visitorIP"]);
	Object.assign(c.features.visitorIP, {
		ipApiUrls: ["https://ip.test/json"],
		fallbackUrl: "https://fallback.test/json",
		queryTimeout: 500,
		fallbackTimeout: 600,
		checkTimeout: 700,
		switchTimeout: 800,
		checkNodes: [
			{ name: "First", url: "https://one.test/ping" },
			{ name: "Second", url: "https://two.test/ping" },
		],
	});
	return c;
}
describe("native visitor information", () => {
	it("uses configured endpoints and cycles only one probe on click", async () => {
		const requests: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url) => {
				requests.push(url);
				return new Response(
					url.includes("/json") ? JSON.stringify(full) : null,
				);
			}),
		);
		// No StrictMode here: verify one mounted feature's request budget.
		const c = ipConfig(),
			v = render(
				<AppearanceProvider raw={JSON.stringify(c)}>
					<NativeVisitorIP />
				</AppearanceProvider>,
			);
		await advance();
		expect(requests).toEqual([
			"https://ip.test/json",
			"https://one.test/ping",
			"https://two.test/ping",
		]);
		expect(v.container.querySelector("#ip-base")?.textContent).toBe(
			"203.0.113.9 ｜ Japan · Tokyo ｜ AS64500 Example Net",
		);
		fireEvent.click(v.getByRole("button"));
		await advance();
		expect(requests[requests.length - 1]).toBe("https://two.test/ping");
		expect(v.getByRole("button")).toHaveTextContent("Second");
	});
	it("fills missing metadata through configured fallback", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async (url) =>
					new Response(
						JSON.stringify(url.includes("fallback") ? full : { ip: full.ip }),
					),
			),
		);
		const c = ipConfig();
		c.features.visitorIP.networkEnabled = false;
		const v = mount(c, <NativeVisitorIP />);
		await advance();
		expect(v.container.querySelector("#ip-base")).toHaveTextContent(
			"AS64500 Example Net",
		);
	});
	it("mobile only fetches IP and region, with no network probes", async () => {
		width = 390;
		const fetcher = vi.fn(async () => new Response(JSON.stringify(full)));
		vi.stubGlobal("fetch", fetcher);
		const c = ipConfig();
		const v = render(
			<AppearanceProvider raw={JSON.stringify(c)}>
				<NativeVisitorIP />
			</AppearanceProvider>,
		);
		await advance();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(v.queryByRole("button")).toBeNull();
		expect(v.container.querySelector("#ip-base")).toHaveTextContent(
			"203.0.113.9 ｜ Japan · Tokyo",
		);
	});
	it("timeout and disabling abort pending requests without resurrecting a bar", async () => {
		const signals: AbortSignal[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_url, options) =>
					new Promise((_resolve, reject) => {
						signals.push(options.signal);
						options.signal.addEventListener("abort", () =>
							reject(Error("abort")),
						);
					}),
			),
		);
		const c = ipConfig(),
			v = mount(c, <NativeVisitorIP />);
		await advance(650);
		expect(v.container.querySelector("#ip-base")).toHaveTextContent(
			"无法获取IP信息",
		);
		expect(signals.every((s) => s.aborted)).toBe(true);
		c.enabled = false;
		v.refresh();
		await advance();
		expect(v.container.querySelector("#ip-bar")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("rejects malformed cached data and respects zero cache duration", async () => {
		const c = ipConfig();
		c.features.visitorIP.networkEnabled = false;
		c.features.visitorIP.cacheDuration = 0;
		localStorage.setItem(
			"nezha_ip_bar_cache_v6",
			JSON.stringify({
				ts: Date.now(),
				source: JSON.stringify([
					c.features.visitorIP.ipApiUrls,
					c.features.visitorIP.fallbackUrl,
				]),
				base: { ip: "bad" },
			}),
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(full))),
		);
		const v = mount(c, <NativeVisitorIP />);
		await advance();
		expect(v.container.querySelector("#ip-base")).toHaveTextContent(full.ip);
		expect(localStorage.getItem("nezha_ip_bar_cache_v6")).toContain("bad");
	});
	it("display flags do not leak suppressed ASN through organization", () => {
		const c = ipConfig();
		Object.assign(c.features.visitorIP, { showASN: false, showRegion: false });
		expect(
			visitorText(parseVisitorBase(full), c.features.visitorIP, true),
		).toBe("203.0.113.9 ｜ Example Net");
	});
});
