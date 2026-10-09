import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
	it.each([
		"idle",
		"running",
		"complete",
	] as const)("visitors see results without the controls or introduction in %s state", async (state) => {
		api.fetchConnectivity.mockResolvedValue(data({ can_run: false, state }));
		const view = mount();
		expect(await screen.findByText("Google")).toBeVisible();
		expect(
			view.container.querySelector("[data-connectivity-controls]"),
		).toBeNull();
		expect(screen.queryByText("connectivity.title")).not.toBeInTheDocument();
		expect(screen.queryByText("connectivity.origin")).not.toBeInTheDocument();
		expect(screen.queryByText("connectivity.readOnly")).not.toBeInTheDocument();
		expect(screen.getAllByRole("button")).toHaveLength(2);
		expect(screen.getByRole("button", { name: "connectivity.serverLatency" })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "connectivity.localLatency" })).toHaveAttribute("aria-pressed", "false");
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		expect(api.startConnectivity).not.toHaveBeenCalled();
	});
	it("does not flash the introduction while permissions are loading", async () => {
		let resolve!: (value: ConnectivityData) => void;
		api.fetchConnectivity.mockImplementationOnce(
			() =>
				new Promise<ConnectivityData>((done) => {
					resolve = done;
				}),
		);
		const view = mount();
		expect(screen.getByRole("status")).toHaveTextContent(
			"connectivity.loading",
		);
		expect(
			view.container.querySelector("[data-connectivity-controls]"),
		).toBeNull();
		expect(screen.queryByText("connectivity.title")).not.toBeInTheDocument();
		resolve(data({ can_run: false }));
		expect(await screen.findByText("Google")).toBeVisible();
		expect(screen.queryByText("connectivity.loading")).not.toBeInTheDocument();
	});
	it("visitors can recover a cache read failure without triggering detection", async () => {
		api.fetchConnectivity.mockRejectedValue(new Error("read failed"));
		const view = mount();
		expect(
			await screen.findByRole("alert", {}, { timeout: 3000 }),
		).toHaveTextContent("connectivity.readFailed");
		expect(
			view.container.querySelector("[data-connectivity-controls]"),
		).toBeNull();
		api.fetchConnectivity.mockResolvedValue(data({ can_run: false }));
		fireEvent.click(
			screen.getByRole("button", { name: "connectivity.reload" }),
		);
		expect(await screen.findByText("Google")).toBeVisible();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
	it.each([403, 404, 500])("HTTP %s with valid zero delay has no error copy or warning color", async (httpStatus) => {
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
						samples: [{ status: "http_error", http_status: httpStatus, delay_ms: 0 }],
						delay_ms: 0,
					},
				],
			}),
		);
		const view = mount();
		expect(await screen.findByText("0.0")).toBeVisible();
		expect(screen.queryByText("connectivity.status.http_error")).not.toBeInTheDocument();
		expect(screen.queryByText(/HTTP/)).not.toBeInTheDocument();
		expect(view.container.querySelector("[data-connectivity-delay]")).toHaveClass("text-emerald-700");
		expect(view.container.querySelector('[title*="http_error"]')).toBeNull();
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
	it("renders all supported regions, all 110 packaged logos and sample indicators", async () => {
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
		).toHaveLength(110);
		expect(
			view.container.querySelectorAll("[data-connectivity-group]"),
		).toHaveLength(18);
		expect(
			view.container.querySelectorAll("img[data-connectivity-icon]"),
		).toHaveLength(110);
		expect(
			view.container.querySelectorAll("[data-connectivity-sample]"),
		).toHaveLength(330);
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
describe("fair queue progress", () => {
	it("distinguishes queued, first request running and partial responses without counting partial sites as finished", async () => {
		const base = data().results[0];
		api.fetchConnectivity.mockResolvedValue(
			data({
				state: "running",
				results: [
					{
						...base,
						id: "google",
						phase: "queued",
						status: "pending",
						samples: [],
					},
					{
						...base,
						id: "github",
						name: "GitHub",
						phase: "running",
						status: "pending",
						samples: [],
					},
					{
						...base,
						id: "telegram",
						name: "Telegram",
						phase: "queued",
						status: "ok",
						delay_ms: 18,
						samples: [{ status: "ok", delay_ms: 18 }],
					},
					{
						...base,
						id: "discord",
						name: "Discord",
						phase: "complete",
						status: "timeout",
						samples: [{ status: "timeout" }],
					},
				],
			}),
		);
		const view = mount();
		await screen.findByText("Telegram");
        expect(screen.queryByText("connectivity.status.queued")).not.toBeInTheDocument();
        expect(screen.queryByText("connectivity.status.running")).not.toBeInTheDocument();
        expect(screen.queryByText(/connectivity\.resampleQueued/)).not.toBeInTheDocument();
		expect(screen.getByText("connectivity.status.ok")).toBeVisible();
		expect(screen.getByText("18")).toBeVisible();
		expect(screen.getByText("connectivity.endedEarly")).toBeVisible();
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"1",
		);
		expect(
			view.container.querySelectorAll('[data-connectivity-phase="running"]'),
		).toHaveLength(1);
	});
	it("does not show unstarted sites as waiting forever once the batch deadline ends", async () => {
		const base = data().results[0];
		api.fetchConnectivity.mockResolvedValue(
			data({
				state: "complete",
				results: [
					{ ...base, phase: "complete", status: "batch_timeout", samples: [] },
				],
			}),
		);
		mount();
		expect(
			await screen.findByText("connectivity.status.batch_timeout"),
		).toBeVisible();
		expect(
			screen.queryByText("connectivity.status.pending"),
		).not.toBeInTheDocument();
		expect(screen.getByText("0/3")).toBeVisible();
		expect(screen.getByText("connectivity.endedEarly")).toBeVisible();
	});
});

describe("compact configurable connectivity cards", () => {
	it("does not render website addresses and uses the configured icon for custom targets", async () => {
		api.fetchConnectivity.mockResolvedValue(
			data({
				can_run: false,
				results: [
					{
						id: "custom-test",
						icon: "google",
						name: "My app",
						group: "global",
						host: "private-path.example.com",
						status: "ok",
						phase: "complete",
						samples: [{ status: "ok", delay_ms: 42 }],
						delay_ms: 42,
					},
				],
			}),
		);
		const view = mount();
		expect(await screen.findByText("My app")).toBeVisible();
		expect(
			screen.queryByText("private-path.example.com"),
		).not.toBeInTheDocument();
		expect(view.container.innerHTML).not.toContain("private-path.example.com");
		expect(
			view.container.querySelector("[data-connectivity-icon]"),
		).not.toBeNull();
		expect(
			view.container.querySelectorAll("[data-connectivity-group]"),
		).toHaveLength(1);
		expect(screen.getByText("42")).toBeVisible();
	});
	it("supports a disabled/empty catalog without allowing a new run", async () => {
		api.fetchConnectivity.mockResolvedValue(data({ results: [] }));
		mount();
		expect(await screen.findByText("connectivity.noTargets")).toBeVisible();
		expect(
			screen.getByRole("button", { name: "connectivity.start" }),
		).toBeDisabled();
	});
	it("respects explicit default icons and the configured order", async () => {
		const base = data().results[0];
		api.fetchConnectivity.mockResolvedValue(
			data({
				results: [
					{ ...base, id: "z", name: "Last alphabetically", icon: "" },
					{ ...base, id: "a", name: "First alphabetically", icon: "google" },
				],
			}),
		);
		const view = mount();
		await screen.findByText("Last alphabetically");
		expect(
			Array.from(
				view.container.querySelectorAll("[data-connectivity-target]"),
			).map((el) => el.getAttribute("data-connectivity-target")),
		).toEqual(["z", "a"]);
		expect(
			view.container.querySelector(
				'[data-connectivity-target="z"] [data-connectivity-icon-fallback]',
			),
		).not.toBeNull();
	});
});
describe("latest completed default", () => {
 const result = (delay: number) => ({...data().results[0],status:"ok" as const,phase:"complete" as const,delay_ms:delay,samples:[{status:"ok" as const,delay_ms:delay}]});
 it.each([true,false])("keeps completed results during background tests, owner=%s", async(can_run) => {
  const latest={state:"complete" as const,started_at:1000,finished_at:2000,rounds:3,results:[result(42)]};
  const live=data({can_run,state:"running",started_at:3000,latest});
  api.fetchConnectivity.mockResolvedValue(live);
  const client=createTestQueryClient();
  const view=render(<QueryClientProvider client={client}><ServerConnectivity serverId={7}/></QueryClientProvider>);
  expect(await screen.findByText("42")).toBeVisible();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByText("connectivity.origin")).not.toBeInTheDocument();
  expect(api.startConnectivity).not.toHaveBeenCalled();
  client.setQueryData(["server-connectivity",7],data({can_run,state:"complete",finished_at:4000,results:[result(18)]}));
  expect(await screen.findByText("18")).toBeVisible();
  expect(screen.queryByText("42")).not.toBeInTheDocument();
  view.unmount();
 });
 it("manual retest follows the new batch rather than the saved one",async()=>{
  const completed=data({state:"complete",started_at:1000,finished_at:2000,results:[result(42)]});
  api.fetchConnectivity.mockResolvedValue(completed);
  api.startConnectivity.mockResolvedValue(data({state:"running",started_at:3000,latest:completed}));
  mount();
  expect(await screen.findByText("42")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"connectivity.retest"}));
  expect(await screen.findByRole("progressbar")).toBeVisible();
  expect(screen.queryByText("42")).not.toBeInTheDocument();
 });
});

it("administrators can immediately retest during the owner cooldown",async()=>{
 api.fetchConnectivity.mockResolvedValue(data({state:"complete",can_bypass_cooldown:true,retry_at:Date.now()+60000}));
 api.startConnectivity.mockResolvedValue(data({state:"running",can_bypass_cooldown:true}));
 mount();
 const button=await screen.findByRole("button",{name:"connectivity.retest"});
 expect(button).toBeEnabled();
 fireEvent.click(button);
 expect(await screen.findByRole("progressbar")).toBeVisible();
 expect(api.startConnectivity).toHaveBeenCalledTimes(1);
 expect(screen.getByRole("button",{name:"connectivity.testing"})).toBeDisabled();
});

it.each([false,true])("has no per-second redraw timer for visitors or cooldown-exempt admins (%s)",async(admin)=>{
 const timer=vi.spyOn(window,"setInterval");
 api.fetchConnectivity.mockResolvedValue(data({state:"complete",can_run:admin,can_bypass_cooldown:admin,retry_at:Date.now()+60000}));
 const view=mount();await screen.findByText("Google");
 expect(timer.mock.calls.filter(call=>call[1]===1000)).toHaveLength(0);
 view.unmount();timer.mockRestore();
});

it.each([false,true])("only full-batch retests show the overall progress bar (full=%s)",async(full_batch)=>{
 const previous=data({state:"complete",started_at:1000,finished_at:2000,can_bypass_cooldown:true,results:[
  {...data().results[0],status:"ok",phase:"complete",delay_ms:42,samples:[{status:"ok",delay_ms:42}]},
  {...data().results[0],id:"apple",name:"Apple",status:"ok",phase:"complete",delay_ms:18,samples:[{status:"ok",delay_ms:18}]},
 ]});
 const live=data({...previous,state:"running",started_at:3000,finished_at:undefined,full_batch,latest:previous,results:[
  {...previous.results[0],status:"pending",phase:"running",delay_ms:undefined,samples:[]},
  full_batch?{...previous.results[1],status:"pending",phase:"queued",delay_ms:undefined,samples:[]}:previous.results[1],
 ]});
 api.fetchConnectivity.mockResolvedValue(previous);
 api.startConnectivity.mockResolvedValue(live);
 const client=createTestQueryClient();
 const view=render(<QueryClientProvider client={client}><ServerConnectivity serverId={7}/></QueryClientProvider>);
 await screen.findByText("42");
 fireEvent.click(full_batch?screen.getByRole("button",{name:"connectivity.retest"}):screen.getByRole("button",{name:/Google ·/}));
 await waitFor(()=>expect(api.startConnectivity).toHaveBeenCalledWith(7,full_batch?undefined:"google"));
 await waitFor(()=>expect(view.container.querySelector('[data-connectivity-target="google"]')).toHaveAttribute("data-connectivity-phase","running"));
 expect(!!screen.queryByRole("progressbar")).toBe(full_batch);
 if(!full_batch){expect(screen.getByText("18")).toBeVisible();expect(screen.queryByText("connectivity.progress")).toBeNull();}
 act(()=>{client.setQueryData(["server-connectivity",7],{...live,state:"complete",finished_at:4000,latest:undefined,results:previous.results});});
 expect(await screen.findByText("42")).toBeVisible();
 expect(screen.queryByRole("progressbar")).toBeNull();
});

describe("visitor local latency", () => {
	it("requires a click, uses no server mutation or storage, keeps server data intact, and clears on remount", async () => {
		const snapshot = data({ can_run: false, online: false, state: "complete", results: [{ ...data().results[0], status: "ok", samples: [{ status: "ok", delay_ms: 42 }], delay_ms: 42 }] });
		api.fetchConnectivity.mockResolvedValue(snapshot);
		const fetcher = vi.fn().mockResolvedValue({ type: "opaque", status: 0 });
		const previous = globalThis.fetch;
		globalThis.fetch = fetcher;
		const storage = vi.spyOn(Storage.prototype, "setItem");
		try {
			const view = mount();
			expect(await screen.findByText("42")).toBeVisible();
			expect(fetcher).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole("button", { name: "connectivity.localLatency" }));
			await screen.findByText("connectivity.localFinished");
			expect(fetcher).toHaveBeenCalledTimes(7);
			expect(screen.queryByText("42")).not.toBeInTheDocument();
			expect(api.startConnectivity).not.toHaveBeenCalled();
			expect(storage).not.toHaveBeenCalled();
			expect(snapshot.results[0].delay_ms).toBe(42);
			expect(view.container.querySelectorAll("[data-connectivity-sample]")).toHaveLength(5);
			fireEvent.click(screen.getByRole("button", { name: "connectivity.serverLatency" }));
			expect(screen.getByText("42")).toBeVisible();
			fireEvent.click(screen.getByRole("button", { name: "connectivity.localLatency" }));
			expect(fetcher).toHaveBeenCalledTimes(7);
			const local = screen.getByRole("button", { name: "connectivity.localLatency" });
			expect(local).toHaveAttribute("title", "connectivity.localRetest");
			for (const count of [2, 3]) {
				fireEvent.click(local);
				await screen.findByText("connectivity.localFinished");
				expect(fetcher).toHaveBeenCalledTimes(count * 7);
				expect(local).toHaveAttribute("aria-pressed", "true");
				expect(local).toHaveAttribute("aria-busy", "false");
				expect(local.querySelector("svg")).not.toHaveClass("animate-spin");
				expect(within(local).getByText("connectivity.localLatency")).not.toHaveClass("invisible");
			}
			expect(api.startConnectivity).not.toHaveBeenCalled();
			expect(storage).not.toHaveBeenCalled();
			expect(snapshot.results[0].delay_ms).toBe(42);
			view.unmount(); mount();
			await screen.findByText("42");
			expect(screen.queryByText("connectivity.localFinished")).not.toBeInTheDocument();
			expect(screen.getByRole("button", { name: "connectivity.localLatency" })).toHaveAttribute("aria-pressed", "false");
			expect(fetcher).toHaveBeenCalledTimes(21);
		} finally { globalThis.fetch = previous; storage.mockRestore(); }
	});
	it("ignores double starts, cancels on leaving, and ignores late completion after unmount", async () => {
		api.fetchConnectivity.mockResolvedValue(data({ can_run: false }));
		const previous = globalThis.fetch;
		let signal!: AbortSignal, finish!: (response: Response) => void;
		const fetcher = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
			signal = options!.signal!;
			return new Promise<Response>(resolve => { finish = resolve; });
		});
		globalThis.fetch = fetcher;
		try {
			const view = mount(); await screen.findByText("Google");
			const local = screen.getByRole("button", { name: "connectivity.localLatency" });
			expect(local).toHaveAttribute("aria-busy", "false");
			fireEvent.click(local); fireEvent.click(local);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(local).toHaveAttribute("aria-busy", "true");
			expect(local).toHaveAttribute("title", "connectivity.testing");
			expect(local.querySelector("svg")).toHaveClass("animate-spin", "motion-reduce:animate-none");
			expect(within(local).getByText("connectivity.testing")).not.toHaveClass("invisible");
			expect(within(local).getByText("connectivity.localLatency")).toHaveClass("invisible");
			fireEvent.click(screen.getByRole("button", { name: "connectivity.serverLatency" }));
			expect(signal.aborted).toBe(true);
			view.unmount();
			await act(async () => { finish({ type: "opaque" } as Response); });
			mount(); await screen.findByText("Google");
			expect(screen.queryByText("connectivity.localFinished")).not.toBeInTheDocument();
		} finally { globalThis.fetch = previous; }
	});
	it("aborts on node change and never shows the previous node's local result", async () => {
		const client = createTestQueryClient();
		api.fetchConnectivity.mockResolvedValue(data({ can_run: false }));
		const previous = globalThis.fetch;
		let signal!: AbortSignal;
		globalThis.fetch = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
			signal = options!.signal!;
			return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
		});
		try {
			const renderNode = (id: number) => <QueryClientProvider client={client}><ServerConnectivity serverId={id} /></QueryClientProvider>;
			const view = render(renderNode(7)); await screen.findByText("Google");
			fireEvent.click(screen.getByRole("button", { name: "connectivity.localLatency" }));
			view.rerender(renderNode(8));
			await waitFor(() => expect(signal.aborted).toBe(true));
			await screen.findByText("Google");
			expect(screen.queryByText("connectivity.localCancelled")).not.toBeInTheDocument();
			expect(screen.getByRole("button", { name: "connectivity.serverLatency" })).toHaveAttribute("aria-pressed", "true");
		} finally { globalThis.fetch = previous; }
	});
	it("places only the full-batch progress inside the top header", async () => {
		api.fetchConnectivity.mockResolvedValue(data({ state: "running", full_batch: true }));
		const view = mount();
		const progress = await screen.findByRole("progressbar");
		expect(view.container.querySelector("[data-connectivity-header]")).toContainElement(progress);
		expect(progress).toHaveClass("sm:col-start-2", "sm:row-start-1");
	});
});
