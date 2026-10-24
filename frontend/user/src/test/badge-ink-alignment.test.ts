import { describe, it, expect, vi } from "vitest";
import { visibleBody, observeBadgeText } from "@/lib/badge-ink-alignment";
describe("visible text body independent from icon and line metrics", () => {
	it.each([
		[
			[0, 0, 10, 20, 10, 0],
			[2, 5],
		],
		[
			[0, 1, 100, 100, 100, 1, 0],
			[2, 5],
		],
		[
			[0, 100, 100, 10, 0],
			[1, 4],
		],
		[
			[0, 0, 50, 50, 0, 0],
			[2, 4],
		],
		[
			[0, 5, 0],
			[1, 2],
		],
	])("uses one ink rule for every language", (rows, expected) =>
		expect(visibleBody(rows)).toEqual(expected));
	it.each([
		[[]],
		[[0, 0]],
		[[NaN]],
		[[Infinity]],
	])("retains native text when there is no measurable ink", (rows) =>
		expect(visibleBody(rows)).toBeUndefined());
	it("does not change the result when opacity changes", () =>
		expect(visibleBody([0, 2, 200, 200, 2, 0])).toEqual(
			visibleBody([0, 1, 100, 100, 1, 0]),
		));
	it("shares listeners and releases them after the last badge unmounts", () => {
		const add = vi.spyOn(window, "addEventListener"),
			remove = vi.spyOn(window, "removeEventListener");
		const a = document.createElement("span"),
			b = document.createElement("span");
		const stopA = observeBadgeText(a),
			stopB = observeBadgeText(b);
		expect(add.mock.calls.filter(([type]) => type === "resize")).toHaveLength(
			1,
		);
		stopA();
		expect(
			remove.mock.calls.filter(([type]) => type === "resize"),
		).toHaveLength(0);
		stopB();
		expect(
			remove.mock.calls.filter(([type]) => type === "resize"),
		).toHaveLength(1);
		expect(
			remove.mock.calls.filter(([type]) => type === "scroll"),
		).toHaveLength(1);
		add.mockRestore();
		remove.mockRestore();
	});
});
