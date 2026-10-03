import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AppearanceProvider } from "@/appearance/context";
import { defaults } from "@/appearance/config";
import { NativeBackground } from "@/appearance/background";

afterEach(cleanup);
function fixture() {
	const c = defaults();
	c.enabled = true;
	Object.values(c.features).forEach((f) => {
		f.enabled = false;
	});
	Object.assign(c.features.background, {
		enabled: true,
		regionEnabled: false,
		scheduleRules: [],
		desktopMedia: [{ type: "image", src: "https://example.test/bg.png" }],
		mobileMedia: [{ type: "image", src: "https://example.test/bg.png" }],
		opacity: 0.4,
		blur: 4,
	});
	return c;
}
function view(c: ReturnType<typeof defaults>) {
	return (
		<AppearanceProvider raw={JSON.stringify(c)}>
			<NativeBackground />
		</AppearanceProvider>
	);
}
it("uses configured light glass while preserving the dark card style", () => {
	const c = fixture();
	const r = render(view(c));
	const style = () =>
		r.container.querySelector("style[data-nz-background-cards]")?.textContent;
	expect(style()).toContain(
		"html:not(.dark) .bg-card{background-color:rgba(255,255,255,0.4)",
	);
	expect(style()).toContain("backdrop-filter:blur(4px)");
	expect(style()).toContain(
		".dark .bg-card{background-color:rgba(13,11,9,0.4);backdrop-filter:blur(4px);border-color:rgba(13,11,9,.1)}",
	);
	c.features.background.lightOpacity = 0.65;
	c.features.background.lightBlur = 8;
	r.rerender(view(c));
	expect(style()).toContain("rgba(255,255,255,0.65)");
	expect(style()).toContain("backdrop-filter:blur(8px)");
	expect(style()).toContain(".dark .bg-card{background-color:rgba(13,11,9,0.4);backdrop-filter:blur(4px)");
	c.features.background.darkOpacity = 1;
	c.features.background.darkBlur = 0;
	r.rerender(view(c));
	expect(style()).toContain(".dark .bg-card{background-color:rgba(13,11,9,1);backdrop-filter:blur(0px)");
	expect(style()).toContain("rgba(255,255,255,0.65)");
	c.features.background.enabled = false;
	r.rerender(view(c));
	expect(style()).toBeUndefined();
});
it("does not change cards when appearance is disabled or no background is selected", () => {
	const c = fixture();
	c.enabled = false;
	const r = render(view(c));
	expect(r.container.querySelector("style")).toBeNull();
	c.enabled = true;
	c.features.background.desktopMedia = [];
	c.features.background.mobileMedia = [];
	r.rerender(view(c));
	expect(r.container.querySelector("style")).toBeNull();
});
