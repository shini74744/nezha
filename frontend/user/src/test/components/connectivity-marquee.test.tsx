import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectivityMarquee from "@/components/ConnectivityMarquee";
import { resolveConnectivityIcon } from "@/lib/connectivity-icons";

const originalResize = globalThis.ResizeObserver,
	originalIntersection = globalThis.IntersectionObserver;
afterEach(() => {
	globalThis.ResizeObserver = originalResize;
	globalThis.IntersectionObserver = originalIntersection;
});
describe("connectivity overflow", () => {
	it("recalculates overflowing text, resize, and short replacements; cleans up", () => {
		let width = 80,
			textWidth = 200;
		const observe = vi.fn(),
			disconnect = vi.fn();
		globalThis.ResizeObserver = class {
			observe = observe;
			disconnect = disconnect;
		} as unknown as typeof ResizeObserver;
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
			() => width,
		);
		vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
			() => textWidth,
		);
		const { rerender, unmount } = render(
			<ConnectivityMarquee text="long status">long status</ConnectivityMarquee>,
		);
		const viewport = screen.getByTitle("long status");
		expect(viewport).toHaveAttribute("data-overflow", "true");
		expect(viewport.style.getPropertyValue("--nz-pan-end")).toBe("-120px");
		expect(viewport).toHaveAttribute("tabindex", "0");
		width = 250;
		act(() => window.dispatchEvent(new Event("resize")));
		expect(viewport).toHaveAttribute("data-overflow", "false");
		expect(viewport).not.toHaveAttribute("tabindex");
		width = 80;
		textWidth = 40;
		rerender(<ConnectivityMarquee text="short">short</ConnectivityMarquee>);
		expect(viewport).toHaveAttribute("data-overflow", "false");
		expect(observe).toHaveBeenCalledTimes(4);
		unmount();
		expect(disconnect).toHaveBeenCalledTimes(2);
	});
	it("pauses when outside the viewport", () => {
		let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
		const disconnect = vi.fn();
		globalThis.IntersectionObserver = class {
			constructor(callback: typeof notify) {
				notify = callback;
			}
			observe = vi.fn();
			disconnect = disconnect;
		} as unknown as typeof IntersectionObserver;
		const { unmount } = render(
			<ConnectivityMarquee text="status">status</ConnectivityMarquee>,
		);
		act(() => notify([{ isIntersecting: false }]));
		expect(screen.getByTitle("status")).toHaveAttribute(
			"data-visible",
			"false",
		);
		act(() => notify([{ isIntersecting: true }]));
		expect(screen.getByTitle("status")).toHaveAttribute("data-visible", "true");
		unmount();
		expect(disconnect).toHaveBeenCalledOnce();
	});
	it("only resolves bundled or exact same-origin cached icon paths", () => {
		const path = `/api/v1/logo/assets/${"a".repeat(64)}.png`;
		expect(resolveConnectivityIcon(path)).toBe(path);
		expect(resolveConnectivityIcon("sony")).toBeTruthy();
		for (const invalid of [
			"https://example.com/icon.png",
			"//example.com/a.png",
			`${path}?x=1`,
			path.replace(".png", ".html"),
			"/api/v1/logo/assets/../a.png",
			"data:image/png;base64,YQ==",
		])
			expect(resolveConnectivityIcon(invalid)).toBeUndefined();
	});
});
