import { expect, it } from "vitest";
import { networkSeriesColor } from "@/lib/network-series-color";

it("keeps fallback colors stable without a repeating palette", () => {
	const colors = Array.from({ length: 256 }, (_, id) =>
		networkSeriesColor(id + 1),
	);
	expect(new Set(colors).size).toBe(256);
	for (const id of [1, 7, 30, 90, 256])
		expect(networkSeriesColor(id)).toBe(colors[id - 1]);
	expect(networkSeriesColor("重庆电信")).toBe(networkSeriesColor("重庆电信"));
});
