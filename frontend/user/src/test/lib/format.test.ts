import { describe, expect, it } from "vitest";

import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
	it("distinguishes zero bytes from an unavailable counter", () => {
		expect(formatBytes(0)).toBe("0 KiB");
		expect(formatBytes(Number.NaN)).toBe("—");
	});

	it("keeps byte values in binary units", () => {
		expect(formatBytes(512)).toBe("0.50 KiB");
		expect(formatBytes(1024)).toBe("1.00 KiB");
		expect(formatBytes(1024 ** 2)).toBe("1.00 MiB");
		expect(formatBytes(1024 ** 3 * 2.5, 1)).toBe("2.5 GiB");
	});

	it("clamps negative decimal precision to an integer", () => {
		expect(formatBytes(1536, -1)).toBe("2 KiB");
	});
});
