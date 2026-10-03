import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useAppearance } from "@/appearance/context";
import { ThemeProvider } from "@/components/ThemeProvider";
import { fetchSetting } from "@/lib/nezha-api";
import { renderWithProviders } from "@/test/utils";
import DoraemonApp from "@/themes/doraemon/App";

vi.mock("@/lib/nezha-api", () => ({ fetchSetting: vi.fn() }));
vi.mock("@/hooks/use-websocket-context", () => ({
	useWebSocketContext: () => ({ connected: true }),
}));
vi.mock("@/components/DashCommand", () => ({ DashCommand: () => null }));
vi.mock("@/components/SearchButton", () => ({
	SearchButton: () => <button>搜索</button>,
}));
vi.mock("@/pages/Server", () => ({
	default: () => {
		const appearance = useAppearance();
		return (
			<output data-testid="appearance-enabled">
				{String(appearance.enabled)}
			</output>
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
	it("ignores default appearance and injected code without overwriting old preferences", async () => {
		localStorage.setItem("vite-ui-theme", "dark");
		localStorage.setItem("doraemon-sky", "light");
		const view = mount();
		await screen.findByText("测试道具站");
		expect(screen.getByTestId("appearance-enabled")).toHaveTextContent("false");
		expect(document.querySelector("[data-injected]")).toBeNull();
		expect(screen.queryByText(/非官方同人主题/)).not.toBeInTheDocument();
		expect(screen.queryByText(/视觉来源/)).not.toBeInTheDocument();
		expect(screen.getByText("辛苦啦，来份铜锣烧！")).toBeInTheDocument();
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
