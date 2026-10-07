import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test/utils";
import type { ReactElement } from "react";
import ErrorPage from "@/pages/ErrorPage";
import { createServer } from "@/test/fixtures";
const websocket = vi.hoisted(() => ({ reconnect: vi.fn(), lastData: null as {now:number; servers: ReturnType<typeof createServer>[]} | null }));
vi.mock("@/hooks/use-websocket-context", () => ({useWebSocketContext: () => websocket}));

const apiMocks = vi.hoisted(() => ({ fetchSetting: vi.fn(), fetchLoginUser: vi.fn().mockResolvedValue({success:false}), fetchMonitor: vi.fn().mockResolvedValue({success:true,data:[]}) }));
vi.mock("@/lib/nezha-api", () => apiMocks);
function renderDetail(ui: ReactElement) {
	return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
}
import NotFound from "@/pages/NotFound";
import ServerDetail from "@/pages/ServerDetail";

vi.mock("@/components/NetworkChart", () => ({
	NetworkChart: ({ server_id, show }: { server_id: number; show: boolean }) => (
		<div data-testid="network-chart">{`${server_id}:${show}`}</div>
	),
}));

vi.mock("@/components/ServerDetailChart", () => ({
	default: ({ server_id }: { server_id: string }) => (
		<div data-testid="detail-chart">{server_id}</div>
	),
}));

vi.mock("@/components/ServerDetailOverview", () => ({
	default: ({ server_id }: { server_id: string }) => (
		<div data-testid="detail-overview">{server_id}</div>
	),
}));

vi.mock("@/components/TabSwitch", () => ({
	default: ({
		tabs,
		setCurrentTab,
	}: {
		tabs: string[];
		setCurrentTab: (tab: string) => void;
	}) => (
		<div>
			{tabs.map((tab) => (
				<button key={tab} type="button" onClick={() => setCurrentTab(tab)}>
					{tab}
				</button>
			))}
		</div>
	),
}));

function LocationProbe() {
	const location = useLocation();
	return <p>{location.pathname}</p>;
}

describe("simple pages", () => {
	it("renders explicit and translated error messages", () => {
		const { rerender } = render(<ErrorPage code={418} message="short" />);

		expect(screen.getByText("418")).toBeInTheDocument();
		expect(screen.getByText("short")).toBeInTheDocument();

		rerender(<ErrorPage />);
		expect(screen.getByText("error.somethingWentWrong")).toBeInTheDocument();
	});

	it("navigates back home from the not found page", async () => {
		const user = userEvent.setup();
		render(
			<MemoryRouter initialEntries={["/missing"]}>
				<Routes>
					<Route
						path="/missing"
						element={
							<>
								<NotFound />
								<LocationProbe />
							</>
						}
					/>
					<Route
						path="/"
						element={
							<>
								<p>home</p>
								<LocationProbe />
							</>
						}
					/>
				</Routes>
			</MemoryRouter>,
		);

		expect(screen.getByText("404")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "error.backToHome" }));
		expect(screen.getByText("home")).toBeInTheDocument();
		expect(screen.getByText("/")).toBeInTheDocument();
	});
});

describe("ServerDetail", () => {
	afterEach(() => vi.useRealTimers());
	beforeEach(() => {
		websocket.reconnect.mockClear();
		vi.stubGlobal("scrollTo", vi.fn());
		const now = Date.now();
		websocket.lastData = {now,servers:[createServer({id:7,last_active:new Date(now).toISOString()})]};
		apiMocks.fetchSetting.mockResolvedValue({success:true,data:{config:{show_network_in_detail:false}}});
	});

	it("renders detail tab by default and can switch to network tab", async () => {
		const user = userEvent.setup();
		renderDetail(
			<MemoryRouter initialEntries={["/server/7"]}>
				<Routes>
					<Route path="/server/:id" element={<ServerDetail />} />
				</Routes>
			</MemoryRouter>,
		);

		expect(screen.getByTestId("detail-overview")).toHaveTextContent("7");
		expect(await screen.findByTestId("detail-chart")).toHaveTextContent("7");
		expect(screen.queryByTestId("network-chart")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Network" }));
		expect(await screen.findByTestId("network-chart")).toHaveTextContent(
			"7:true",
		);
		expect(screen.queryByTestId("detail-chart")).not.toBeInTheDocument();
	});

	it("merges network below details and hides the separate network tab", async () => {
		apiMocks.fetchSetting.mockResolvedValue({success:true,data:{config:{show_network_in_detail:true}}});
		const user = userEvent.setup();
		renderDetail(<MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter>);
		const network = await screen.findByTestId("network-chart");
		expect(screen.getByTestId("detail-chart").compareDocumentPosition(network) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.queryByRole("button", {name:"Network"})).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", {name:"Detail"}));
		expect(screen.getAllByTestId("network-chart")).toHaveLength(1);
		expect(screen.getByTestId("network-chart")).toBe(network);
		expect(screen.getByTestId("detail-chart")).toBeInTheDocument();
	});

	it("shows the overview before tabs while settings are unresolved", async () => {
		apiMocks.fetchSetting.mockReturnValue(new Promise(() => {}));
		renderDetail(<MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter>);
		expect(screen.getByTestId("detail-overview")).toBeInTheDocument();
		expect(screen.queryByTestId("detail-chart")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", {name:"Detail"})).not.toBeInTheDocument();
		expect(screen.queryByTestId("network-chart")).not.toBeInTheDocument();
	});

	it("waits for node information before mounting interactive tabs", async () => {
		websocket.lastData = null;
		const ui = <MemoryRouter initialEntries={["/server/7"]}><Routes><Route path="/server/:id" element={<ServerDetail/>}/></Routes></MemoryRouter>;
		const view = renderDetail(ui);
		expect(screen.getByTestId("detail-overview")).toBeInTheDocument();
		expect(screen.queryByRole("button", {name:"Detail"})).not.toBeInTheDocument();
		const now = Date.now();
		websocket.lastData = {now,servers:[createServer({id:7,last_active:new Date(now).toISOString()})]};
		view.rerender(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
		expect(await screen.findByTestId("detail-chart")).toBeInTheDocument();
		expect(screen.getByRole("button", {name:"Detail"})).toBeVisible();
	});

	it.each(["99999999", "0", "-1", "invalid", "9007199254740992"])("shows an unavailable state for node %s instead of an endless skeleton", async (id) => {
		renderDetail(<MemoryRouter initialEntries={[`/server/${id}`]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
			<Route path="/" element={<p>node list</p>} />
		</Routes></MemoryRouter>);
		expect(screen.getByText("节点不存在或无权查看")).toBeVisible();
		expect(screen.queryByTestId("detail-overview")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", {name: "Detail"})).not.toBeInTheDocument();
		await userEvent.setup().click(screen.getByRole("link", {name: "返回列表"}));
		expect(screen.getByText("node list")).toBeVisible();
	});

	it("handles a removed node and recovers when a later authorized frame contains it", async () => {
		const client = createTestQueryClient();
		const ui = <QueryClientProvider client={client}><MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter></QueryClientProvider>;
		const view = render(ui);
		expect(await screen.findByTestId("detail-chart")).toBeVisible();
		const original = websocket.lastData;
		websocket.lastData = {now: Date.now(), servers: []};
		view.rerender(ui);
		// Force a context consumer render without changing the router or its scroll state.
		view.rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter></QueryClientProvider>);
		expect(screen.getByText("节点不存在或无权查看")).toBeVisible();
		fireEvent.click(screen.getByRole("button", {name: "重新加载"}));
		expect(websocket.reconnect).toHaveBeenCalledTimes(1);
		websocket.lastData = original;
		view.rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter></QueryClientProvider>);
		expect(await screen.findByTestId("detail-chart")).toBeVisible();
	});

	it("offers retry after the initial connection times out without reporting a missing node", async () => {
		vi.useFakeTimers();
		websocket.lastData = null;
		apiMocks.fetchSetting.mockReturnValue(new Promise(() => {}));
		renderDetail(<MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter>);
		expect(screen.getByTestId("detail-overview")).toBeVisible();
		await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
		expect(screen.getByText("暂时无法加载节点信息，请稍后重试")).toBeVisible();
		expect(screen.queryByText("节点不存在或无权查看")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", {name: "重新加载"}));
		expect(websocket.reconnect).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("detail-overview")).toBeVisible();
	});

	it("shows a recoverable error when settings fail and loads after retry", async () => {
		apiMocks.fetchSetting.mockRejectedValueOnce(new Error("offline"));
		renderDetail(<MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter>);
		expect(await screen.findByText("暂时无法加载节点信息，请稍后重试")).toBeVisible();
		await userEvent.setup().click(screen.getByRole("button", {name: "重新加载"}));
		expect(await screen.findByTestId("detail-chart")).toBeVisible();
	});

	it("redirects when route params are missing", async () => {
		renderDetail(
			<MemoryRouter initialEntries={["/server"]}>
				<Routes>
					<Route path="/server" element={<ServerDetail />} />
					<Route path="/404" element={<p>redirected</p>} />
				</Routes>
			</MemoryRouter>,
		);

		expect(await screen.findByText("redirected")).toBeInTheDocument();
	});
});
