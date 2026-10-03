import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppearanceProvider } from "@/appearance/context";
import { StatusProvider } from "@/context/status-provider";
import { useStatus } from "@/hooks/use-status";
import { createServer } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";
import { DoraemonCard, percent, positive } from "@/themes/doraemon/Card";
import { DoraemonMap, DoraemonOverview } from "@/themes/doraemon/Overview";
import { beijingSky } from "@/themes/doraemon/sky";
import {
	formatMbps,
	networkRateParts,
	formatNetworkRate,
} from "@/themes/doraemon/format";
import { nearbyRegions } from "@/themes/doraemon/Map";
import { makeNetworkLinks } from "@/themes/doraemon/Network";

vi.mock("@/components/ServerFlag", () => ({ default: () => null }));
const now = Date.parse("2025-01-01T00:00:20.000Z");
function Path() {
	return <output>{useLocation().pathname}</output>;
}
function State() {
	return <output>{useStatus().status}</output>;
}
describe("Doraemon port", () => {
	it.each([
		[0, "0.0", "Mbps"],
		[999_900_000 / 8, "999.9", "Mbps"],
		[1_000_000_000 / 8, "1.00", "Gbps"],
		[1_024_000_000 / 8, "1.02", "Gbps"],
		[1_500_000_000 / 8, "1.50", "Gbps"],
		[10_000_000_000 / 8, "10.00", "Gbps"],
		[-1, "0.0", "Mbps"],
		[NaN, "0.0", "Mbps"],
		[Infinity, "0.0", "Mbps"],
	])("uses SI network units at the 1000 Mbps boundary: %s", (bytes, value, unit) => {
		expect(networkRateParts(bytes)).toEqual({ value, unit });
		expect(formatNetworkRate(bytes)).toBe(value + " " + unit);
	});
	it("separates the overview number and unit for a stable mobile two-line layout", () => {
		renderWithProviders(
			<StatusProvider>
				<DoraemonOverview
					total={1}
					online={1}
					offline={0}
					up={0}
					down={0}
					upSpeed={187_500_000}
					downSpeed={1_000_000}
				/>
			</StatusProvider>,
		);
		const number = screen.getByText("1.50");
		expect(number).toHaveClass("dora-rate-number");
		expect(within(number.parentElement!).getByText("Gbps")).toHaveClass(
			"dora-rate-unit",
		);
		expect(screen.getByText("8.0").parentElement).toHaveTextContent("8.0 Mbps");
	});
	it("detects overlapping finger targets and keeps distant regions separate", () => {
		const nodes = [
			{ code: "HK", point: [100, 100] },
			{ code: "TW", point: [170, 110] },
			{ code: "US", point: [600, 100] },
		];
		expect(nearbyRegions(nodes, "HK", 0.4)).toEqual(["HK", "TW"]);
		expect(nearbyRegions(nodes, "HK", 1)).toEqual(["HK"]);
		expect(nearbyRegions(nodes, "missing", 1)).toEqual([]);
	});
	it("lets dense regions be chosen explicitly; Escape closes and restores focus", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<DoraemonMap
				now={now}
				serverList={[
					createServer({ id: 11, name: "香港", country_code: "hk" }),
					createServer({ id: 12, name: "台湾", country_code: "tw" }),
				]}
			/>,
		);
		const map = screen.getByRole("button", { name: "HK 1 台服务器" });
		expect(map.querySelector(".dora-map-hit")).toHaveAttribute("r", "55");
		fireEvent.click(map);
		expect(screen.getByText("这些地区比较近，请选择")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "TW · 1 台服务器 →" }));
		expect(screen.getByRole("link", { name: "台湾 →" })).toHaveAttribute(
			"href",
			"/server/12",
		);
		expect(
			screen.queryByRole("link", { name: "香港 →" }),
		).not.toBeInTheDocument();
		await user.keyboard("{Escape}");
		expect(
			screen.queryByRole("region", { name: "任意门目的地" }),
		).not.toBeInTheDocument();
		expect(map).toHaveFocus();
	});
	it("keyboard activation selects the exact region without ambiguous pointer clustering", () => {
		renderWithProviders(
			<DoraemonMap
				now={now}
				serverList={[
					createServer({ id: 11, name: "香港", country_code: "hk" }),
					createServer({ id: 12, name: "台湾", country_code: "tw" }),
				]}
			/>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "HK 1 台服务器" }), {
			key: "Enter",
		});
		expect(screen.getByRole("link", { name: "香港 →" })).toBeInTheDocument();
		expect(
			screen.queryByText("这些地区比较近，请选择"),
		).not.toBeInTheDocument();
	});
	it("remembers map compact preference independently from other themes", () => {
		const props = { now, serverList: [] };
		const first = renderWithProviders(<DoraemonMap {...props} />);
		const toggle = screen.getByRole("button", { name: "展开地图" });
		fireEvent.click(toggle);
		expect(localStorage.getItem("doraemon:compact-map")).toBe("false");
		first.unmount();
		renderWithProviders(<DoraemonMap {...props} />);
		expect(screen.getByRole("button", { name: "紧凑地图" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	it("uses decimal Mbps and sanitizes invalid rates", () => {
		expect(formatMbps(1_000_000)).toBe("8.0 Mbps");
		expect(formatMbps(153.3 * 1024 * 1024)).toBe("1286.0 Mbps");
		expect(formatMbps(0)).toBe("0.0 Mbps");
		expect(formatMbps(-50)).toBe("0.0 Mbps");
		expect(formatMbps(NaN)).toBe("0.0 Mbps");
		expect(formatMbps(Infinity)).toBe("0.0 Mbps");
	});
	it("keeps cumulative upload and download separate from the Mbps rates", () => {
		renderWithProviders(
			<StatusProvider>
				<DoraemonOverview
					total={3}
					online={2}
					offline={1}
					up={1024 ** 4}
					down={2 * 1024 ** 4}
					upSpeed={1_000_000}
					downSpeed={2_000_000}
				/>
			</StatusProvider>,
		);
		expect(screen.getByText("8.0").parentElement).toHaveTextContent("8.0 Mbps");
		expect(screen.getByText("16.0").parentElement).toHaveTextContent(
			"16.0 Mbps",
		);
		const totals = screen.getByLabelText("累计流量");
		expect(within(totals).getByText("上传").parentElement).toHaveTextContent(
			"1.0 TiB",
		);
		expect(within(totals).getByText("下载").parentElement).toHaveTextContent(
			"2.0 TiB",
		);
		expect(screen.queryByText("3.0 TiB")).not.toBeInTheDocument();
	});
	it("bounds decorative links and excludes offline and invalid regions", () => {
		expect(makeNetworkLinks([])).toEqual([]);
		expect(
			makeNetworkLinks([{ code: "JP", point: [1, 2], online: 1 }]),
		).toEqual([]);
		const nodes = Array.from({ length: 40 }, (_, i) => ({
			code: String(i),
			point: [i * 10, 100],
			online: 1,
		}));
		nodes.push(
			{ code: "offline", point: [2, 3], online: 0 },
			{ code: "bad", point: [NaN, 3], online: 2 },
		);
		const links = makeNetworkLinks(nodes);
		expect(links).toHaveLength(18);
		expect(
			links.every((link) => !/(offline|bad|NaN)/.test(link.key + link.d)),
		).toBe(true);
		expect(makeNetworkLinks(nodes.slice().reverse())).toEqual(links);
	});
	it.each([
		["2026-10-03T22:59:00Z", "dark"],
		["2026-10-03T23:00:00Z", "light"],
		["2026-10-04T10:59:00Z", "light"],
		["2026-10-04T11:00:00Z", "dark"],
		["2026-10-04T07:00:00+08:00", "light"],
	])("resolves Beijing sky %s", (date, want) =>
		expect(beijingSky(new Date(date))).toBe(want));
	it("bounds bad and oversized metrics", () => {
		expect(percent(100, 0)).toBe(0);
		expect(percent(200, 100)).toBe(100);
		expect(percent(-1, 100)).toBe(0);
		expect(positive(NaN)).toBe(0);
	});
	it("renders real metrics and keyboard navigation using Nezha IDs", async () => {
		const server = createServer({
			id: 42,
			name: "东京道具",
			last_active: new Date(now).toISOString(),
		});
		renderWithProviders(
			<AppearanceProvider>
				<DoraemonCard now={now} serverInfo={server} />
				<Path />
			</AppearanceProvider>,
		);
		expect(screen.getByText("东京道具")).toBeInTheDocument();
		expect(screen.getByText("元气满满 · 在线")).toBeInTheDocument();
		expect(screen.getAllByRole("progressbar")).toHaveLength(4);
		const user = userEvent.setup();
		screen.getByRole("link", { name: "查看服务器 东京道具" }).focus();
		await user.keyboard("{Enter}");
		expect(screen.getByText("/server/42")).toBeInTheDocument();
	});
	it("does not present stale offline metrics as live readings", () => {
		const server = createServer({
			id: 43,
			name: "离线道具",
			last_active: "2020-01-01T00:00:00Z",
		});
		renderWithProviders(
			<AppearanceProvider>
				<DoraemonCard now={now} serverInfo={server} />
			</AppearanceProvider>,
		);
		expect(screen.getByText("待机充电中 · 离线")).toBeInTheDocument();
		expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
		expect(screen.getByText("点击查看离线详情与历史记录")).toBeInTheDocument();
	});
	it("overview keeps the existing online/offline filtering contract", () => {
		renderWithProviders(
			<StatusProvider>
				<DoraemonOverview
					total={9}
					online={8}
					offline={1}
					up={1024}
					down={1024}
					upSpeed={0}
					downSpeed={0}
				/>
				<State />
			</StatusProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: /待机充电 · 离线/ }));
		expect(screen.getByText("offline")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /元气满满 · 在线/ }));
		expect(screen.getByText("online")).toBeInTheDocument();
	});
	it("map destinations link to real Nezha detail routes", () => {
		renderWithProviders(
			<DoraemonMap
				now={now}
				serverList={[
					createServer({ id: 42, name: "东京道具", country_code: "jp" }),
				]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "JP 1 台服务器" }));
		expect(screen.getByRole("link", { name: "东京道具 →" })).toHaveAttribute(
			"href",
			"/server/42",
		);
		fireEvent.click(screen.getByRole("button", { name: "关闭任意门" }));
		expect(
			screen.queryByRole("region", { name: "任意门目的地" }),
		).not.toBeInTheDocument();
	});
});
