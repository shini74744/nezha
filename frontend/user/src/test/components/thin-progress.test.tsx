import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinProgress } from "@/components/ui/thin-progress";

const originalRatio = window.devicePixelRatio;
afterEach(() => {
	cleanup();
	Object.defineProperty(window, "devicePixelRatio", {
		configurable: true,
		value: originalRatio,
	});
});
function setScale(value: number) {
	Object.defineProperty(window, "devicePixelRatio", {
		configurable: true,
		value,
	});
}
describe("ThinProgress pixel alignment", () => {
	it.each([
		0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 3,
	])("paints an integer device-pixel thickness at scale %s", (ratio) => {
		setScale(ratio);
		render(<ThinProgress value={52.5} color="green" aria-label="test usage" />);
		const svg = screen.getByRole("progressbar");
		const fill = svg.querySelector("[data-progress-fill]")!;
		expect(svg).toHaveAttribute("height", "4");
		expect(Number(fill.getAttribute("height")) * ratio).toBeCloseTo(
			Math.round(4 * ratio),
			8,
		);
		expect(Number(fill.getAttribute("y"))).toBeCloseTo(
			(4 - Number(fill.getAttribute("height"))) / 2,
			8,
		);
	});
	it("updates all mounted bars when display scaling changes", () => {
		setScale(1);
		render(
			<>
				<ThinProgress value={10} color="green" />
				<ThinProgress value={90} color="red" />
			</>,
		);
		act(() => {
			setScale(1.1);
			window.dispatchEvent(new Event("resize"));
		});
		for (const svg of screen.getAllByRole("progressbar")) {
			expect(svg).toHaveAttribute("height", "4");
			expect(
				Number(
					svg.querySelector("[data-progress-fill]")!.getAttribute("height"),
				) * 1.1,
			).toBeCloseTo(4, 8);
		}
	});
});
