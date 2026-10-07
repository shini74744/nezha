import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePrimaryDetailPreload } from "@/hooks/use-primary-detail-preload";
import { monitorQueryOptions } from "@/lib/monitor-query";
import { createTestQueryClient } from "@/test/utils";

const clients: ReturnType<typeof createTestQueryClient>[] = [];
function preloadClient() {
	const client = createTestQueryClient();
	// The general test helper discards unobserved queries immediately; production
	// keeps them for five minutes, which is necessary to exercise preloading.
	client.setQueryDefaults(["monitor"], { gcTime: Infinity });
	clients.push(client);
	return client;
}
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

const mocks = vi.hoisted(() => ({
	fetchMonitor: vi.fn(), detail: vi.fn(), section: vi.fn(), network: vi.fn(),
}));
vi.mock("@/lib/nezha-api", () => ({ fetchMonitor: mocks.fetchMonitor }));
vi.mock("@/lib/detail-modules", () => ({
	loadServerDetailChart: mocks.detail,
	loadServerNetworkSection: mocks.section,
	loadNetworkChart: mocks.network,
}));
beforeEach(() => {
	vi.clearAllMocks();
	for (const load of [mocks.detail, mocks.section, mocks.network]) load.mockResolvedValue({});
	mocks.fetchMonitor.mockImplementation(async (id) => ({ success: true, data: [id] }));
});
function Network({ id }: { id: number }) {
	const { data } = useQuery(monitorQueryOptions(id, "1d"));
	return <div data-testid="network">{JSON.stringify(data?.data)}</div>;
}
function Entry({ id, show = false }: { id?: number; show?: boolean }) {
	usePrimaryDetailPreload(id);
	return show && id ? <Network id={id} /> : null;
}

it("starts both primary modules and network data without waiting for chart modules", async () => {
	for (const load of [mocks.detail, mocks.section, mocks.network]) load.mockReturnValue(new Promise(() => {}));
	const client = preloadClient();
	const view = render(<QueryClientProvider client={client}><Entry id={7} /></QueryClientProvider>);
	await waitFor(() => expect(mocks.fetchMonitor).toHaveBeenCalledWith(7, "1d"));
	for (const load of [mocks.detail, mocks.section, mocks.network]) expect(load).toHaveBeenCalledOnce();
	await waitFor(() => expect(client.getQueryData(["monitor", 7, "1d"])).toEqual({ success: true, data: [7] }));
	view.rerender(<QueryClientProvider client={client}><Entry id={7} show /></QueryClientProvider>);
	expect(await screen.findByTestId("network")).toHaveTextContent("[7]");
	expect(mocks.fetchMonitor).toHaveBeenCalledOnce();
});

it("shares an in-flight preload with a newly opened network pane", async () => {
	let resolve!: (value: unknown) => void;
	mocks.fetchMonitor.mockReturnValue(new Promise(r => { resolve = r; }));
	const client = preloadClient();
	const view = render(<QueryClientProvider client={client}><Entry id={7} /></QueryClientProvider>);
	await waitFor(() => expect(mocks.fetchMonitor).toHaveBeenCalledOnce());
	view.rerender(<QueryClientProvider client={client}><Entry id={7} show /></QueryClientProvider>);
	await act(async () => { resolve({ success: true, data: [7] }); });
	await waitFor(() => expect(screen.getByTestId("network")).toHaveTextContent("[7]"));
	expect(mocks.fetchMonitor).toHaveBeenCalledOnce();
});

it("isolates late results by node and does not preload again on ordinary rerenders", async () => {
	let finishOld!: (value: unknown) => void;
	mocks.fetchMonitor.mockImplementation(id => id === 7
		? new Promise(r => { finishOld = r; })
		: Promise.resolve({ success: true, data: [id] }));
	const client = preloadClient();
	const view = render(<QueryClientProvider client={client}><Entry id={7} /></QueryClientProvider>);
	await waitFor(() => expect(mocks.fetchMonitor).toHaveBeenCalledWith(7, "1d"));
	view.rerender(<QueryClientProvider client={client}><Entry id={8} show /></QueryClientProvider>);
	await waitFor(() => expect(screen.getByTestId("network")).toHaveTextContent("[8]"));
	await act(async () => { finishOld({ success: true, data: [7] }); });
	expect(screen.getByTestId("network")).toHaveTextContent("[8]");
	view.rerender(<QueryClientProvider client={client}><Entry id={8} show /></QueryClientProvider>);
	expect(mocks.fetchMonitor).toHaveBeenCalledTimes(2);
});

it("does not preload unknown or invalid nodes", () => {
	const client = preloadClient();
	const view = render(<QueryClientProvider client={client}><Entry /></QueryClientProvider>);
	for (const id of [0, -1, NaN, 1.5]) view.rerender(<QueryClientProvider client={client}><Entry id={id} /></QueryClientProvider>);
	expect(mocks.fetchMonitor).not.toHaveBeenCalled();
	expect(mocks.detail).not.toHaveBeenCalled();
});

it("refreshes cached data once it reaches the existing ten-second interval", async () => {
	const client = preloadClient();
	client.setQueryData(["monitor", 7, "1d"], { success: true, data: ["old"] }, { updatedAt: Date.now() - 11000 });
	render(<QueryClientProvider client={client}><Entry id={7} show /></QueryClientProvider>);
	await waitFor(() => expect(screen.getByTestId("network")).toHaveTextContent("[7]"));
	expect(mocks.fetchMonitor).toHaveBeenCalledOnce();
});
