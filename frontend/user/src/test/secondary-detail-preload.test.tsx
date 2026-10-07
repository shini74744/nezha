import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePrimaryDetailPreload } from "@/hooks/use-primary-detail-preload";
import { connectivityQueryOptions, insightQueryOptions } from "@/lib/detail-result-query";

const mocks = vi.hoisted(() => ({
	monitor: vi.fn(), member: vi.fn(), read: vi.fn(), insight: vi.fn(),
	detail: vi.fn(), network: vi.fn(), section: vi.fn(), connectivity: vi.fn(), media: vi.fn(), bgp: vi.fn(),
}));
vi.mock("@/lib/nezha-api", () => ({ fetchMonitor: mocks.monitor, fetchLoginUser: mocks.member }));
vi.mock("@/lib/connectivity-api", () => ({ fetchConnectivity: mocks.read }));
vi.mock("@/lib/network-insight-api", () => ({ insightRequest: mocks.insight }));
vi.mock("@/lib/detail-modules", () => ({
	loadServerDetailChart: mocks.detail, loadNetworkChart: mocks.network, loadServerNetworkSection: mocks.section,
	loadServerConnectivity: mocks.connectivity, loadServerNetworkInsight: mocks.media, loadBGPTopology: mocks.bgp,
}));
let clients: QueryClient[] = [], idle: (() => void)[] = [];
function client() {
	const c = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
	clients.push(c); return c;
}
function deferred<T = unknown>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => { resolve = r; });
	return { promise, resolve };
}
beforeEach(() => {
	vi.clearAllMocks(); idle = [];
	vi.stubGlobal("requestIdleCallback", (fn: () => void) => { idle.push(fn); return idle.length; });
	vi.stubGlobal("cancelIdleCallback", (id: number) => { idle[id - 1] = () => {}; });
	for (const load of [mocks.detail, mocks.network, mocks.section, mocks.connectivity, mocks.media, mocks.bgp]) load.mockResolvedValue({});
	mocks.monitor.mockResolvedValue({ success: true, data: [] });
	mocks.member.mockResolvedValue({ success: true, data: { id: 42 } });
	mocks.read.mockImplementation(async id => ({ server_id: id, state: "complete", results: [] }));
	mocks.insight.mockImplementation(async id => ({ server_id: id, state: "complete", topologies: [] }));
});
afterEach(() => { cleanup(); for (const c of clients) c.clear(); clients = []; vi.unstubAllGlobals(); });
function Entry({ id = 7, enabled = true }: { id?: number; enabled?: boolean }) {
	const warm = usePrimaryDetailPreload(id, { connectivity: enabled, bgp: enabled, streaming: enabled });
	return <>{["Connectivity", "BGP", "Streaming"].map(tab => <button key={tab} onClick={() => void warm(tab)}>{tab}</button>)}</>;
}
async function nextIdle() {
	await waitFor(() => expect(idle.length).toBeGreaterThan(0));
	const fn = idle.shift()!;
	await act(async () => { fn(); });
}
it("issues primary work first then preloads secondary results concurrently without hidden polling", async () => {
	const primary = deferred(); mocks.network.mockReturnValue(primary.promise);
	const c = client(); render(<QueryClientProvider client={c}><Entry /></QueryClientProvider>);
	await waitFor(() => expect(mocks.monitor).toHaveBeenCalledOnce());
	expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.insight).not.toHaveBeenCalled();
	await nextIdle();
	await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
	expect(mocks.insight).not.toHaveBeenCalled();
	await nextIdle();
	await waitFor(() => expect(mocks.insight).toHaveBeenCalledWith(7, "streaming", "GET", undefined, "low"));
	expect(mocks.bgp).not.toHaveBeenCalled();
	await nextIdle();
	await waitFor(() => expect(mocks.insight).toHaveBeenCalledWith(7, "bgp", "GET", undefined, "low"));
	expect(c.getQueryData(["network-insight", 7, "bgp", 42])).toBeDefined();
	expect(c.getQueryData(["network-insight", 7, "bgp", 0])).toBeUndefined();
	expect(c.getQueryCache().getAll().every(q => q.getObserversCount() === 0)).toBe(true);
});
it("intent starts data independently of slow primary and secondary modules and deduplicates repeated intent", async () => {
	const pending = deferred(); mocks.network.mockReturnValue(pending.promise); mocks.connectivity.mockReturnValue(pending.promise);
	const c = client(); render(<QueryClientProvider client={c}><Entry /></QueryClientProvider>);
	await act(async () => { screen.getByText("Connectivity").click(); screen.getByText("Connectivity").click(); });
	await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
	await act(async () => screen.getByText("Connectivity").click());
	expect(mocks.read).toHaveBeenCalledWith(7); // Active intent is not low priority.
	expect(mocks.read).toHaveBeenCalledOnce();
});
it("disabled features do not import secondary code or read records even on intent", async () => {
	const c = client(); render(<QueryClientProvider client={c}><Entry enabled={false} /></QueryClientProvider>);
	await act(async () => { for (const button of screen.getAllByRole("button")) button.click(); });
	await nextIdle(); await nextIdle(); await nextIdle();
	expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.insight).not.toHaveBeenCalled();
	expect(mocks.connectivity).not.toHaveBeenCalled(); expect(mocks.media).not.toHaveBeenCalled();
});
it("leaving during primary loading cancels all scheduled secondary warming", async () => {
	const primary = deferred(); mocks.network.mockReturnValue(primary.promise);
	const c = client(); const view = render(<QueryClientProvider client={c}><Entry /></QueryClientProvider>);
	await waitFor(() => expect(mocks.monitor).toHaveBeenCalledOnce());
	view.unmount(); await act(async () => primary.resolve({}));
	for (const fn of idle) await act(async () => fn());
	expect(mocks.read).not.toHaveBeenCalled();
});
function Pane({ id, kind }: { id: number; kind: "connectivity" | "bgp" }) {
	return kind === "connectivity" ? <ConnectivityPane id={id} /> : <BGPPane id={id} />;
}
function ConnectivityPane({id}: {id: number}) {
	const query = useQuery(connectivityQueryOptions(id));
	return <output>{query.data?.server_id}</output>;
}
function BGPPane({id}: {id: number}) {
	const query = useQuery(insightQueryOptions(id, "bgp", 42));
	return <output>{query.data?.server_id}</output>;
}
for (const kind of ["connectivity", "bgp"] as const) it(kind + " retains in-flight read through rapid tab unmounts and isolates late nodes", async () => {
	const read = kind === "connectivity" ? mocks.read : mocks.insight;
	const old = deferred(); read.mockImplementation(id => id === 7 ? old.promise : Promise.resolve({ server_id: id, state: "complete" }));
	const c = client();
	const view = render(<QueryClientProvider client={c}><Pane id={7} kind={kind} /></QueryClientProvider>);
	await waitFor(() => expect(read).toHaveBeenCalledOnce());
	view.rerender(<QueryClientProvider client={c}><div /></QueryClientProvider>);
	view.rerender(<QueryClientProvider client={c}><Pane id={7} kind={kind} /></QueryClientProvider>);
	expect(read).toHaveBeenCalledOnce();
	view.rerender(<QueryClientProvider client={c}><Pane id={8} kind={kind} /></QueryClientProvider>);
	await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("8"));
	await act(async () => old.resolve({ server_id: 7, state: "complete" }));
	expect(screen.getByRole("status")).toHaveTextContent("8");
});
for (const kind of ["connectivity", "bgp"] as const) it(kind + " explicit cancellation protects new manual results from late background responses", async () => {
	const read = kind === "connectivity" ? mocks.read : mocks.insight;
	const old = deferred(); read.mockReturnValue(old.promise);
	const c = client(), options = kind === "connectivity" ? connectivityQueryOptions(7) : insightQueryOptions(7, kind, 42);
	const pending = kind === "connectivity" ? c.prefetchQuery(connectivityQueryOptions(7)) : c.prefetchQuery(insightQueryOptions(7, kind, 42));
	await c.cancelQueries({ queryKey: options.queryKey });
	c.setQueryData([...options.queryKey], { server_id: 7, state: "running", started_at: 123, can_run: true, online: true, results: [], rounds: 3 });
	old.resolve({ server_id: 7, state: "complete", started_at: 1 }); await pending;
	expect(c.getQueryData(options.queryKey)).toMatchObject({ state: "running", started_at: 123 });
});
it("fresh results are reused but running and expired records refresh", async () => {
	const c = client(), options = connectivityQueryOptions(7);
	await c.prefetchQuery(options); await c.prefetchQuery(options); expect(mocks.read).toHaveBeenCalledOnce();
	c.setQueryData(options.queryKey, { server_id: 7, state: "running", results: [], can_run: false, online: true, rounds: 3 });
	await c.prefetchQuery(options); expect(mocks.read).toHaveBeenCalledTimes(2);
	c.setQueryData(options.queryKey, { server_id: 7, state: "complete", results: [], can_run: false, online: true, rounds: 3 }, { updatedAt: Date.now() - 16000 });
	await c.prefetchQuery(options); expect(mocks.read).toHaveBeenCalledTimes(3);
});

it("waits for identity before preloading private BGP results into a viewer-scoped cache", async () => {
	const member = deferred(); mocks.member.mockReturnValue(member.promise);
	const c = client(); render(<QueryClientProvider client={c}><Entry /></QueryClientProvider>);
	await act(async () => screen.getByText("BGP").click());
	expect(mocks.insight).not.toHaveBeenCalled();
	await act(async () => member.resolve({ success: true, data: { id: 42 } }));
	await waitFor(() => expect(mocks.insight).toHaveBeenCalledOnce());
	expect(c.getQueryData(["network-insight", 7, "bgp", 0])).toBeUndefined();
	expect(c.getQueryData(["network-insight", 7, "bgp", 42])).toBeDefined();
});
it("a failed profile uses only the guest cache and cannot reuse administrator data", async () => {
	mocks.member.mockRejectedValue(new Error("unauthorized"));
	const c = client();
	c.setQueryData(["network-insight", 7, "bgp", 42], { secret: "admin-only" });
	render(<QueryClientProvider client={c}><Entry /></QueryClientProvider>);
	await act(async () => screen.getByText("BGP").click());
	await waitFor(() => expect(c.getQueryData(["network-insight", 7, "bgp", 0])).toBeDefined());
	expect(c.getQueryData(["network-insight", 7, "bgp", 0])).not.toHaveProperty("secret");
});
