import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidElement, type ReactNode } from "react";
import { NetworkRateContext } from "@/context/network-rate-context";
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
		expect(screen.getAllByTestId("area-chart").length).toBeGreaterThan(0);
		expect(screen.getAllByTestId("line-chart").length).toBeGreaterThan(0);

		await user.click(screen.getByText("serverDetailChart.period7d"));

		expect(detailChartMocks.fetchServerMetrics).not.toHaveBeenCalled();
	});

	it("keeps default network units without a theme formatter", async () => {
		seedWebSocketData();
		renderWithQuery(<ServerDetailChart server_id="7" />);
		expect(await screen.findByText("3.00M/s")).toBeInTheDocument();
		expect(screen.getByText("4.00M/s")).toBeInTheDocument();
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
