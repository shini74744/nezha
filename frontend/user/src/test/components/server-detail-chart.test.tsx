import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidElement, type ReactNode } from "react";
import { NetworkRateContext } from "@/context/network-rate-context";
import { AppearanceProvider } from "@/appearance/context";
import { defaults } from "@/appearance/config";
import { formatSpeed } from "@/appearance/widgets";
import { formatNetworkRate } from "@/themes/doraemon/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServerDetailChart from "@/components/ServerDetailChart";
import { createServer, createSettingResponse } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/utils";
import type { NezhaServer, NezhaWebsocketResponse } from "@/types/nezha-api";

const detailChartMocks = vi.hoisted(() => ({
	connected: true,
	fetchLoginUser: vi.fn(),
	fetchServerMetrics: vi.fn(),
	fetchSetting: vi.fn(),
	lastData: null as NezhaWebsocketResponse | null,
	messageHistory: [] as NezhaWebsocketResponse[],
}));

// Chart admission scheduling has its own tests; metric assertions should not
// race frame scheduling when release builds share the test machine.
vi.mock("@/components/ChartMountBoundary", () => ({default: ({children}: {children: ReactNode}) => children}));

vi.mock("recharts", () => {
	const createElement =
		(testId: string) =>
		({
			children,
			data,
			dataKey,
		}: {
			children?: ReactNode;
			data?: unknown[];
			dataKey?: string;
		}) => (
			<div
				data-key={dataKey}
				data-values={data ? JSON.stringify(data) : undefined}
				data-points={data?.length}
				data-testid={testId}
			>
				{children}
			</div>
		);

	const AreaChart = createElement("area-chart");
	const LineChart = createElement("line-chart");
	const genericChart = createElement("generic-chart");

	return {
		Area: createElement("area"),
		AreaChart,
		BarChart: genericChart,
		CartesianGrid: createElement("grid"),
		ComposedChart: genericChart,
		FunnelChart: genericChart,
		Legend: ({ content }: { content?: ReactNode }) => (
			<div data-testid="chart-legend">{content}</div>
		),
		Line: createElement("line"),
		LineChart,
		PieChart: genericChart,
		RadarChart: genericChart,
		RadialBarChart: genericChart,
		ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
			<div data-testid="responsive-chart">{children}</div>
		),
		Sankey: genericChart,
		ScatterChart: genericChart,
		Tooltip: ({ content }: { content?: ReactNode }) => {
			const formatter = isValidElement<{
				formatter?: (value: number, name: string) => ReactNode;
			}>(content)
				? content.props.formatter
				: undefined;
			const text = (node: ReactNode): string => {
				if (Array.isArray(node)) return node.map(text).join("");
				if (isValidElement<{ children?: ReactNode }>(node))
					return text(node.props.children);
				return typeof node === "string" || typeof node === "number"
					? String(node)
					: "";
			};
			return (
				<div
					data-testid="chart-tooltip"
					data-sample={text(formatter?.(3, "upload"))}
				>
					{content}
				</div>
			);
		},
		Treemap: genericChart,
		XAxis: createElement("x-axis"),
		YAxis: ({
			tickFormatter,
		}: {
			tickFormatter?: (value: number) => string;
		}) => <div data-testid="y-axis" data-unit-at-one={tickFormatter?.(1)} />,
	};
});

vi.mock("@/hooks/use-websocket-context", () => ({
	useWebSocketContext: () => ({
		connected: detailChartMocks.connected,
		lastData: detailChartMocks.lastData,
		messageHistory: detailChartMocks.messageHistory,
	}),
}));

vi.mock("@/lib/nezha-api", () => ({
	fetchLoginUser: detailChartMocks.fetchLoginUser,
	fetchServerMetrics: detailChartMocks.fetchServerMetrics,
	fetchSetting: detailChartMocks.fetchSetting,
}));

function settingResponse(tsdbEnabled = true) {
	return {
		...createSettingResponse(),
		data: {
			...createSettingResponse().data,
			tsdb_enabled: tsdbEnabled,
		},
	};
}

function loginResponse() {
	return {
		success: true,
		data: {
			id: 1,
			username: "admin",
			password: "",
			created_at: "2025-01-01T00:00:00.000Z",
			updated_at: "2025-01-01T00:00:00.000Z",
		},
	};
}

function metricsResponse(metric: string) {
	return {
		success: true,
		data: {
			server_id: 7,
			server_name: "edge-chart-detail",
			metric,
			data_points: [
				{ ts: Date.parse("2025-01-01T00:00:00.000Z"), value: 10 },
				{ ts: Date.parse("2025-01-01T01:00:00.000Z"), value: 20 },
				{ ts: Date.parse("2025-01-01T02:00:00.000Z"), value: 30 },
			],
		},
	};
}

function websocketPayload(server: NezhaServer, now: number) {
	return {
		now,
		servers: [server],
	};
}

function renderWithQuery(ui: React.ReactElement) {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			{ui}
		</QueryClientProvider>,
	);
}

function seedWebSocketData() {
	const baseNow = Date.parse("2025-01-01T00:00:20.000Z");
	const server = createServer({
		id: 7,
		name: "edge-chart-detail",
		host: {
			gpu: ["NVIDIA T4"],
		},
		state: {
			cpu: 45,
			disk_used: 180,
			gpu: [33],
			mem_used: 80,
			net_in_speed: 4 * 1024 ** 2,
			net_out_speed: 3 * 1024 ** 2,
			process_count: 77,
			swap_used: 25,
			tcp_conn_count: 18,
			udp_conn_count: 9,
		},
	});

	detailChartMocks.connected = true;
	detailChartMocks.lastData = websocketPayload(server, baseNow);
	detailChartMocks.messageHistory = [0, 1, 2].map((index) =>
		websocketPayload(
			createServer({
				id: 7,
				host: {
					gpu: ["NVIDIA T4"],
				},
				state: {
					cpu: 30 + index,
					disk_used: 100 + index * 10,
					gpu: [20 + index],
					mem_used: 50 + index * 5,
					net_in_speed: (1 + index) * 1024 ** 2,
					net_out_speed: (2 + index) * 1024 ** 2,
					process_count: 60 + index,
					swap_used: 10 + index,
					tcp_conn_count: 10 + index,
					udp_conn_count: 5 + index,
				},
			}),
			baseNow - index * 1000,
		),
	);
}

describe("ServerDetailChart", () => {
	beforeEach(() => {
		detailChartMocks.connected = true;
		detailChartMocks.fetchLoginUser.mockReset();
		detailChartMocks.fetchServerMetrics.mockReset();
		detailChartMocks.fetchSetting.mockReset();
		detailChartMocks.lastData = null;
		detailChartMocks.messageHistory = [];
		detailChartMocks.fetchLoginUser.mockRejectedValue(new Error("anonymous"));
		detailChartMocks.fetchSetting.mockResolvedValue(settingResponse());
	});

	it("renders the loading grid without websocket data", () => {
		detailChartMocks.connected = false;

		const { container } = renderWithQuery(<ServerDetailChart server_id="7" />);

		expect(container.querySelectorAll(".h-\\[182px\\]")).toHaveLength(6);
	});

	it("renders realtime resource, network, connection, and GPU charts", async () => {
		const user = userEvent.setup();
		seedWebSocketData();

		renderWithQuery(<ServerDetailChart server_id="7" />);

		expect(
			await screen.findByText("serverDetailChart.realtime"),
		).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.period1d")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.period7d")).toBeInTheDocument();
		expect(screen.getByText("CPU")).toBeInTheDocument();
		expect(screen.getByText("GPU: NVIDIA T4")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.mem")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.swap")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.disk")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.process")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.upload")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.download")).toBeInTheDocument();
		expect(screen.getByText("TCP")).toBeInTheDocument();
		expect(screen.getByText("UDP")).toBeInTheDocument();
		await waitFor(() => expect(screen.getAllByTestId("area-chart")).toHaveLength(5));
		await waitFor(() => expect(screen.getAllByTestId("line-chart")).toHaveLength(2));

		await user.click(screen.getByText("serverDetailChart.period7d"));

		expect(detailChartMocks.fetchServerMetrics).not.toHaveBeenCalled();
	});

	it("keeps default network units without a theme formatter", async () => {
		seedWebSocketData();
		renderWithQuery(<ServerDetailChart server_id="7" />);
		expect(await screen.findByText("3.00M/s")).toBeInTheDocument();
		expect(screen.getByText("4.00M/s")).toBeInTheDocument();
		await waitFor(() => expect(screen.getAllByTestId("line-chart")).toHaveLength(2));
		expect(
			screen
				.getAllByTestId("y-axis")
				.some((el) => el.dataset.unitAtOne === "1M/s"),
		).toBe(true);
	});
	it("uses the same SI formatter for realtime numbers, axes, tooltips and history", async () => {
		seedWebSocketData();
		detailChartMocks.fetchServerMetrics.mockImplementation(
			(_id: number, metric: string) => {
				const response = metricsResponse(metric);
				if (metric.startsWith("net_"))
					response.data.data_points.forEach((p) => {
						p.value = 125_000_000;
					});
				return Promise.resolve(response);
			},
		);
		renderWithQuery(
			<NetworkRateContext.Provider value={formatNetworkRate}>
				<ServerDetailChart server_id="7" />
			</NetworkRateContext.Provider>,
		);
		expect((await screen.findAllByText("25.2 Mbps")).length).toBeGreaterThan(0);
		expect(screen.getByText("33.6 Mbps")).toBeInTheDocument();
		expect(screen.queryByText("3.00M/s")).not.toBeInTheDocument();
		await waitFor(() => expect(screen.getAllByTestId("line-chart")).toHaveLength(2));
		expect(
			screen
				.getAllByTestId("chart-tooltip")
				.some((el) => el.dataset.sample?.includes("25.2 Mbps")),
		).toBe(true);
		expect(
			screen
				.getAllByTestId("y-axis")
				.some((el) => el.dataset.unitAtOne === "8.4 Mbps"),
		).toBe(true);
		await userEvent.click(screen.getByText("serverDetailChart.period1d"));
		await waitFor(() => {
			const net = screen
				.getAllByTestId("line-chart")
				.find((el) => el.dataset.values?.includes('"upload"'));
			expect(net).toBeDefined();
			const samples = JSON.parse(net!.dataset.values!);
			expect(samples[0].upload).toBe(125_000_000 / 1024 ** 2);
			expect(formatNetworkRate(samples[0].upload * 1024 ** 2)).toBe(
				"1.00 Gbps",
			);
		});
	});
	it.each([
		{ enabled: true, cardEnabled: true, bits: true, converted: true },
		{ enabled: false, cardEnabled: true, bits: true, converted: false },
		{ enabled: true, cardEnabled: false, bits: true, converted: false },
		{ enabled: true, cardEnabled: true, bits: false, converted: false },
	])("default detail rate follows card preferences: %j", async ({enabled, cardEnabled, bits, converted}) => {
		seedWebSocketData();
		const config = defaults();
		config.enabled = enabled;
		Object.assign(config.features.speed, {enabled:true, cardEnabled, bits});
		renderWithQuery(<AppearanceProvider raw={JSON.stringify(config)}><ServerDetailChart server_id="7" /></AppearanceProvider>);
		expect(await screen.findByText(converted ? "24.0Mbps" : "3.00M/s")).toBeInTheDocument();
		expect(screen.getByText(converted ? "32.0Mbps" : "4.00M/s")).toBeInTheDocument();
		await waitFor(() => expect(screen.getAllByTestId("line-chart")).toHaveLength(2));
		expect(screen.getAllByTestId("y-axis").some(el => el.dataset.unitAtOne === (converted ? "8.00Mbps" : "1M/s"))).toBe(true);
		expect(screen.getAllByTestId("chart-tooltip").some(el => el.dataset.sample?.includes(converted ? "24.0Mbps" : "3.00 MB/s"))).toBe(true);
	});

	it("default converted historical rates retain raw samples and follow live preference changes", async () => {
		seedWebSocketData();
		const config = defaults();
		config.enabled = true;
		Object.assign(config.features.speed, {enabled:true,cardEnabled:true,bits:true});
		detailChartMocks.fetchServerMetrics.mockImplementation((_id: number, metric: string) => {
			const response = metricsResponse(metric);
			if (metric.startsWith("net_")) response.data.data_points.forEach(point => { point.value = 125 * 1024 ** 2; });
			return Promise.resolve(response);
		});
		const client = createTestQueryClient();
		const ui = () => <QueryClientProvider client={client}><AppearanceProvider raw={JSON.stringify(config)}><ServerDetailChart server_id="7" /></AppearanceProvider></QueryClientProvider>;
		const view = render(ui());
		await screen.findByText("24.0Mbps");
		await userEvent.click(screen.getByText("serverDetailChart.period1d"));
		await waitFor(() => {
			const chart = screen.getAllByTestId("line-chart").find(el => el.dataset.values?.includes('"upload"'));
			expect(chart).toBeDefined();
			const samples = JSON.parse(chart!.dataset.values!);
			expect(samples[0].upload).toBe(125);
			expect(formatSpeed(samples[0].upload * 1024 ** 2, true)).toBe("1.00Gbps");
		});
		config.features.speed.bits = false;
		view.rerender(ui());
		expect(await screen.findByText("3.00M/s")).toBeInTheDocument();
		expect(screen.queryByText("24.0Mbps")).not.toBeInTheDocument();
	});

	it("prevents historical periods when TSDB is disabled", async () => {
		const user = userEvent.setup();
		seedWebSocketData();
		detailChartMocks.fetchSetting.mockResolvedValue(settingResponse(false));

		renderWithQuery(<ServerDetailChart server_id="7" />);

		await screen.findByText("serverDetailChart.realtime");
		await user.click(screen.getByText("serverDetailChart.period1d"));

		expect(detailChartMocks.fetchServerMetrics).not.toHaveBeenCalled();
	});

	it("fetches every historical metric group for the selected period", async () => {
		const user = userEvent.setup();
		seedWebSocketData();
		Object.defineProperty(document, "cookie", {
			configurable: true,
			value: "session=1",
		});
		detailChartMocks.fetchLoginUser.mockResolvedValue(loginResponse());
		detailChartMocks.fetchServerMetrics.mockImplementation(
			(_serverId: number, metric: string) =>
				Promise.resolve(metricsResponse(metric)),
		);

		renderWithQuery(<ServerDetailChart server_id="7" />);

		await screen.findByText("serverDetailChart.realtime");
		await user.click(screen.getByText("serverDetailChart.period1d"));

		for (const metric of [
			"cpu",
			"gpu",
			"memory",
			"swap",
			"disk",
			"process_count",
			"net_out_speed",
			"net_in_speed",
			"tcp_conn",
			"udp_conn",
		]) {
			await waitFor(() => {
				expect(detailChartMocks.fetchServerMetrics).toHaveBeenCalledWith(
					7,
					metric,
					"1d",
				);
			});
		}
	});
});

describe("disk card click-only switching", () => {
 it("starts with capacity, ignores hover/reports, and switches only after click", async () => {
  seedWebSocketData();
  detailChartMocks.lastData!.servers[0].state.disk_io_available=true;
  detailChartMocks.lastData!.servers[0].state.disk_read_speed=1024;
  detailChartMocks.lastData!.servers[0].state.disk_write_speed=2048;
  const view=renderWithQuery(<ServerDetailChart server_id="7"/>);
  const toggle=await screen.findByRole("button",{name:"点击切换到磁盘读写"});
  const card=toggle.closest<HTMLElement>("[data-disk-mode]")!;
  expect(card).toHaveAttribute("data-disk-mode","capacity");
  await userEvent.hover(card);
  await userEvent.click(card);
  expect(card).not.toHaveAttribute("role", "button");
  expect(document.querySelector("[data-disk-stack]")).toBeNull();
  expect(card).toHaveAttribute("data-disk-mode","capacity");
  await userEvent.click(toggle);
  expect(card).toHaveAttribute("data-disk-mode","io");
  expect(screen.getByText("磁盘读写")).toBeInTheDocument();
  await waitFor(()=>expect(card.querySelector('[data-testid="line-chart"]')).not.toBeNull());
  const points=JSON.parse(card.querySelector('[data-testid="line-chart"]')!.getAttribute("data-values")!);
  expect(points.at(-1).read).toBe(1024);
  expect(points.at(-1).write).toBe(2048);
  await userEvent.click(card.querySelector('[data-testid="line-chart"]')!);
  await userEvent.click(card.querySelector('[data-disk-rate-label="read"]')!);
  await userEvent.click(card.querySelector('[data-disk-rate-value="write"]')!);
  expect(card).toHaveAttribute("data-disk-mode","io");
  detailChartMocks.lastData={...detailChartMocks.lastData!,now:detailChartMocks.lastData!.now+1000};
  view.rerender(<QueryClientProvider client={createTestQueryClient()}><ServerDetailChart server_id="7"/></QueryClientProvider>);
  expect(card).toHaveAttribute("data-disk-mode","io");
  await userEvent.click(toggle);
  expect(card).toHaveAttribute("data-disk-mode","capacity");
 });
 it("does not invent zero throughput for legacy Agents", async () => {
  seedWebSocketData();
  renderWithQuery(<ServerDetailChart server_id="7"/>);
  await userEvent.click(await screen.findByRole("button",{name:"点击切换到磁盘读写"}));
  expect(screen.getByText("暂无读写数据")).toBeInTheDocument();
 });
 it("keeps valid idle zero rates and supports keyboard switching", async () => {
  seedWebSocketData();
  detailChartMocks.lastData!.servers[0].state.disk_io_available=true;
  const user=userEvent.setup();
  renderWithQuery(<ServerDetailChart server_id="7"/>);
  const toggle=await screen.findByRole("button",{name:"点击切换到磁盘读写"});
  const card=toggle.closest<HTMLElement>("[data-disk-mode]")!;
  toggle.focus();
  await user.keyboard("{Enter}");
  expect(card).toHaveAttribute("data-disk-mode","io");
  expect(toggle).toHaveFocus();
  expect(screen.queryByText("暂无读写数据")).not.toBeInTheDocument();
  await user.keyboard(" ");
  expect(card).toHaveAttribute("data-disk-mode","capacity");
 });
 it("requests disk read/write history after a click and preserves the selected period", async () => {
  seedWebSocketData();
  detailChartMocks.fetchServerMetrics.mockImplementation((_id:number,metric:string)=>Promise.resolve(metricsResponse(metric)));
  renderWithQuery(<ServerDetailChart server_id="7"/>);
  await userEvent.click(await screen.findByText("serverDetailChart.period1d"));
  await waitFor(()=>expect(detailChartMocks.fetchServerMetrics).toHaveBeenCalledWith(7,"disk","1d"));
  expect(detailChartMocks.fetchServerMetrics.mock.calls.some(call=>call[1]==="disk_read_speed")).toBe(false);
  await userEvent.click(screen.getByRole("button",{name:"点击切换到磁盘读写"}));
  await waitFor(()=>expect(detailChartMocks.fetchServerMetrics).toHaveBeenCalledWith(7,"disk_read_speed","1d"));
  expect(detailChartMocks.fetchServerMetrics).toHaveBeenCalledWith(7,"disk_write_speed","1d");
  await waitFor(()=>{
   const card=screen.getByRole("button",{name:"点击切换到磁盘占用"}).closest<HTMLElement>("[data-disk-mode]")!;
   const points=JSON.parse(card.querySelector('[data-testid="line-chart"]')!.getAttribute("data-values")!);
   expect(points[0].read).toBe(10);
   expect(points[0].write).toBe(10);
  });
 });
});
