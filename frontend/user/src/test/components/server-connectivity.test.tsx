import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServerConnectivity from "@/components/ServerConnectivity";
import { createTestQueryClient } from "@/test/utils";
import type { ConnectivityData } from "@/lib/connectivity-api";

const api = vi.hoisted(() => ({
	fetchConnectivity: vi.fn(),
	startConnectivity: vi.fn(),
}));
vi.mock("@/lib/connectivity-api", () => api);
function data(patch: Partial<ConnectivityData> = {}): ConnectivityData {
	return {
		server_id: 7,
		online: true,
		can_run: true,
		state: "idle",
		rounds: 3,
		results: [
			{
				id: "google",
				name: "Google",
				group: "global",
				host: "www.google.com",
				status: "pending",
				samples: [],
			},
		],
		...patch,
	};
}
function mount(serverId = 7) {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<ServerConnectivity serverId={serverId} />
		</QueryClientProvider>,
	);
}
beforeEach(() => vi.clearAllMocks());
describe("node connectivity", () => {
	it("only reads cache on mount; does not automatically trigger node traffic", async () => {
		api.fetchConnectivity.mockResolvedValue(data());
		mount();
		expect(await screen.findByText("Google")).toBeVisible();
		expect(api.startConnectivity).not.toHaveBeenCalled();
		expect(api.fetchConnectivity.mock.calls[0][0]).toBe(7);
	});
	it("visitors see cached results but no trigger", async () => {
		api.fetchConnectivity.mockResolvedValue(
			data({ can_run: false, state: "complete" }),
		);
		mount();
		expect(await screen.findByText("connectivity.readOnly")).toBeVisible();
		expect(
			screen.queryByRole("button", { name: "connectivity.start" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "connectivity.retest" }),
		).not.toBeInTheDocument();
		expect(api.startConnectivity).not.toHaveBeenCalled();
	});
	it("owner can start once and sees pending state", async () => {
		api.fetchConnectivity.mockResolvedValue(data());
		api.startConnectivity.mockResolvedValue(
			data({ state: "running", started_at: Date.now() }),
		);
		mount();
		fireEvent.click(
			await screen.findByRole("button", { name: "connectivity.start" }),
		);
		await waitFor(() => expect(api.startConnectivity).toHaveBeenCalledTimes(1));
		expect(
			await screen.findByRole("button", { name: "connectivity.testing" }),
		).toBeDisabled();
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"0",
		);
	});
	it("offline cache is marked historical and cannot run", async () => {
		api.fetchConnectivity.mockResolvedValue(
			data({
				online: false,
				state: "complete",
				finished_at: Date.now() - 60000,
			}),
		);
		mount();
		expect(await screen.findByText("connectivity.offline")).toBeVisible();
		expect(
			screen.getByRole("button", { name: "connectivity.retest" }),
		).toBeDisabled();
	});
	it("HTTP 403 is distinguished from network failure and zero delay is valid", async () => {
		api.fetchConnectivity.mockResolvedValue(
			data({
				state: "complete",
				results: [
					{
						id: "google",
						name: "Google",
						group: "global",
						host: "www.google.com",
						status: "http_error",
						samples: [{ status: "http_error", http_status: 403, delay_ms: 0 }],
						delay_ms: 0,
					},
				],
			}),
		);
		mount();
		expect(
			await screen.findByText("connectivity.status.http_error"),
		).toBeVisible();
		expect(screen.getByText("(HTTP 403)")).toBeVisible();
		expect(screen.getByText("0.0")).toBeVisible();
	});
	it("cooldown disables retrigger and help is keyboard-operable", async () => {
		api.fetchConnectivity.mockResolvedValue(
			data({ state: "complete", retry_at: Date.now() + 60000 }),
		);
		mount();
		expect(
			await screen.findByRole("button", { name: "connectivity.cooldown" }),
		).toBeDisabled();
		const help = screen.getByRole("button", { name: "connectivity.helpTitle" });
		expect(help).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(help);
		expect(screen.getByText("connectivity.help")).toBeVisible();
		expect(help).toHaveAttribute("aria-expanded", "true");
	});
	it("mutation failure remains visible and does not claim a run started", async () => {
		api.fetchConnectivity.mockResolvedValue(data());
		api.startConnectivity.mockRejectedValue(new Error("connectivity_busy"));
		mount();
		fireEvent.click(
			await screen.findByRole("button", { name: "connectivity.start" }),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"connectivity.busy",
		);
	});
});

describe("expanded connectivity catalog", () => {
	it("renders all four regions, all 48 packaged logos and sample indicators", async () => {
		const { default: catalog } = await import(
			"../../../../../service/connectivity/catalog.json"
		);
		const { connectivityIcons } = await import("@/lib/connectivity-icons");
		expect(Object.keys(connectivityIcons).sort()).toEqual(
			catalog.map((row) => row.id).sort(),
		);
		const results = catalog.map(({ id, name, group, host }) => ({
			id,
			name,
			group: group as ConnectivityData["results"][number]["group"],
			host,
			status: "pending" as const,
			samples: [],
		}));
		api.fetchConnectivity.mockResolvedValue(data({ results }));
		const view = mount();
		await screen.findByText("DeepSeek");
		expect(
			view.container.querySelectorAll("[data-connectivity-target]"),
		).toHaveLength(48);
		expect(
			view.container.querySelectorAll("[data-connectivity-group]"),
		).toHaveLength(4);
		expect(
			view.container.querySelectorAll("img[data-connectivity-icon]"),
		).toHaveLength(48);
		expect(
			view.container.querySelectorAll("[data-connectivity-sample]"),
		).toHaveLength(144);
		for (const image of view.container.querySelectorAll(
			"img[data-connectivity-icon]",
		)) {
			expect(image.getAttribute("src")).not.toMatch(/^https?:\/\//);
		}
		expect(api.startConnectivity).not.toHaveBeenCalled();
	});
	it("keeps the site name visible and falls back safely if a logo fails", async () => {
		api.fetchConnectivity.mockResolvedValue(data());
		const view = mount();
		await screen.findByText("Google");
		const logo = view.container.querySelector("img[data-connectivity-icon]");
		expect(logo).not.toBeNull();
		if (!logo) throw new Error("packaged brand icon missing");
		fireEvent.error(logo);
		expect(
			view.container.querySelector("[data-connectivity-icon-fallback]"),
		).not.toBeNull();
		expect(screen.getByText("Google")).toBeVisible();
	});
});
