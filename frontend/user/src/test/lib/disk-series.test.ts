import { describe, it, expect } from "vitest";
import {
	mergeDiskIOHistory,
	realtimeDiskPoints,
} from "@/components/ServerDiskChart";
import { createServer } from "@/test/fixtures";
describe("disk series", () => {
	it("keeps gaps, real zero, ordering and missing streams separate", () => {
		expect(
			mergeDiskIOHistory(
				[
					{ ts: 2, value: 0 },
					{ ts: 1, value: 1024 },
				],
				[{ ts: 2, value: 2048 }],
			),
		).toEqual([
			{ timeStamp: "1", read: 1024, write: null },
			{ timeStamp: "2", read: 0, write: 2048 },
		]);
	});
	it("caps realtime history and keeps unknown readings null", () => {
		const server = createServer({
			id: 7,
			state: {
				disk_io_available: true,
				disk_read_speed: 12,
				disk_write_speed: 34,
			},
		});
		const older = createServer({ id: 7 });
		const history = Array.from({ length: 40 }, (_, i) => ({
			now: 100 - i,
			servers: [older],
		}));
		const points = realtimeDiskPoints(history, server, 100);
		expect(points).toHaveLength(30);
		expect(points[0].read).toBeNull();
		expect(points[points.length - 1]?.read).toBe(12);
	});
});
