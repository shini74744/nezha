import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AppearanceProvider } from "@/appearance/context";
import { defaults } from "@/appearance/config";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header, { RefreshToast } from "@/components/Header";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandProvider } from "@/context/command-provider";
import { createSettingResponse } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/utils";

const headerMocks = vi.hoisted(() => ({
	backgroundImage: undefined as string | undefined,
	connected: true,
	fetchLoginUser: vi.fn(),
	fetchSetting: vi.fn(),
	lastData: null as { now: number; online?: number; servers: [] } | null,
	needReconnect: false,
	setNeedReconnect: vi.fn(),
	updateBackground: vi.fn(),
}));

vi.mock("@/hooks/use-background", () => ({
	useBackground: () => ({
		backgroundImage: headerMocks.backgroundImage,
		updateBackground: headerMocks.updateBackground,
	}),
}));

vi.mock("@/hooks/use-websocket-context", () => ({
	useWebSocketContext: () => ({
		connected: headerMocks.connected,
		lastData: headerMocks.lastData,
		needReconnect: headerMocks.needReconnect,
		setNeedReconnect: headerMocks.setNeedReconnect,
	}),
}));

vi.mock("@/lib/nezha-api", () => ({
	fetchLoginUser: headerMocks.fetchLoginUser,
	fetchSetting: headerMocks.fetchSetting,
}));

function settingResponse(siteName = "Nezha") {
	return {
		...createSettingResponse(),
		data: {
			...createSettingResponse().data,
			config: {
				...createSettingResponse().data.config,
				site_name: siteName,
				appearance_config: "",
			},
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

function LocationProbe() {
	const location = useLocation();
	return <p>{location.pathname}</p>;
}

function ConfiguredHeader() {
 const {data}=useQuery({queryKey:["setting"],queryFn:headerMocks.fetchSetting,retry:false});
 return <AppearanceProvider raw={data?.data?.config?.appearance_config}><Header /></AppearanceProvider>;
}

function renderHeader(route = "/server/1") {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<MemoryRouter initialEntries={[route]}>
				<ThemeProvider storageKey="header-theme-test">
					<CommandProvider>
						<ConfiguredHeader />
						<LocationProbe />
					</CommandProvider>
				</ThemeProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

function renderInRouter(ui: ReactElement) {
	return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("Header", () => {
	beforeEach(() => {
		headerMocks.backgroundImage = undefined;
		headerMocks.connected = true;
		headerMocks.fetchLoginUser.mockReset();
		headerMocks.fetchSetting.mockReset();
		headerMocks.lastData = {
			now: Date.parse("2025-01-01T00:00:20.000Z"),
			online: 4,
			servers: [],
		};
		headerMocks.needReconnect = false;
		headerMocks.setNeedReconnect.mockReset();
		headerMocks.updateBackground.mockReset();
		Object.assign(window, {
			CustomBackgroundImage: "",
			CustomDesc: "",
			CustomLinks: "",
			CustomLogo: "",
			CustomMobileBackgroundImage: "",
		});
		headerMocks.fetchSetting.mockResolvedValue(settingResponse());
		headerMocks.fetchLoginUser.mockRejectedValue(new Error("anonymous"));
	});

 it.each(["hidden","default","master-off","feature-off","search-only"])("does not flash controls while loading %s settings", async (mode) => {
  let resolve!: (value:ReturnType<typeof settingResponse>)=>void;
  headerMocks.fetchSetting.mockReturnValue(new Promise(r=>{resolve=r}));
  const {container}=renderHeader();
  const names=["Search","Change language","Toggle theme"];
  for(const name of names)expect(screen.queryByRole("button",{name})).not.toBeInTheDocument();
  // Observe every DOM mutation, not just the final settled render.
  const appeared=new Set<string>();
  const observer=new MutationObserver(()=>{
   for(const name of names)if(screen.queryByRole("button",{name}))appeared.add(name);
  });
  observer.observe(container,{childList:true,subtree:true});
  const response=settingResponse();
  if(mode!=="default"){
   const c=defaults();c.enabled=mode!=="master-off";
   c.features.hideControls={enabled:mode!=="feature-off",search:true,language:mode!=="search-only",theme:mode!=="search-only"};
   response.data.config.appearance_config=JSON.stringify(c);
  }
  resolve(response);
  await screen.findByText("Nezha");
  for(const [index,name] of names.entries()){
   const hidden=mode==="hidden"||(mode==="search-only"&&index===0);
   expect(!!screen.queryByRole("button",{name})).toBe(!hidden);
   if(hidden)expect(appeared.has(name)).toBe(false);
  }
  observer.disconnect();
 });

 it("keeps controls absent if initial settings fail",async()=>{
  headerMocks.fetchSetting.mockRejectedValue(new Error("settings unavailable"));
  renderHeader();
  await waitFor(()=>expect(headerMocks.fetchSetting).toHaveBeenCalled());
  await screen.findAllByText("login");
  for(const name of ["Search","Change language","Toggle theme"])
   expect(screen.queryByRole("button",{name})).not.toBeInTheDocument();
 });

	it("renders configured site identity, custom links, online count, and dashboard state", async () => {
		const user = userEvent.setup();
		Object.assign(window, {
			CustomDesc: "edge status",
			CustomLinks: JSON.stringify([
				{ link: "https://example.test", name: "Docs" },
			]),
			CustomLogo: "/logo.png",
		});
		Object.defineProperty(document, "cookie", {
			configurable: true,
			value: "session=1",
		});
		sessionStorage.setItem("selectedGroup", "Edge");
		headerMocks.fetchSetting.mockResolvedValue(settingResponse("Status Hub"));
		headerMocks.fetchLoginUser.mockResolvedValue(loginResponse());

		renderHeader();

		const siteName = await screen.findByText("Status Hub");
		expect(screen.getByText("edge status")).toBeInTheDocument();
		expect(screen.getByAltText("apple-touch-icon")).toHaveAttribute(
			"src",
			"/logo.png",
		);
		expect(screen.getAllByRole("link", { name: "Docs" })).toHaveLength(2);
		expect(await screen.findAllByText("dashboard")).toHaveLength(2);
		expect(screen.getByText("online").closest("button")).toHaveTextContent("4");
		expect(screen.getByText("online")).toBeInTheDocument();

		await waitFor(() => {
			expect(document.title).toBe("Status Hub");
		});
		expect(document.querySelector("link[rel='shortcut icon']")).toHaveAttribute(
			"href",
			"/logo.png",
		);

		await user.click(siteName);

		expect(sessionStorage.getItem("selectedGroup")).toBeNull();
		expect(screen.getByText("/")).toBeInTheDocument();
	});

	it("uses the offline display and login links when websocket and auth are unavailable", async () => {
		headerMocks.connected = false;

		const { container } = renderHeader();

		expect(await screen.findAllByText("login")).toHaveLength(2);
		expect(screen.getByText("offline")).toBeInTheDocument();
		expect(
			container.querySelector("[data-visible='true']"),
		).toBeInTheDocument();
	});

	it("ignores invalid custom links instead of crashing", async () => {
		Object.assign(window, {
			CustomLinks: "{bad-json",
		});

		renderHeader();

		expect(await screen.findByText("Nezha")).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Docs" }),
		).not.toBeInTheDocument();
	});

	it("stores and removes the active custom background", async () => {
		const user = userEvent.setup();
		headerMocks.backgroundImage = "/desktop.png";
		Object.assign(window, {
			CustomBackgroundImage: "/desktop.png",
			CustomMobileBackgroundImage: "/mobile.png",
		});

		const { container } = renderHeader();
		await screen.findByText("Nezha");

		const toggleButton = container
			.querySelector(".lucide-image-minus")
			?.closest("button");
		expect(toggleButton).toBeInTheDocument();

		await user.click(toggleButton as HTMLButtonElement);

		expect(sessionStorage.getItem("savedBackgroundImage")).toBe("/desktop.png");
		expect(headerMocks.updateBackground).toHaveBeenCalledWith(undefined);
	});

	it("restores the saved custom background", async () => {
		const user = userEvent.setup();
		sessionStorage.setItem("savedBackgroundImage", "/saved.png");

		const { container } = renderHeader();
		await screen.findByText("Nezha");

		const toggleButton = container
			.querySelector(".lucide-image-minus")
			?.closest("button");
		expect(toggleButton).toBeInTheDocument();

		await user.click(toggleButton as HTMLButtonElement);

		expect(headerMocks.updateBackground).toHaveBeenCalledWith("/saved.png");
	});
});

describe("RefreshToast", () => {
	beforeEach(() => {
		headerMocks.needReconnect = false;
	});

	it("renders only while reconnect refresh is needed", () => {
		vi.useFakeTimers();
		sessionStorage.setItem("needRefresh", "true");

		const { container, rerender } = renderInRouter(<RefreshToast />);

		expect(container).toBeEmptyDOMElement();

		headerMocks.needReconnect = true;
		rerender(
			<MemoryRouter>
				<RefreshToast />
			</MemoryRouter>,
		);

		expect(screen.getByText("refreshing...")).toBeInTheDocument();
		expect(sessionStorage.getItem("needRefresh")).toBeNull();
	});
});
