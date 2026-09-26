import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaults, normalize, validate } from "@/appearance/config";
import { AppearanceProvider } from "@/appearance/context";
import {
	NativeTraffic,
	NativeName,
	NativeGreeting,
	formatSpeed,
} from "@/appearance/widgets";
import { FeatureScope } from "@/appearance/scope";
import { snow } from "@/appearance/modules/snow";
import { sponsor } from "@/appearance/modules/sponsor";
const scopes: FeatureScope[] = [];
afterEach(() => {
	for (const scope of scopes) scope.dispose();
	scopes.length = 0;
	vi.useRealTimers();
});
function newScope(name = "test") {
	const scope = new FeatureScope(name);
	scopes.push(scope);
	return scope;
}
function configOnly(keys: string[]) {
	const c = defaults();
	c.enabled = true;
	for (const [key, f] of Object.entries(c.features))
		f.enabled = keys.includes(key);
	return c;
}
describe("native appearance configuration", () => {
	it("retains all 30 independent features with the original defaults", () => {
		const c = defaults();
		expect(Object.keys(c.features)).toHaveLength(30);
        expect(c.features).not.toHaveProperty("wave");
        expect(c.features).not.toHaveProperty("meihua");
		expect(validate(c)).toBe("");
		expect(c.enabled).toBe(false);
		expect(c.features.snow.mobileCount).toBe(20);
		expect(c.features.live2d.tools).toHaveLength(7);
		expect(c.features.background.desktopMedia).toHaveLength(7);
	});
	it("rejects bad nested values, protocols, and ranges without crashing rendering", () => {
		for (const change of [
			(c: any) =>
				(c.features.branding.links = [
					{ name: "x", link: "javascript:alert(1)" },
				]),
			(c: any) => (c.features.snow.count = -1),
			(c: any) =>
				(c.features.background.desktopMedia = [
					{ type: "invalid", src: "https://example.com" },
				]),
			(c: any) => (c.features.live2d.tools = [null]),
		]) {
			const c = defaults();
			c.enabled = true;
			change(c);
			expect(validate(c)).not.toBe("");
			expect(normalize(JSON.stringify(c)).enabled).toBe(false);
		}
	});
	it("ignores malformed documents and preserves valid partial documents", () => {
		expect(normalize("bad").enabled).toBe(false);
		expect(
			normalize('{"version":99,"enabled":true,"features":{}}').enabled,
		).toBe(false);
		expect(
			normalize(
				'{"version":1,"enabled":true,"features":{"snow":{"enabled":false}}}',
			).features.snow.enabled,
		).toBe(false);
	});
});
describe("feature resource ownership", () => {
	it("removes events, timers, nodes, observer work and restores external styles", () => {
		vi.useFakeTimers();
		const scope = newScope(),
			callback = vi.fn(),
			node = scope.createElement("div");
		document.body.append(node);
		scope.listen(scope.window, "click", callback);
		scope.setInterval(callback, 20);
		scope.setTimeout(callback, 40);
		scope.styleOf(document.body).color = "red";
		window.dispatchEvent(new Event("click"));
		expect(callback).toHaveBeenCalledOnce();
		scope.dispose();
		vi.advanceTimersByTime(1000);
		window.dispatchEvent(new Event("click"));
		expect(callback).toHaveBeenCalledOnce();
		expect(node.isConnected).toBe(false);
		expect(document.body.style.color).toBe("");
		expect(vi.getTimerCount()).toBe(0);
	});
	it("frees resources of removed particles instead of accumulating them", () => {
		const scope = newScope();
		for (let i = 0; i < 100; i++) {
			const node = scope.createElement("span");
			document.body.append(node);
			scope.listen(node, "animationend", () => {});
			scope.styleOf(node).opacity = "0";
			scope.remove(node);
		}
		expect((scope as any).nodes.size).toBe(0);
		expect((scope as any).cleanups.size).toBe(0);
		expect((scope as any).styleRecords.size).toBe(0);
	});
	it("can repeatedly mount and disable snow and sponsor without duplicate nodes", () => {
		vi.useFakeTimers();
		for (let i = 0; i < 3; i++) {
			const a = newScope("snow"),
				b = newScope("sponsor");
			snow(a, defaults().features.snow);
			sponsor(b, defaults().features.sponsor);
			expect(document.querySelectorAll("#bmWrap")).toHaveLength(1);
			a.dispose();
			b.dispose();
			expect(
				document.querySelectorAll("[data-nezha-appearance],#bmWrap"),
			).toHaveLength(0);
			expect(vi.getTimerCount()).toBe(0);
		}
	});
	it("aborts active requests on disable", async () => {
		let signal: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn((_url, options) => {
				signal = options.signal;
				return new Promise((_resolve, reject) =>
					signal!.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					),
				);
			}),
		);
		const scope = newScope();
		const pending = scope
			.fetch("https://example.test/api")
			.catch((error) => error.name);
		scope.dispose();
		expect(await pending).toBe("AbortError");
		expect(signal?.aborted).toBe(true);
	});
});
describe("native data widgets", () => {
	it("master switch prevents name styles and keeps the original greeting", () => {
		const c = defaults();
		render(
			<AppearanceProvider raw={JSON.stringify(c)}>
				<NativeName online>A</NativeName>
				<NativeGreeting fallback="original" />
			</AppearanceProvider>,
		);
		expect(screen.getByText("A")).not.toHaveClass("nz-name-online");
		expect(screen.getByText("original")).toBeInTheDocument();
	});
	it("matches traffic by system ID, not server name or array position", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					success: true,
					data: {
						cycle_transfer_stats: {
							"1": {
								name: "quota",
								max: 1000,
								from: "2026-09-01",
								to: "2026-10-01",
								transfer: { "11": 100, "12": 900 },
								next_update: {},
							},
						},
					},
				}),
			})),
		);
		const c = configOnly(["traffic"]);
		const view = render(
			<QueryClientProvider client={client}>
				<AppearanceProvider raw={JSON.stringify(c)}>
					<NativeTraffic serverId={11} />
					<NativeTraffic serverId={12} />
				</AppearanceProvider>
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getAllByRole("progressbar")).toHaveLength(2),
		);
		expect(screen.getAllByRole("progressbar")[0]).toHaveAttribute(
			"aria-valuenow",
			"10",
		);
		expect(screen.getAllByRole("progressbar")[1]).toHaveAttribute(
			"aria-valuenow",
			"90",
		);
		view.unmount();
		client.clear();
	});
	it("does not repeat the last greeting on remount", async () => {
		const c = configOnly(["greeting"]);
		const ui = (
			<AppearanceProvider raw={JSON.stringify(c)}>
				<NativeGreeting fallback="original" />
			</AppearanceProvider>
		);
		const a = render(ui);
		await act(async () => {});
		const first = localStorage.getItem("lastGreeting");
		a.unmount();
		render(ui);
		await act(async () => {});
		expect(localStorage.getItem("lastGreeting")).not.toBe(first);
	});
	it("handles invalid and zero speed without NaN", () => {
		expect(formatSpeed(NaN, true)).not.toContain("NaN");
		expect(formatSpeed(-1, true)).not.toContain("-");
		expect(formatSpeed(0, false)).toContain("/s");
	});
});
