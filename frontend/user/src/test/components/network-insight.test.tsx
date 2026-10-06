import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test/utils";
import ServerNetworkInsight from "@/components/ServerNetworkInsight";
const api = vi.hoisted(() => ({
	insightRequest: vi.fn(),
	fetchLoginUser: vi.fn(),
	topology: vi.fn(),
}));
vi.mock("@/lib/nezha-api", () => ({ fetchLoginUser: api.fetchLoginUser }));
vi.mock("@/lib/network-insight-api", () => ({
	insightRequest: api.insightRequest,
}));
vi.mock("@/components/BGPTopology", () => ({
	default: (props: any) => {
		api.topology(props);
		return <div data-testid="topology">{props.topology.total}</div>;
	},
}));
const key = ["network-insight", 7, "bgp", 0];
const topology = (family: string, total: number) => ({
	family,
	total,
	status: "ok",
	source: "RIPE RIS",
	paths: [],
});
function result() {
	const slot = Date.parse("2026-10-06T16:00:00Z");
	const history = [0, 1].map((i) => ({
		state: "complete",
		finished_at: slot - i * 3600000 + 9000,
		scheduled_at: slot - i * 3600000,
		topologies: [topology("IPv4", 100 + i), topology("IPv6", 200 + i)],
	}));
	return {
		...history[0],
		server_id: 7,
		online: true,
		can_run: false,
		available_families: ["IPv4", "IPv6"],
		history,
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	api.fetchLoginUser.mockResolvedValue({ success: true, data: { id: 0 } });
	api.insightRequest.mockResolvedValue(result());
});
function mount() {
	const client = createTestQueryClient();
	const ui = (
		<QueryClientProvider client={client}>
			<ServerNetworkInsight serverId={7} kind="bgp" />
		</QueryClientProvider>
	);
	return { client, ui, ...render(ui) };
}
describe("network insight render isolation", () => {
	it("does not redraw the snapshot on unrelated parent renders, but updates new query data", async () => {
		const view = mount();
		await screen.findByTestId("topology");
		const count = api.topology.mock.calls.length;
		view.rerender(
			<QueryClientProvider client={view.client}>
				<ServerNetworkInsight serverId={7} kind="bgp" />
			</QueryClientProvider>,
		);
		expect(api.topology).toHaveBeenCalledTimes(count);
		await act(async () => {
			view.client.setQueryData(key, {
				...result(),
				topologies: [topology("IPv4", 333)],
			});
		});
		await waitFor(() =>
			expect(screen.getByTestId("topology")).toHaveTextContent("333"),
		);
	});
	it("keeps the selected history across protocol changes and returns to latest when it expires", async () => {
		const { client } = mount();
		const nav = await screen.findByRole("navigation", { name: "BGP 历史快照" });
		const buttons = within(nav).getAllByRole("button");
		expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(buttons[1]);
		expect(screen.getByTestId("topology")).toHaveTextContent("101");
		fireEvent.click(screen.getByRole("button", { name: "IPv6" }));
		expect(screen.getByTestId("topology")).toHaveTextContent("201");
		const fresh = result();
		fresh.history = fresh.history.slice(0, 1);
		await act(async () => {
			client.setQueryData(key, fresh);
		});
		await waitFor(() =>
			expect(within(nav).getAllByRole("button")).toHaveLength(1),
		);
		expect(within(nav).getByRole("button")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByTestId("topology")).toHaveTextContent("200");
	});
	it("reacts to IPv6 disappearing and returning without showing the wrong topology", async () => {
		const { client } = mount();
		await screen.findByTestId("topology");
		fireEvent.click(screen.getByRole("button", { name: "IPv6" }));
		await act(async () => {
			client.setQueryData(key, { ...result(), available_families: ["IPv4"] });
		});
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "IPv6" }),
			).not.toBeInTheDocument(),
		);
		expect(screen.getByTestId("topology")).toHaveTextContent("100");
		await act(async () => {
			client.setQueryData(key, result());
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "IPv6" })).toHaveAttribute(
				"aria-pressed",
				"true",
			),
		);
		expect(screen.getByTestId("topology")).toHaveTextContent("200");
		expect(
			api.insightRequest.mock.calls.every((call) => call[2] === "GET"),
		).toBe(true);
	});
});
