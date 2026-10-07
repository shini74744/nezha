import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test/utils";
import type { ReactElement } from "react";
import ErrorPage from "@/pages/ErrorPage";

const apiMocks = vi.hoisted(() => ({ fetchSetting: vi.fn(), fetchMonitor: vi.fn().mockResolvedValue({success:true,data:[]}) }));
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
	beforeEach(() => {
		vi.stubGlobal("scrollTo", vi.fn());
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

	it("does not flash network while settings are unresolved", async () => {
		apiMocks.fetchSetting.mockReturnValue(new Promise(() => {}));
		renderDetail(<MemoryRouter initialEntries={["/server/7"]}><Routes>
			<Route path="/server/:id" element={<ServerDetail />} />
		</Routes></MemoryRouter>);
		expect(await screen.findByTestId("detail-chart")).toBeInTheDocument();
		expect(screen.queryByTestId("network-chart")).not.toBeInTheDocument();
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
