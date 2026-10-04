import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { useAppearance } from "@/appearance/context";
import { ThemeProvider } from "@/components/ThemeProvider";
import { fetchSetting } from "@/lib/nezha-api";
import { renderWithProviders } from "@/test/utils";
import DoraemonApp from "@/themes/doraemon/App";

const serverState = vi.hoisted(() => ({ready:true}));
vi.mock("@/lib/nezha-api", () => ({ fetchSetting: vi.fn() }));
vi.mock("@/hooks/use-websocket-context", () => ({
	useWebSocketContext: () => ({ connected: true }),
}));
vi.mock("@/components/DashCommand", () => ({ DashCommand: () => null }));
vi.mock("@/components/SearchButton", () => ({
	SearchButton: () => <button>搜索</button>,
}));
vi.mock("@/pages/Server", () => ({
	default: ({afterContent}:{afterContent?:ReactNode}) => {
		const appearance = useAppearance();
		return (
            <>
			<output data-testid="appearance-enabled">
				{String(appearance.enabled)}
			</output>
            {serverState.ready && afterContent}
            </>
		);
	},
}));
const setting = {
	success: true,
	data: {
		config: {
			site_name: "测试道具站",
			custom_code: '<div data-injected="legacy">旧美化</div>',
			appearance_config: JSON.stringify({
				enabled: true,
				features: { backgroundMedia: { enabled: true } },
			}),
		},
	},
};
function mount() {
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true, data: {} }),
			}),
	);
	vi.mocked(fetchSetting).mockResolvedValue(
		setting as Awaited<ReturnType<typeof fetchSetting>>,
	);
	return renderWithProviders(
		<ThemeProvider storageKey="doraemon-ui-theme">
			<DoraemonApp />
		</ThemeProvider>,
	);
}
describe("Doraemon application isolation", () => {
 beforeEach(() => {serverState.ready=true;});
 it("does not mount the page bottom until the list renders its ready content", async () => {
  serverState.ready=false;
  const view=mount();
  await screen.findByText("测试道具站");
  expect(screen.queryByRole("region",{name:"伙伴休息站"})).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/乘竹蜻蜓回到顶部/})).not.toBeInTheDocument();
  expect(document.querySelector(".dora-footer")).toBeNull();
  expect(screen.getByRole("region",{name:"五位伙伴同框"})).toBeInTheDocument();
  serverState.ready=true;
  view.rerender(<ThemeProvider storageKey="doraemon-ui-theme"><DoraemonApp/></ThemeProvider>);
  expect(screen.getByRole("region",{name:"伙伴休息站"})).toBeInTheDocument();
  expect(document.querySelectorAll(".dora-footer")).toHaveLength(1);
 });
 it("keeps all five portraits inside the page header without a standalone banner", async () => {
  mount();
  await screen.findByText("测试道具站");
  const friends = screen.getByRole("region", {name:"五位伙伴同框"});
  expect(friends.closest("header")).toHaveAttribute("id","dora-page-top");
  expect(friends.querySelectorAll("figure")).toHaveLength(5);
  expect(friends.querySelectorAll("img")).toHaveLength(5);
  expect(screen.queryByText("今天也和伙伴一起出发")).not.toBeInTheDocument();
  expect(document.querySelector(".dora-shell > .dora-friends-banner")).toBeNull();
 });
	it("ignores default appearance and injected code without overwriting old preferences", async () => {
		localStorage.setItem("vite-ui-theme", "dark");
		localStorage.setItem("doraemon-sky", "light");
		const view = mount();
		await screen.findByText("测试道具站");
		expect(screen.getByTestId("appearance-enabled")).toHaveTextContent("false");
		expect(document.querySelector("[data-injected]")).toBeNull();
		expect(screen.queryByText(/非官方同人主题/)).not.toBeInTheDocument();
		expect(screen.queryByText(/视觉来源/)).not.toBeInTheDocument();
		expect(screen.getByText(/辛苦啦，来份铜锣烧！/)).toBeInTheDocument();
		expect(document.documentElement).toHaveAttribute(
			"data-probe-theme",
			"doraemon",
		);
		expect(document.documentElement).toHaveClass("light");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "天空模式：晴空" }));
		await user.click(screen.getByRole("menuitemradio", { name: /夜空充电/ }));
		await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
		expect(localStorage.getItem("doraemon-sky")).toBe("dark");
		expect(localStorage.getItem("vite-ui-theme")).toBe("dark");
		view.unmount();
		expect(document.documentElement).not.toHaveAttribute("data-probe-theme");
	});
	it("opens and closes the pocket without navigating away", async () => {
		mount();
		await screen.findByText("测试道具站");
		fireEvent.click(screen.getByRole("button", { name: "打开四次元口袋" }));
		expect(
			screen.getByRole("region", { name: "四次元口袋" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "收起四次元口袋" }));
		expect(
			screen.queryByRole("region", { name: "四次元口袋" }),
		).not.toBeInTheDocument();
	});
	it("automatic mode changes at Beijing 19:00 even when the page stays open", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-04T10:59:00Z"));
		mount();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(document.documentElement).toHaveClass("light");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60000);
		});
		expect(document.documentElement).toHaveClass("dark");
	});
});
