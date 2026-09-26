import { it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AppearanceProvider } from "@/appearance/context";
import { defaults } from "@/appearance/config";
import { NativeBackground } from "@/appearance/background";
import { useBackgroundPeakCut } from "@/appearance/background-state";
function Peak() {
	return <output>{String(useBackgroundPeakCut())}</output>;
}
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
for (const scenario of [
	{
		name: "desktop outside the configured ASNs",
		ua: "Desktop",
		org: "AS123 Example",
		time: "2026-09-25T04:00:00Z",
		image: "desktop",
		peak: true,
	},
	{
		name: "mobile branch",
		ua: "iPhone",
		org: "AS123 Example",
		time: "2026-09-25T04:00:00Z",
		image: "mobile",
		peak: false,
	},
	{
		name: "configured ASN overrides night mode",
		ua: "Desktop",
		org: "AS9808 Example",
		time: "2026-09-25T18:00:00Z",
		image: "china",
		peak: false,
	},
	{
		name: "Beijing night mode",
		ua: "Desktop",
		org: "AS123 Example",
		time: "2026-09-25T18:00:00Z",
		image: "night",
		peak: false,
	},
])
	it("preserves background and peak-cut branch: " + scenario.name, async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(scenario.time));
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(scenario.ua);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ json: async () => ({ org: scenario.org }) })),
		);
		const c = defaults();
		c.enabled = true;
		const f = c.features.background;
		f.desktopMedia = [
			{ type: "image", src: "https://example.test/desktop.png" },
		];
		f.mobileMedia = [{ type: "image", src: "https://example.test/mobile.png" }];
		f.chinaMedia = [{ type: "image", src: "https://example.test/china.png" }];
		f.nightImages = ["https://example.test/night.png"];
		// Exercise compatibility with the deployed legacy background configuration.
		delete f.scheduleRules; delete f.regionMobileMedia;
		const view = render(
			<AppearanceProvider raw={JSON.stringify(c)}>
				<NativeBackground />
				<Peak />
			</AppearanceProvider>,
		);
		await act(async () => {});
		expect(
			document.querySelector<HTMLElement>(".nz-media")?.style.backgroundImage,
		).toContain(scenario.image + ".png");
		expect(screen.getByRole("status")).toHaveTextContent(String(scenario.peak));
		view.unmount();
		expect(document.querySelector(".nz-media")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
