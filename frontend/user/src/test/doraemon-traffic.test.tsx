import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";
import { DoraemonCard, DoraemonInlineCard } from "@/themes/doraemon/Card";
import {
	DoraemonTraffic,
	DoraemonTrafficProvider,
	DoraemonTrafficRow,
	doraemonTrafficKey,
	type DoraemonTrafficStat,
} from "@/themes/doraemon/Traffic";

import { TrafficRow, trafficColor } from "@/appearance/traffic";
import { defaults } from "@/appearance/config";

const GiB = 1024 ** 3;
const base: DoraemonTrafficStat = {
	quota_type: "limited",
	name: "套餐月流量",
	used: 650 * GiB,
	max: 1000 * GiB,
	from: "2026-09-14T16:00:00Z",
	to: "2026-10-14T16:00:00Z",
	direction: "2",
};
function mockResponse(data: unknown, success = true) {
	return { ok: true, json: async () => ({ success, data }) };
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
describe("Doraemon original traffic parity", () => {
	it("reuses exactly the original renderer and Beijing dates", () => {
		const v = render(<DoraemonTrafficRow stat={base} />);
		const actual = v.container.querySelector(".nz-traffic")!.outerHTML;
		expect(v.container).toHaveTextContent("650.00GB/1000.00GB");
		expect(v.container).toHaveTextContent("2026/09/15 - 2026/10/15");
		v.unmount();
		const reference = render(
			<TrafficRow
				stat={{ ...base, name: base.name! }}
				serverId={0}
				interval={5000}
			/>,
		);
		expect(reference.container.querySelector(".nz-traffic")!.outerHTML).toBe(
			actual,
		);
	});
	it.each([
		0, 25, 65, 89, 90, 100, 135,
	])("uses the original gradient at %s percent and caps only width", (value) => {
		vi.useFakeTimers();
		const v = render(
			<DoraemonTrafficRow stat={{ ...base, used: value * 10 * GiB }} />,
		);
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			String(Math.min(100, value)),
		);
		const fill = v.container.querySelector(".nz-traffic-fill") as HTMLElement;
		expect(fill.style.width).toBe(Math.min(100, value) + "%");
		expect(
			(
				v.container.querySelector(".nz-traffic") as HTMLElement
			).style.getPropertyValue("--nz-traffic-light-color"),
		).toBe(trafficColor(value, true));
		act(() => {
			vi.advanceTimersByTime(5250);
		});
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(v.container.querySelector(".nz-traffic-info")).toHaveTextContent(
			value.toFixed(2) + "%",
		);
	});
	it.each([
		"unlimited",
		"unset",
	] as const)("keeps the original blue stripe for %s without fake percent", (quota_type) => {
		const v = render(
			<DoraemonTrafficRow stat={{ ...base, max: 0, quota_type }} />,
		);
		expect(v.container).toHaveTextContent("650.00GB/无限流量");
		expect(v.container.querySelector(".nz-traffic-unbounded")).not.toBeNull();
		expect(v.container.querySelector(".nz-traffic-fill")).toBeNull();
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(v.container.querySelector("[aria-valuenow]")).toBeNull();
	});
	it.each([
		["1", "本月下载流量统计"],
		["2", "本月双向流量统计"],
		["3", "本月上传流量统计"],
	])("rotates dates, direction %s, and percentage with the original fade", (direction, label) => {
		vi.useFakeTimers();
		const v = render(<DoraemonTrafficRow stat={{ ...base, direction }} />);
		const info = v.container.querySelector(".nz-traffic-info") as HTMLElement;
		expect(info).toHaveTextContent("2026/09/15 - 2026/10/15");
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(info.style.opacity).toBe("0");
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(info.style.opacity).toBe("1");
		expect(info).toHaveTextContent(label);
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(info).toHaveTextContent("65.00%");
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(info).toHaveTextContent("2026/09/15 - 2026/10/15");
	});
	it.each([
		{ partial: true },
		{ estimated: true },
	])("keeps original approximation marks", (flags) => {
		const v = render(<DoraemonTrafficRow stat={{ ...base, ...flags }} />);
		expect(v.container).toHaveTextContent("≈650.00GB");
		expect(
			v.container.querySelector(".nz-traffic")!.getAttribute("title"),
		).toMatch(/历史记录不完整|包含小时历史或断线间隔估算/);
	});
	it.each([
		{ max: -1 },
		{ used: -1 },
		{ max: NaN },
		{ used: Infinity },
		{ max: Infinity },
		{ max: Number.MIN_VALUE },
	])("rejects invalid data", (bad) => {
		const v = render(<DoraemonTrafficRow stat={{ ...base, ...bad }} />);
		expect(v.container).toHaveTextContent("流量数据暂不可用");
		expect(screen.queryByRole("progressbar")).toBeNull();
	});
	it("does not display invalid date text or fabricate quota settings", () => {
		const v = render(
			<DoraemonTrafficRow stat={{ ...base, error: "bad quota" }} />,
		);
		expect(v.container).toHaveTextContent("流量套餐设置需检查");
		v.rerender(<DoraemonTrafficRow stat={{ ...base, from: "bad", to: "" }} />);
		expect(v.container.textContent).not.toMatch(/Invalid Date|NaN/);
	});
	it("honors the saved rotation interval without enabling other beautification", async () => {
		vi.useFakeTimers();
		const config = defaults();
		config.features.traffic.toggleInterval = 8000;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(mockResponse({ 7: base })),
		);
		const v = renderWithProviders(
			<DoraemonTrafficProvider appearance={JSON.stringify(config)}>
				<DoraemonTraffic serverId={7} />
			</DoraemonTrafficProvider>,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5250);
		});
		expect(v.container).toHaveTextContent("2026/09/15 - 2026/10/15");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(v.container).toHaveTextContent("本月双向流量统计");
		v.unmount();
		v.queryClient.clear();
	});
	it("fetches all IDs once, without using another server's usage or reboot totals", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValue(
				mockResponse({ 7: base, 8: { ...base, used: 20 * GiB } }),
			);
		vi.stubGlobal("fetch", fetcher);
		const v = renderWithProviders(
			<DoraemonTrafficProvider>
				<DoraemonTraffic serverId={7} />
				<DoraemonTraffic serverId={8} />
				<DoraemonTraffic serverId={9} />
			</DoraemonTrafficProvider>,
		);
		await screen.findByText("650.00");
		expect(screen.getByText("20.00")).toBeInTheDocument();
		expect(screen.getByText("暂无本期流量数据")).toBeInTheDocument();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/v1/server-traffic",
			expect.objectContaining({
				credentials: "same-origin",
				cache: "no-store",
				signal: expect.any(AbortSignal),
			}),
		);
		v.unmount();
		v.queryClient.clear();
	});
	it("refreshes the whole list every 30 seconds and honors a cycle reset", async () => {
		vi.useFakeTimers();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(mockResponse({ 7: base }))
			.mockResolvedValue(
				mockResponse({
					7: {
						...base,
						used: 0,
						from: "2026-10-15T00:00:00+08:00",
						to: "2026-11-15T00:00:00+08:00",
					},
				}),
			);
		vi.stubGlobal("fetch", fetcher);
		const v = renderWithProviders(
			<DoraemonTrafficProvider>
				<DoraemonTraffic serverId={7} />
			</DoraemonTrafficProvider>,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10);
		});
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"65",
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30010);
		});
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"0",
		);
		expect(v.container).toHaveTextContent("2026/10/15 - 2026/11/15");
		expect(fetcher).toHaveBeenCalledTimes(2);
		v.unmount();
		v.queryClient.clear();
	});
	it("does not display a stale previous-cycle percentage after a failed refresh", async () => {
		const fetcher = vi.fn().mockResolvedValue(mockResponse({ 7: base }));
		vi.stubGlobal("fetch", fetcher);
		const v = renderWithProviders(
			<DoraemonTrafficProvider>
				<DoraemonTraffic serverId={7} />
			</DoraemonTrafficProvider>,
		);
		await screen.findByText("650.00");
		fetcher.mockRejectedValue(new Error("offline"));
		await act(async () => {
			await v.queryClient.refetchQueries({ queryKey: doraemonTrafficKey });
		});
		await waitFor(() => expect(v.container).toHaveTextContent("流量暂不可用"));
		expect(screen.queryByRole("progressbar")).toBeNull();
		v.unmount();
		v.queryClient.clear();
	});
	it("rejects malformed API responses", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse([])));
		const v = renderWithProviders(
			<DoraemonTrafficProvider>
				<DoraemonTraffic serverId={7} />
			</DoraemonTrafficProvider>,
		);
		expect(v.container).toHaveTextContent("流量加载中");
		await waitFor(() => expect(v.container).toHaveTextContent("流量暂不可用"), {
			timeout: 2500,
		});
		expect(screen.queryByRole("progressbar")).toBeNull();
		v.unmount();
		v.queryClient.clear();
	});
	it.each([
		DoraemonCard,
		DoraemonInlineCard,
	])("adds traffic before rates in both layouts and keeps it when offline", async (CardView) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(mockResponse({ 7: base })),
		);
		const server = createServer({ id: 7 });
		const now = Date.parse(server.last_active);
		const v = renderWithProviders(
			<DoraemonTrafficProvider>
				<CardView now={now} serverInfo={server} />
			</DoraemonTrafficProvider>,
		);
		await screen.findByRole("progressbar", { name: "套餐月流量" });
		const network = v.container.querySelector(".dora-network")!;
		expect(network.firstElementChild).toHaveClass("dora-traffic");
		expect(network.lastElementChild).toHaveClass("dora-transfer");
		v.rerender(
			<DoraemonTrafficProvider>
				<CardView now={now + 120_000} serverInfo={server} />
			</DoraemonTrafficProvider>,
		);
		expect(
			v.container.querySelector(".dora-offline .dora-traffic"),
		).not.toBeNull();
		v.unmount();
		v.queryClient.clear();
	});
});
