import { screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SortProvider } from "@/context/sort-provider";
import { StatusProvider } from "@/context/status-provider";
import type { WebSocketContextType } from "@/context/websocket-context";
import { WebSocketContext } from "@/context/websocket-context";
import { useStatus } from "@/hooks/use-status";
import Servers, { type ServerPresentation } from "@/pages/Server";
import { createServer } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";
import type { NezhaServer } from "@/types/nezha-api";

const apiMocks = vi.hoisted(() => ({
	fetchServerGroup: vi.fn(),
	fetchService: vi.fn(),
	fetchSetting: vi.fn(),
}));

vi.mock("@/lib/nezha-api", () => apiMocks);

vi.mock("@/components/GlobalMap", () => ({
	default: ({ serverList }: { serverList: NezhaServer[] }) => (
		<div data-testid="global-map">{serverList.length}</div>
	),
}));

vi.mock("@/components/GroupSwitch", () => ({
	default: ({
		tabs,
		setCurrentTab,
	}: {
		tabs: string[];
		setCurrentTab: (tab: string) => void;
	}) => (
		<div>
			{tabs.map((tab) => (
				<button
					key={tab}
					type="button"
					data-testid={`group-${tab}`}
					onClick={() => setCurrentTab(tab)}
				>
					{tab}
				</button>
			))}
		</div>
	),
}));

vi.mock("@/components/ServerOverview", () => ({
	default: ({
		offline,
		online,
		total,
	}: {
		offline: number;
		online: number;
		total: number;
	}) => (
		<div data-testid="server-overview">{`${total}:${online}:${offline}`}</div>
	),
}));

vi.mock("@/components/ServerCard", () => ({
	default: ({ serverInfo }: { serverInfo: NezhaServer }) => (
		<article data-testid="server-card">{serverInfo.name}</article>
	),
}));

vi.mock("@/components/ServerCardInline", () => ({
	default: ({ serverInfo }: { serverInfo: NezhaServer }) => (
		<article data-testid="server-card-inline">{serverInfo.name}</article>
	),
}));

vi.mock("@/components/ServiceTracker", () => ({
	ServiceTracker: ({ serverList, view }: { serverList: NezhaServer[]; view: string }) => (
		<div data-testid="service-tracker" data-view={view}>{serverList.length}</div>
	),
}));

function StatusControl() {
	const { setStatus } = useStatus();

	return (
		<button type="button" onClick={() => setStatus("online")}>
			online-only
		</button>
	);
}

function renderServerPage(
	websocketValue: Partial<WebSocketContextType>,
	{
		backendError = null,
		withStatusControl = false,
		presentation,
        afterContent,
	}: { backendError?: Error | null; withStatusControl?: boolean; presentation?: ServerPresentation; afterContent?:ReactNode } = {},
) {
	const defaultWebsocketValue: WebSocketContextType = {
		lastData: null,
		connected: false,
		messageHistory: [],
		reconnect: vi.fn(),
		needReconnect: false,
		setNeedReconnect: vi.fn(),
	};

	return renderWithProviders(
		<SortProvider>
			<StatusProvider>
				<WebSocketContext.Provider
					value={{ ...defaultWebsocketValue, ...websocketValue }}
				>
					{withStatusControl && <StatusControl />}
					<Servers backendError={backendError} presentation={presentation} afterContent={afterContent} />
				</WebSocketContext.Provider>
			</StatusProvider>
		</SortProvider>,
	);
}

function websocketPayload(servers: NezhaServer[]) {
	return {
		now: Date.parse("2025-01-01T00:00:20.000Z"),
		servers,
	};
}

const doraemonPresentation: ServerPresentation = {
	Card: () => <article data-testid="doraemon-card" />,
	InlineCard: () => <article />,
	Overview: ({ map }) => <section>{map}</section>,
	Map: () => <div data-testid="doraemon-map" />,
	Loading: () => <div>Loading</div>,
	storagePrefix: "doraemon:",
};

describe("Servers page", () => {
	beforeEach(() => {
		apiMocks.fetchSetting.mockResolvedValue({success:true,data:{config:{statistics_split:true}}});
		apiMocks.fetchServerGroup.mockResolvedValue({
			success: true,
			data: [
				{
					group: {
						id: 1,
						created_at: "",
						updated_at: "",
						name: "Edge",
					},
					servers: [2],
				},
			],
		});
		apiMocks.fetchService.mockResolvedValue({
			success: true,
			data: {
				services: {},
				cycle_transfer_stats: {},
			},
		});
	});

 it.each([false,true])("keeps themed bottom hidden before the first payload (connected=%s)", connected => {
  renderServerPage({connected,lastData:null},{presentation:doraemonPresentation,afterContent:<aside>Ready bottom</aside>});
  expect(screen.getByText("Loading")).toBeInTheDocument();
  expect(screen.queryByText("info.processing")).not.toBeInTheDocument();
  expect(screen.queryByText("Ready bottom")).not.toBeInTheDocument();
 });
 it("keeps themed bottom hidden on initial backend failure", () => {
  renderServerPage({connected:true,lastData:null},{presentation:doraemonPresentation,backendError:new Error("failed"),afterContent:<aside>Ready bottom</aside>});
  expect(screen.getByText("error.backendUnavailableTitle")).toBeInTheDocument();
  expect(screen.queryByText("Ready bottom")).not.toBeInTheDocument();
 });
 it.each([true,false])("renders bottom after loaded cards even during reconnect (connected=%s)", connected => {
  renderServerPage({connected,lastData:websocketPayload([createServer()])},{presentation:doraemonPresentation,afterContent:<aside>Ready bottom</aside>});
  const card=screen.getByTestId("doraemon-card"),bottom=screen.getByText("Ready bottom");
  expect(card.compareDocumentPosition(bottom)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText("Loading")).not.toBeInTheDocument();
 });
 it("treats a valid empty payload as ready, not as initial loading", () => {
  renderServerPage({connected:true,lastData:websocketPayload([])},{presentation:doraemonPresentation,afterContent:<aside>Ready bottom</aside>});
  expect(screen.getByText("info.noServers")).toBeInTheDocument();
  expect(screen.getByText("Ready bottom")).toBeInTheDocument();
 });
	it("renders websocket loading and processing states", () => {
		const { rerender } = renderServerPage({
			connected: false,
			lastData: null,
		});

		expect(screen.getByText("info.websocketConnecting")).toBeInTheDocument();

		rerender(
			<SortProvider>
				<StatusProvider>
					<WebSocketContext.Provider
						value={{
							lastData: null,
							connected: true,
							messageHistory: [],
							reconnect: vi.fn(),
							needReconnect: false,
							setNeedReconnect: vi.fn(),
						}}
					>
						<Servers />
					</WebSocketContext.Provider>
				</StatusProvider>
			</SortProvider>,
		);

		expect(screen.getByText("info.processing")).toBeInTheDocument();
	});

	it("renders a centered backend error instead of a 500 page", async () => {
		renderServerPage(
			{
				connected: false,
				lastData: null,
			},
			{ backendError: new Error("settings failed") },
		);

		expect(
			screen.getByText("error.backendUnavailableTitle"),
		).toBeInTheDocument();
		expect(
			screen.getByText("error.backendUnavailableDescription"),
		).toBeInTheDocument();
		expect(screen.getByText("settings failed")).toBeInTheDocument();
		expect(
			screen.queryByText("info.websocketConnecting"),
		).not.toBeInTheDocument();
	});

	it("shows backend query errors while waiting for websocket data", async () => {
		apiMocks.fetchServerGroup.mockRejectedValue(new Error("group failed"));
		apiMocks.fetchService.mockRejectedValue(new Error("service failed"));

		renderServerPage({
			connected: false,
			lastData: null,
		});

		expect(
			await screen.findByText("error.backendUnavailableTitle"),
		).toBeInTheDocument();
		expect(screen.getByText("group failed")).toBeInTheDocument();
	});

	it("summarizes online and offline servers from websocket data", async () => {
		const online = createServer({ id: 1, name: "alpha" });
		const offline = createServer({
			id: 2,
			name: "beta",
			last_active: "2024-12-31T23:00:00.000Z",
		});

		renderServerPage({
			connected: true,
			lastData: websocketPayload([online, offline]),
		});

		expect(screen.getByTestId("server-overview")).toHaveTextContent("2:1:1");
		expect(screen.getAllByTestId("server-card")).toHaveLength(2);
		expect(screen.getByText("alpha")).toBeInTheDocument();
		expect(screen.getByText("beta")).toBeInTheDocument();

		await waitFor(() => {
			expect(apiMocks.fetchServerGroup).toHaveBeenCalled();
			expect(apiMocks.fetchService).toHaveBeenCalled();
		});
	});

	it("shows an empty state and hides controls when there are no servers", () => {
		const { container } = renderServerPage({
			connected: true,
			lastData: websocketPayload([]),
		});

		expect(screen.getByTestId("server-overview")).toHaveTextContent("0:0:0");
		expect(screen.getByText("info.noServers")).toBeInTheDocument();
		expect(
			container.querySelector(".server-overview-controls"),
		).not.toBeVisible();
		expect(screen.queryByTestId("server-card")).not.toBeInTheDocument();
		expect(screen.queryByTestId("global-map")).not.toBeInTheDocument();
		expect(screen.queryByTestId("service-tracker")).not.toBeInTheDocument();
	});

	it("shows a filtered empty state while keeping controls available", async () => {
		const offline = createServer({
			id: 1,
			name: "offline",
			last_active: "2024-12-31T23:00:00.000Z",
		});
		const user = userEvent.setup();

		const { container } = renderServerPage(
			{
				connected: true,
				lastData: websocketPayload([offline]),
			},
			{ withStatusControl: true },
		);

		await user.click(screen.getByRole("button", { name: "online-only" }));

		expect(screen.getByText("info.noMatchingServers")).toBeInTheDocument();
		expect(container.querySelector(".server-overview-controls")).not.toBeNull();
		expect(screen.queryByTestId("server-card")).not.toBeInTheDocument();
	});

	it("filters servers by selected group", async () => {
		const online = createServer({ id: 1, name: "alpha" });
		const offline = createServer({
			id: 2,
			name: "beta",
			last_active: "2024-12-31T23:00:00.000Z",
		});
		const user = userEvent.setup();

		renderServerPage({
			connected: true,
			lastData: websocketPayload([online, offline]),
		});

		await user.click(await screen.findByTestId("group-Edge"));

		expect(screen.queryByText("alpha")).not.toBeInTheDocument();
		expect(screen.getByText("beta")).toBeInTheDocument();
		expect(sessionStorage.getItem("selectedGroup")).toBe("Edge");
	});

	it("sorts server cards by selected metrics and direction", async () => {
		const lowCpu = createServer({
			id: 1,
			name: "alpha",
			state: { cpu: 10 },
		});
		const highCpu = createServer({
			id: 2,
			name: "beta",
			state: { cpu: 90 },
		});
		const user = userEvent.setup();

		renderServerPage({
			connected: true,
			lastData: websocketPayload([lowCpu, highCpu]),
		});

		await user.click(screen.getByRole("button", { name: "Sort metric" }));
		await user.click(screen.getByRole("menuitemradio", { name: "sort.types.cpu" }));
		expect(screen.getAllByTestId("server-card")[0]).toHaveTextContent("beta");

		await user.click(screen.getByLabelText("Toggle sort direction"));
		expect(screen.getAllByTestId("server-card")[0]).toHaveTextContent("alpha");
	});

	it("keeps name sorting independent from online status", async () => {
		const onlineAlpha = createServer({
			id: 1,
			name: "alpha",
		});
		const offlineZeta = createServer({
			id: 2,
			name: "zeta",
			last_active: "2024-12-31T23:00:00.000Z",
		});
		const user = userEvent.setup();

		renderServerPage({
			connected: true,
			lastData: websocketPayload([onlineAlpha, offlineZeta]),
		});

		expect(screen.getByLabelText("Toggle sort direction")).toBeDisabled();

		await user.click(screen.getByRole("button", { name: "Sort metric" }));
		await user.click(screen.getByRole("menuitemradio", { name: "sort.types.name" }));

		expect(screen.getAllByTestId("server-card")[0]).toHaveTextContent("zeta");

		await user.click(screen.getByLabelText("Toggle sort direction"));
		expect(screen.getAllByTestId("server-card")[0]).toHaveTextContent("alpha");
	});

	it("sorts by system even when a platform value is missing", async () => {
		const missingPlatform = createServer({
			id: 1,
			name: "alpha",
			host: { platform: undefined },
		});
		const linux = createServer({
			id: 2,
			name: "beta",
			host: { platform: "linux" },
		});
		const user = userEvent.setup();

		renderServerPage({
			connected: true,
			lastData: websocketPayload([missingPlatform, linux]),
		});

		await user.click(screen.getByRole("button", { name: "Sort metric" }));
		await user.click(screen.getByRole("menuitemradio", { name: "sort.types.system" }));

		const cards = screen.getAllByTestId("server-card");
		expect(cards).toHaveLength(2);
		expect(cards[0]).toHaveTextContent("beta");
		expect(cards[1]).toHaveTextContent("alpha");
	});

	it("restores the saved main page scroll position after data is ready", async () => {
		const scrollTo = vi.fn();
		vi.stubGlobal("scrollTo", scrollTo);
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			callback(0);
			return 0;
		});
		sessionStorage.setItem("fromMainPage", "true");
		sessionStorage.setItem("scrollPosition", "345");

		renderServerPage({
			connected: true,
			lastData: websocketPayload([createServer({ id: 1, name: "alpha" })]),
		});

		await waitFor(() => {
			expect(scrollTo).toHaveBeenCalledWith({
				top: 345,
				left: 0,
				behavior: "instant",
			});
		});
	});

	it("does not restore stale scroll positions without a main page origin", () => {
		const scrollTo = vi.fn();
		vi.stubGlobal("scrollTo", scrollTo);
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			callback(0);
			return 0;
		});
		sessionStorage.setItem("scrollPosition", "345");

		renderServerPage({
			connected: true,
			lastData: websocketPayload([createServer({ id: 1, name: "alpha" })]),
		});

		expect(scrollTo).not.toHaveBeenCalledWith({
			top: 345,
			left: 0,
			behavior: "instant",
		});
	});

	it("renders every card in large server lists without virtualization", () => {
		const servers = Array.from({ length: 2000 }, (_, index) =>
			createServer({ id: index + 1, name: `server-${index + 1}` }),
		);

		renderServerPage({
			connected: true,
			lastData: websocketPayload(servers),
		});

		expect(screen.getByTestId("server-overview")).toHaveTextContent(
			"2000:2000:0",
		);
		expect(screen.getAllByTestId("server-card")).toHaveLength(2000);
	});

	it("toggles map and service tracker controls when service data exists", async () => {
		apiMocks.fetchService.mockResolvedValue({
			success: true,
			data: {
				services: {
					http: {
						service_name: "HTTP",
						current_up: 1,
						current_down: 0,
						total_up: 1,
						total_down: 0,
						delay: [10],
						up: [1],
						down: [0],
					},
				},
				cycle_transfer_stats: {},
			},
		});
		const user = userEvent.setup();
		const online = createServer({ id: 1, name: "alpha" });
		const offline = createServer({
			id: 2,
			name: "beta",
			last_active: "2024-12-31T23:00:00.000Z",
		});

		const { container } = renderServerPage({
			connected: true,
			lastData: websocketPayload([online, offline]),
		});

		await waitFor(() => {
			expect(apiMocks.fetchService).toHaveBeenCalled();
			expect(
				container.querySelectorAll(
					".server-overview-controls section > button",
				),
			).toHaveLength(3);
		});

		const controls = container.querySelectorAll(
			".server-overview-controls section > button",
		);
		await user.click(controls[0]);
		expect(screen.getByTestId("global-map")).toHaveTextContent("2");
		expect(localStorage.getItem("showMap")).toBe("1");

		await user.click(controls[1]);
		expect(screen.queryByTestId("service-tracker")).not.toBeInTheDocument();
		await user.click(screen.getByRole("menuitemradio", { name: "statistics.uptime" }));
		expect(screen.getByTestId("service-tracker")).toHaveTextContent("2");
		expect(screen.getByTestId("service-tracker")).toHaveAttribute("data-view", "uptime");
		expect(localStorage.getItem("statisticsView")).toBe("uptime");
		await user.click(controls[1]);
		expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
		expect(screen.queryByRole("menuitemradio", { name: "statistics.close" })).not.toBeInTheDocument();
		await user.click(screen.getByRole("menuitemradio", { name: "statistics.uptime" }));
		expect(screen.queryByTestId("service-tracker")).not.toBeInTheDocument();
		expect(localStorage.getItem("statisticsView")).toBe("closed");
	});


	it.each([undefined, doraemonPresentation])("offers traffic-only statistics in each theme", async (presentation) => {
		apiMocks.fetchService.mockResolvedValue({success:true, data:{services:{},cycle_transfer_stats:{monthly:{}}}});
		const user = userEvent.setup();
		renderServerPage({connected:true,lastData:websocketPayload([createServer()])},{presentation});
		const button = await screen.findByRole("button",{name:"statistics.choose"});
		await user.click(button);
		await user.click(screen.getByRole("menuitemradio",{name:"statistics.traffic"}));
		expect(screen.getByTestId("service-tracker")).toHaveAttribute("data-view","traffic");
		expect(localStorage.getItem((presentation?.storagePrefix ?? "")+"statisticsView")).toBe("traffic");
		await user.click(button);
		expect(screen.getByRole("menuitemradio",{name:"statistics.traffic"})).toHaveAttribute("aria-checked","true");
		await user.click(screen.getByRole("menuitemradio",{name:"statistics.traffic"}));
		expect(screen.queryByTestId("service-tracker")).not.toBeInTheDocument();
		expect(localStorage.getItem((presentation?.storagePrefix ?? "")+"statisticsView")).toBe("closed");
		await user.click(button);
		expect(screen.getByRole("menuitemradio",{name:"statistics.traffic"})).toHaveAttribute("aria-checked","false");
		await user.click(screen.getByRole("menuitemradio",{name:"statistics.traffic"}));
		expect(screen.getByTestId("service-tracker")).toHaveAttribute("data-view","traffic");
		await user.click(button);
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(button).toHaveFocus();
	});

	it.each([false, true])("keeps the Doraemon map closed until clicked, including saved/forced state %s", async (forced) => {
		window.ForceShowMap = forced;
		localStorage.setItem("doraemon:showMap", "1");
		localStorage.setItem("showMap", "1");
		const user = userEvent.setup();
		const value = { connected: true, lastData: websocketPayload([createServer({ id: 1 })]) };
		const first = renderServerPage(value, { presentation: doraemonPresentation });
		expect(screen.queryByTestId("doraemon-map")).not.toBeInTheDocument();
		const toggle = screen.getByRole("button", { name: "切换地区地图" });
		await user.click(toggle);
		expect(screen.getByTestId("doraemon-map")).toBeInTheDocument();
		await user.click(toggle);
		expect(screen.queryByTestId("doraemon-map")).not.toBeInTheDocument();
		await user.click(toggle);
		first.unmount();
		renderServerPage(value, { presentation: doraemonPresentation });
		expect(screen.queryByTestId("doraemon-map")).not.toBeInTheDocument();
		expect(localStorage.getItem("showMap")).toBe("1");
	});

	it.each(["saved", "forced"])("preserves the default theme's %s map preference", (mode) => {
		if (mode === "saved") localStorage.setItem("showMap", "1");
		window.ForceShowMap = mode === "forced";
		renderServerPage({ connected: true, lastData: websocketPayload([createServer({ id: 1 })]) });
		expect(screen.getByTestId("global-map")).toBeInTheDocument();
	});

	it("does not enable inline cards from storage on mobile widths", () => {
		localStorage.setItem("inline", "1");
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 500,
		});
		const online = createServer({ id: 1, name: "alpha" });

		renderServerPage({
			connected: true,
			lastData: websocketPayload([online]),
		});

		expect(screen.getByTestId("server-card")).toHaveTextContent("alpha");
		expect(screen.queryByTestId("server-card-inline")).not.toBeInTheDocument();
	});

	it("applies external status filters and inline card preferences", async () => {
		localStorage.setItem("inline", "1");
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 1024,
		});
		const online = createServer({ id: 1, name: "alpha" });
		const offline = createServer({
			id: 2,
			name: "beta",
			last_active: "2024-12-31T23:00:00.000Z",
		});
		const user = userEvent.setup();

		renderServerPage(
			{
				connected: true,
				lastData: websocketPayload([online, offline]),
			},
			{ withStatusControl: true },
		);

		await waitFor(() => {
			expect(screen.getAllByTestId("server-card-inline")).toHaveLength(2);
		});

		await user.click(screen.getByRole("button", { name: "online-only" }));

		expect(screen.getAllByTestId("server-card-inline")).toHaveLength(1);
		expect(screen.getByText("alpha")).toBeInTheDocument();
		expect(screen.queryByText("beta")).not.toBeInTheDocument();
	});
});
it("combines statistics without a menu when global split is disabled",async()=>{
 apiMocks.fetchServerGroup.mockResolvedValue({success:true,data:[]});
 apiMocks.fetchService.mockResolvedValue({success:true,data:{services:{},cycle_transfer_stats:{}}});
 apiMocks.fetchSetting.mockResolvedValue({success:true,data:{config:{statistics_split:false}}});
 renderServerPage({lastData:websocketPayload([createServer()])});
 const trigger=await screen.findByRole("button",{name:"statistics.toggle"});
 await userEvent.click(trigger);
 expect(screen.queryByRole("menu")).not.toBeInTheDocument();
 expect(screen.getByTestId("service-tracker")).toHaveAttribute("data-view","both");
 await userEvent.click(trigger);
 expect(screen.queryByTestId("service-tracker")).not.toBeInTheDocument();
});
