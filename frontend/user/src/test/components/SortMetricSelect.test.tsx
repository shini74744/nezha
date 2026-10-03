import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import SortMetricSelect from "@/components/SortMetricSelect";
import { SORT_TYPES } from "@/context/sort-context";
import { SortProvider } from "@/context/sort-provider";
import { useSort } from "@/hooks/use-sort";
import { renderWithProviders } from "@/test/utils";

function State() {
	const { sortType, sortOrder, setSortOrder } = useSort();
	return (
		<>
			<output data-testid="sort-state">
				{sortType}:{sortOrder}
			</output>
			<button type="button" onClick={() => setSortOrder("asc")}>
				ascending
			</button>
		</>
	);
}
function renderMenu() {
	return renderWithProviders(
		<SortProvider>
			<SortMetricSelect />
			<State />
		</SortProvider>,
	);
}
describe("SortMetricSelect", () => {
	it("lists every existing metric and indicates the selected item", async () => {
		const user = userEvent.setup();
		renderMenu();
		const trigger = screen.getByRole("combobox", { name: "Sort metric" });
		await user.click(trigger);
		expect(screen.getAllByRole("option")).toHaveLength(SORT_TYPES.length);
		expect(
			screen.getByRole("option", { name: "sort.types.default" }),
		).toHaveAttribute("aria-selected", "true");
		await user.click(
			screen.getByRole("option", { name: "sort.types.up_total" }),
		);
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
		expect(screen.getByTestId("sort-state")).toHaveTextContent("up total:desc");
		await user.click(trigger);
		expect(
			screen.getByRole("option", { name: "sort.types.up_total" }),
		).toHaveAttribute("aria-selected", "true");
	});
	it("preserves direction for metrics and resets it only for default", async () => {
		const user = userEvent.setup();
		renderMenu();
		await user.click(screen.getByText("ascending"));
		await user.click(screen.getByRole("combobox"));
		await user.click(screen.getByRole("option", { name: "sort.types.cpu" }));
		expect(screen.getByTestId("sort-state")).toHaveTextContent("cpu:asc");
		await user.click(screen.getByRole("combobox"));
		await user.click(
			screen.getByRole("option", { name: "sort.types.default" }),
		);
		expect(screen.getByTestId("sort-state")).toHaveTextContent("default:desc");
	});
	it("opens with the keyboard and Escape closes without changing selection", async () => {
		const user = userEvent.setup();
		renderMenu();
		const trigger = screen.getByRole("combobox");
		trigger.focus();
		await user.keyboard("{Enter}");
		expect(screen.getByRole("listbox")).toBeInTheDocument();
		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
		);
		expect(screen.getByTestId("sort-state")).toHaveTextContent("default:desc");
		expect(trigger).toHaveFocus();
	});
});
