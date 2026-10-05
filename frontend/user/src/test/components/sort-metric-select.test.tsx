import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import SortMetricSelect from "@/components/SortMetricSelect";
import { SORT_TYPES } from "@/context/sort-context";
import { SortProvider } from "@/context/sort-provider";
import { useSort } from "@/hooks/use-sort";

function State() {
	const { sortType, sortOrder, setSortOrder } = useSort();
	return <><output data-testid="sort-state">{sortType}:{sortOrder}</output><button onClick={() => setSortOrder("asc")}>ascending</button></>;
}
function setup() {
	const user = userEvent.setup();
	render(<SortProvider><SortMetricSelect /><State /><button>outside</button></SortProvider>);
	return { user, trigger: screen.getByRole("button", { name: "Sort metric" }) };
}
describe("non-modal sorting menu", () => {
	it("keeps document scrolling and pointer events unchanged and supports repeated toggling", async () => {
		const { user, trigger } = setup();
		const initialStyle = document.body.style.cssText;
		for (let i = 0; i < 3; i++) {
			await user.click(trigger);
			expect(screen.getAllByRole("menuitemradio")).toHaveLength(SORT_TYPES.length);
			expect(document.body).not.toHaveAttribute("data-scroll-locked");
			expect(document.body.style.cssText).toBe(initialStyle);
			await user.keyboard("{Escape}");
			await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
			expect(trigger).toHaveFocus();
		}
		await user.click(trigger);
		await user.click(trigger);
		await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
	});
	it("preserves all metric choices and descending reset for default sorting", async () => {
		const { user, trigger } = setup();
		await user.click(screen.getByText("ascending"));
		await user.click(trigger);
		await user.click(screen.getByRole("menuitemradio", { name: "sort.types.cpu" }));
		expect(screen.getByTestId("sort-state")).toHaveTextContent("cpu:asc");
		expect(trigger).toHaveTextContent("sort.types.cpu");
		await user.click(trigger);
		expect(screen.getByRole("menuitemradio", { name: "sort.types.cpu" })).toHaveAttribute("aria-checked", "true");
		await user.click(screen.getByRole("menuitemradio", { name: "sort.types.default" }));
		expect(screen.getByTestId("sort-state")).toHaveTextContent("default:desc");
		await user.click(screen.getByText("ascending"));
		await user.click(trigger);
		await user.click(screen.getByRole("menuitemradio", { name: "sort.types.default" }));
		expect(screen.getByTestId("sort-state")).toHaveTextContent("default:asc");
	});
	it("dismisses with outside interaction without swallowing the outside click", async () => {
		const { user, trigger } = setup();
		await user.click(trigger);
		await user.click(screen.getByText("ascending"));
		await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
		expect(screen.getByTestId("sort-state")).toHaveTextContent("default:asc");
	});
});
