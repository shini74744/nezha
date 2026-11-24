import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RemainPercentBar from "@appearance/cards/RemainPercentBar";

function fill() {
	return screen
		.getByRole("progressbar")
		.querySelector("[data-progress-fill]") as SVGElement;
}
describe("RemainPercentBar", () => {
	it("uses green at full time, yellow in the middle and red at expiry", () => {
		const { rerender } = render(<RemainPercentBar value={100} />);
		expect(screen.getByRole("progressbar")).toHaveClass("w-[70px]", "h-[3px]");
		for (const [value, hue] of [
			[100, 120],
			[50, 60],
			[0, 0],
		]) {
			rerender(<RemainPercentBar value={value} />);
			expect(fill().style.fill.startsWith("hsl(" + hue + " ")).toBe(true);
			expect(fill().style.width).toBe(value + "%");
			expect(screen.getByRole("progressbar")).toHaveAttribute(
				"aria-valuenow",
				String(value),
			);
		}
	});
	it("has a distinct color for every percentage and retains fractional values", () => {
		const { rerender } = render(<RemainPercentBar value={100} />);
		const values = [
			...Array.from({ length: 101 }, (_, i) => i),
			29.5,
			30.5,
			69.5,
			70.5,
		];
		const colors = new Set<string>();
		for (const value of values) {
			rerender(<RemainPercentBar value={value} />);
			colors.add(fill().style.fill);
			expect(fill().style.width).toBe(value + "%");
		}
		expect(colors.size).toBe(values.length);
	});
	it.each([
		[-10, 0],
		[110, 100],
		[Number.NaN, 0],
		[Number.POSITIVE_INFINITY, 0],
	])("clamps invalid or out-of-range input: %s", (value, clamped) => {
		render(<RemainPercentBar value={value} />);
		expect(fill().style.width).toBe(clamped + "%");
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			String(clamped),
		);
	});
});
