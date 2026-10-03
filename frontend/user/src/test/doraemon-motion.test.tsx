import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDoraMotion } from "@/themes/doraemon/use-motion";
function Probe() {
	const motion = useDoraMotion<HTMLDivElement>();
	return <div data-testid="motion" {...motion} />;
}
const originalObserver = globalThis.IntersectionObserver;
const replaceObserver = (value: unknown) =>
	Object.defineProperty(globalThis, "IntersectionObserver", { value });
afterEach(() => {
	replaceObserver(originalObserver);
	vi.restoreAllMocks();
});
describe("Doraemon decorative animation lifecycle", () => {
	it("pauses offscreen/hidden and resumes only when both visible and onscreen", () => {
		let notify: IntersectionObserverCallback = () => {};
		const observe = vi.fn(),
			disconnect = vi.fn();
		replaceObserver(
			class {
				constructor(callback: IntersectionObserverCallback) {
					notify = callback;
				}
				observe = observe;
				disconnect = disconnect;
			},
		);
		const visible = vi
			.spyOn(document, "visibilityState", "get")
			.mockReturnValue("visible");
		const { unmount } = render(<Probe />);
		const el = screen.getByTestId("motion");
		const intersect = (isIntersecting: boolean) =>
			act(() =>
				notify(
					[{ isIntersecting } as IntersectionObserverEntry],
					{} as IntersectionObserver,
				),
			);
		expect(observe).toHaveBeenCalledWith(el);
		expect(el).toHaveAttribute("data-dora-motion", "running");
		intersect(false);
		expect(el).toHaveAttribute("data-dora-motion", "paused");
		visible.mockReturnValue("hidden");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		intersect(true);
		expect(el).toHaveAttribute("data-dora-motion", "paused");
		visible.mockReturnValue("visible");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		expect(el).toHaveAttribute("data-dora-motion", "running");
		unmount();
		expect(disconnect).toHaveBeenCalledOnce();
	});
	it("degrades safely without IntersectionObserver", () => {
		replaceObserver(undefined);
		render(<Probe />);
		expect(screen.getByTestId("motion")).toHaveAttribute(
			"data-dora-motion",
			"running",
		);
	});
});
