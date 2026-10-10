import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ReturnRouteMap from "@/components/ReturnRouteMap";
import { returnMapData, orderedReturnHops } from "@/lib/return-route-map";
import type { ReturnHop, ReturnResult } from "@/lib/network-insight-api";
const point = (ttl: number, longitude = 104, latitude = 1): ReturnHop => ({
	ttl,
	longitude,
	latitude,
	samples: 3,
});
const result = (hops: ReturnHop[], status = "reached"): ReturnResult => ({
	id: "bj-ct",
	name: "北京",
	carrier: "电信",
	family: "IPv4",
	protocol: "TCP",
	status,
	hops,
});
describe("compact return map", () => {
	it("adds only dashed guides across unknown sections, keeping observed edges strict", () => {
		const data = returnMapData([
			point(2),
			{ ttl: 3, samples: 0 },
			point(5, 116, 40),
			point(6, 117, 40),
		]);
		expect(data.segments.map((s) => s.ttl)).toEqual([5]);
		expect(data.gaps).toEqual([
			{ from: [104, 1], to: [116, 40], ttl: 2, end: 5 },
		]);
	});
	it("never invents branch connections, destination positions or colocated edges", () => {
		expect(
			returnMapData([point(1), point(2), point(2, 110), point(5, 116)]).gaps,
		).toEqual([]);
		expect(returnMapData([point(1), point(5)]).gaps).toEqual([]);
		expect(
			returnMapData([point(1), { ttl: 5, samples: 3, stage: "destination" }])
				.points,
		).toHaveLength(1);
		expect(
			returnMapData([{ ...point(1), ip_hidden: true }, point(5, 116)]).gaps,
		).toEqual([]);
	});
	it("keeps valid TTLs and alternatives without mutating historical records", () => {
		const hops = [point(3), point(1), point(3, 110), point(31)];
		const original = JSON.stringify(hops);
		expect(orderedReturnHops(hops).map((h) => h.ttl)).toEqual([1, 3, 3]);
		expect(JSON.stringify(hops)).toBe(original);
	});
	it("keeps old snapshots readable without coordinates, fake points or a journey panel", () => {
		const old = result([
			{ ttl: 1, samples: 3, stage: "origin", location: "新加坡" },
			{ ttl: 3, samples: 3, stage: "destination", location: "中国 北京" },
		]);
		const original = JSON.stringify(old);
		const view = render(<ReturnRouteMap result={old} />);
		expect(screen.queryByLabelText("完整回程线路")).not.toBeInTheDocument();
		expect(
			view.container.querySelector("[data-return-map-missing]"),
		).toBeNull();
		expect(screen.getByText("暂无可用定位数据")).toBeInTheDocument();
		expect(
			view.container.querySelectorAll("[data-return-map-point]"),
		).toHaveLength(0);
		expect(JSON.stringify(old)).toBe(original);
	});
	it("redraws historical snapshots without stale edges", () => {
		const view = render(
			<ReturnRouteMap result={result([point(1), point(5, 116)], "partial")} />,
		);
		expect(
			view.container.querySelectorAll("[data-return-map-gap]"),
		).toHaveLength(1);
		view.rerender(<ReturnRouteMap result={result([], "timeout")} />);
		expect(
			view.container.querySelectorAll("[data-return-map-gap]"),
		).toHaveLength(0);
		expect(screen.getByText("暂无可用定位数据")).toBeInTheDocument();
	});
	it("does not leak hidden hop location, address or network", () => {
		const hidden = {
			...point(1),
			stage: "origin",
			ip_hidden: true,
			ip: "192.0.2.99",
			location: "SECRET LOCATION",
			network: "SECRET NETWORK",
		};
		const view = render(<ReturnRouteMap result={result([hidden])} />);
		expect(view.container).not.toHaveTextContent("SECRET");
		expect(view.container).not.toHaveTextContent("192.0.2.99");
		expect(
			view.container.querySelectorAll("[data-return-map-point]"),
		).toHaveLength(0);
	});
	it("keeps point selection and a short legend while collapsing missing-hop explanations", () => {
		const view = render(
			<ReturnRouteMap
				result={result([point(1), { ttl: 2, samples: 0 }, point(3, 116, 40)])}
			/>,
		);
		expect(screen.getByLabelText("地图连线图例")).toHaveTextContent(
			"中间信息不完整",
		);
		expect(view.container.querySelector("details")).not.toHaveAttribute("open");
		expect(view.container).not.toHaveTextContent("不根据地址归属名称猜测坐标");
		fireEvent.click(
			screen.getByRole("button", { name: /^第 3 跳$/ }),
		);
		expect(
			view.container.querySelector("[data-return-map-selection]"),
		).toHaveTextContent("第 3 跳");
	});
});
