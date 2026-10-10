import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RemainPercentBar from "@/components/RemainPercentBar";

describe("RemainPercentBar", () => {
	it("moves continuously from green through yellow and orange to red as time runs out", () => {
		const { rerender } = render(<RemainPercentBar value={100} />);
		const progress = screen.getByRole("progressbar");
		expect(progress).toHaveClass("w-[70px]", "h-[3px]");
		expect(progress.firstElementChild).toHaveClass("bg-current");
		for (const value of [100, 75, 50, 25, 0]) {
			rerender(<RemainPercentBar value={value} />);
			expect(progress).toHaveStyle({ color: `hsl(${value * 1.2} 70% 45%)` });
			expect(progress.firstElementChild).toHaveStyle({
				transform: `translateX(-${100 - value}%)`,
			});
		}
	});
	it("does not switch between three fixed colors at the old thresholds", () => {
		const { rerender } = render(<RemainPercentBar value={100} />);
		const colors = new Set<string>();
		for (let value = 100; value >= 0; value--) {
			rerender(<RemainPercentBar value={value} />);
			colors.add(screen.getByRole("progressbar").style.color);
		}
		expect(colors.size).toBe(101);
		for (const value of [29.5, 30, 30.5, 69.5, 70, 70.5]) {
			rerender(<RemainPercentBar value={value} />);
			expect(screen.getByRole("progressbar")).toHaveStyle({
				color: `hsl(${value * 1.2} 70% 45%)`,
			});
		}
	});
	it.each([[-10, 0], [110, 100], [Number.NaN, 0], [Number.POSITIVE_INFINITY, 0]])(
		"keeps invalid or out-of-range values safe: %s",
		(value, clamped) => {
			render(<RemainPercentBar value={value} />);
			const progress = screen.getByRole("progressbar");
			expect(progress).toHaveStyle({ color: `hsl(${clamped * 1.2} 70% 45%)` });
			expect(progress.firstElementChild).toHaveStyle({ transform: `translateX(-${100 - clamped}%)` });
		},
	);
});
