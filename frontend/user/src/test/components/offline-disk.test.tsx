import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	OfflineMetricCard,
	type LastReport,
} from "@/components/OfflineServerDetail";
import { renderWithProviders } from "@/test/utils";
vi.mock("@/lib/detail-modules", () => ({
	PreloadedServerNetworkInsight: () => null,
	loadNetworkChart: async () => ({ default: () => null }),
}));
const group = {
	title: "磁盘",
	keys: ["disk"],
	labels: ["磁盘"],
	unit: "bytes",
	colors: [5],
};
const report: LastReport = {
	server_id: 7,
	tsdb_enabled: true,
	history_days: 1,
	metrics: { disk: 1024, disk_read_speed: 2048, disk_write_speed: 0 },
	recent: {},
};
describe("offline disk card", () => {
	it("switches only from the title and retains keyboard focus", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<OfflineMetricCard group={group} report={report} period="last" />,
		);
		const toggle = screen.getByRole("button", { name: "点击切换到磁盘读写" });
		const card = toggle.closest<HTMLElement>("[data-disk-mode]")!;
		fireEvent.mouseOver(card);
		await user.click(card);
		expect(card).not.toHaveAttribute("role", "button");
		expect(document.querySelector("[data-disk-stack]")).toBeNull();
		expect(card).toHaveAttribute("data-disk-mode", "capacity");
		await user.click(toggle);
		expect(card).toHaveAttribute("data-disk-mode", "io");
		expect(card).toHaveTextContent("2.00 KiB/s");
		expect(card).toHaveTextContent("0 KiB/s");
		await user.click(screen.getByText("该时间范围没有记录"));
		await user.click(screen.getByText("读取"));
		await user.click(screen.getByText("0 KiB/s"));
		expect(card).toHaveAttribute("data-disk-mode", "io");
		toggle.focus();
		await user.keyboard("{Enter}");
		expect(card).toHaveAttribute("data-disk-mode", "capacity");
		expect(toggle).toHaveFocus();
		await user.keyboard(" ");
		expect(card).toHaveAttribute("data-disk-mode", "io");
		expect(toggle).toHaveFocus();
	});
	it("does not show absent legacy readings as zero", () => {
		renderWithProviders(
			<OfflineMetricCard
				group={group}
				report={{ ...report, metrics: { disk: 1024 } }}
				period="last"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "点击切换到磁盘读写" }));
		expect(screen.getAllByText("无记录")).toHaveLength(2);
	});
});
