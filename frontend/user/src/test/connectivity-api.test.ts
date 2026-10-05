import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchConnectivity, startConnectivity } from "@/lib/connectivity-api";
afterEach(() => {
	vi.unstubAllGlobals();
	Object.defineProperty(document, "cookie", { configurable: true, value: "" });
});
describe("connectivity API", () => {
	it("reads only the panel and sends an empty same-origin POST with CSRF", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true, data: { state: "idle" } }),
			});
		vi.stubGlobal("fetch", fetcher);
		Object.defineProperty(document, "cookie", {
			configurable: true,
			value: "nz-csrf=signed-token",
		});
		await fetchConnectivity(7);
		await startConnectivity(7);
		expect(fetcher.mock.calls[0][0]).toBe("/api/v1/server/7/connectivity");
		expect(fetcher.mock.calls[1]).toEqual([
			"/api/v1/server/7/connectivity",
			{ method: "POST", headers: { "X-CSRF-Token": "signed-token" } },
		]);
	});
	it("rejects HTTP or API errors instead of treating them as empty results", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue({
					ok: false,
					json: async () => ({ success: false, error: "permission denied" }),
				}),
		);
		await expect(fetchConnectivity(7)).rejects.toThrow("permission denied");
		await expect(startConnectivity(7)).rejects.toThrow("permission denied");
	});
});
