import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Footer from "@/components/Footer";
import GroupSwitch from "@/components/GroupSwitch";
import {
	ServerDetailChartLoading,
	ServerDetailLoading,
} from "@/components/loading/ServerDetailLoading";
import TabSwitch from "@/components/TabSwitch";
import { createTestQueryClient, renderWithProviders } from "@/test/utils";

const apiMocks = vi.hoisted(() => ({
	fetchSetting: vi.fn(),
}));

vi.mock("@/lib/nezha-api", () => apiMocks);

function LocationProbe() {
	const location = useLocation();
	return <p>{location.pathname}</p>;
}

describe("Footer", () => {
	beforeEach(() => {
		apiMocks.fetchSetting.mockResolvedValue({
			success: true,
			data: {
				config: {
					debug: false,
					language: "en-US",
					site_name: "Nezha",
					user_template: "",
					admin_template: "",
					custom_code: "",
				},
				version: "9.9.9",
			},
		});
	});

	it("renders setting version and project attribution", async () => {
		renderWithProviders(<Footer />);

		expect(screen.getByText("footer.themeBy")).toBeInTheDocument();
		expect(screen.getByText("nezha-dash")).toHaveAttribute(
			"href",
			"https://github.com/hamster1963/nezha-dash",
		);
		expect(await screen.findByText("9.9.9")).toBeInTheDocument();
	});
});

describe("Tab and group switches", () => {
	it("switches tabs and marks the active tab", async () => {
		const user = userEvent.setup();
		const setCurrentTab = vi.fn();

		render(
			<TabSwitch
				tabs={["Detail", "Network"]}
				currentTab="Detail"
				setCurrentTab={setCurrentTab}
			/>,
		);

		await user.click(screen.getByText("tabSwitch.Network"));

		expect(setCurrentTab).toHaveBeenCalledWith("Network");
		expect(
			screen.getByText("tabSwitch.Detail").parentElement?.parentElement,
		).toHaveClass("text-black");
	});

	it("does not override page-owned selection and hides itself when only All exists", () => {
		const setCurrentTab = vi.fn();
		sessionStorage.setItem("selectedGroup", "Edge");

		const { container, rerender } = render(
			<GroupSwitch
				tabs={["All", "Edge", "Asia"]}
				currentTab="All"
				setCurrentTab={setCurrentTab}
			/>,
		);

		expect(setCurrentTab).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(
			"group.all",
		);

		rerender(
			<GroupSwitch
				tabs={["All"]}
				currentTab="All"
				setCurrentTab={setCurrentTab}
			/>,
		);

		expect(container).toBeEmptyDOMElement();
	});

	it("keeps compact groups keyboard accessible with a clear selection", async () => {
		const user = userEvent.setup();
		const setCurrentTab = vi.fn();
		render(
			<GroupSwitch
				tabs={["All", "Asia"]}
				currentTab="All"
				setCurrentTab={setCurrentTab}
			/>,
		);
		const all = screen.getByRole("button", { pressed: true });
		const asia = screen.getByRole("button", { name: "Asia" });
		expect(all).toHaveClass("h-[30px]", "min-w-[44px]");
		asia.focus();
		await user.keyboard("{Enter}");
		expect(setCurrentTab).toHaveBeenCalledWith("Asia");
	});

	it("binds horizontal scrolling after groups load and preserves browser zoom", () => {
		const setCurrentTab = vi.fn();
		const { container, rerender } = render(
			<GroupSwitch
				tabs={["All"]}
				currentTab="All"
				setCurrentTab={setCurrentTab}
			/>,
		);
		rerender(
			<GroupSwitch
				tabs={["All", "Asia"]}
				currentTab="All"
				setCurrentTab={setCurrentTab}
			/>,
		);
		const scroller = container.querySelector(
			"[data-group-scroll]",
		) as HTMLElement;
		Object.defineProperty(scroller, "scrollWidth", {
			configurable: true,
			value: 320,
		});
		Object.defineProperty(scroller, "clientWidth", {
			configurable: true,
			value: 100,
		});
		fireEvent.wheel(scroller, { deltaX: 40 });
		expect(scroller.scrollLeft).toBe(40);
		fireEvent.wheel(scroller, { deltaY: 40, ctrlKey: true });
		expect(scroller.scrollLeft).toBe(40);
	});

	it("scrolls overflowing group tabs and applies custom background styling", async () => {
		const user = userEvent.setup();
		const setCurrentTab = vi.fn();
		const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
		vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(320);
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(120);
		window.CustomBackgroundImage = "/background.jpg";

		const { container } = render(
			<GroupSwitch
				tabs={["All", "Edge", "Asia"]}
				currentTab="All"
				setCurrentTab={setCurrentTab}
			/>,
		);

		const scrollContainer = container.querySelector(
			".scrollbar-hidden",
		) as HTMLElement;

		fireEvent.wheel(scrollContainer, { deltaY: 42 });
		await user.click(screen.getByText("Asia"));

		expect(scrollContainer.scrollLeft).toBe(42);
		expect(setCurrentTab).toHaveBeenCalledWith("Asia");
		expect(scrollIntoView).not.toHaveBeenCalled();
		expect(
			container.querySelector(".relative.flex.items-center")?.className,
		).toContain("bg-stone-100/60");
	});
});

describe("server detail loading states", () => {
	it("renders chart skeleton cards", () => {
		const { container } = render(<ServerDetailChartLoading />);

		expect(container.querySelectorAll(".h-\\[182px\\]")).toHaveLength(6);
	});

	it("navigates home from the detail loading back affordance", async () => {
		const user = userEvent.setup();
		const queryClient = createTestQueryClient();

		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter initialEntries={["/server/7"]}>
					<ServerDetailLoading />
					<LocationProbe />
				</MemoryRouter>
			</QueryClientProvider>,
		);

		await user.click(screen.getAllByAltText("BackIcon")[0]);

		expect(screen.getByText("/")).toBeInTheDocument();
	});
});
