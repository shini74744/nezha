import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	ChartContainer,
	ChartLegendContent,
	ChartTooltipContent,
} from "@/components/ui/chart";

function CpuIcon() {
	return <span data-testid="cpu-icon">icon</span>;
}

const chartConfig = {
	cpu: {
		label: "CPU Usage",
		icon: CpuIcon,
	},
	mem: {
		label: "Memory",
		color: "#00ff00",
	},
	themed: {
		label: "Themed",
		theme: {
			light: "#ffffff",
			dark: "#000000",
		},
	},
};

describe("chart primitives", () => {
	it("tracks chart input without swallowing caller events or removing keyboard focus", () => {
		const pointer = vi.fn(), keyboard = vi.fn(), focus = vi.fn(), blur = vi.fn();
		const { container } = render(
			<ChartContainer config={chartConfig} onPointerDownCapture={pointer}
				onKeyDownCapture={keyboard} onFocusCapture={focus} onBlurCapture={blur}>
				<svg data-testid="plot" className="recharts-surface" tabIndex={0} />
			</ChartContainer>,
		);
		const plot = screen.getByTestId("plot");
		const root = container.querySelector("[data-chart]");
		fireEvent.pointerDown(plot);
		expect(root).toHaveAttribute("data-chart-input", "pointer");
		fireEvent.keyDown(plot, { key: "ArrowRight" });
		expect(root).toHaveAttribute("data-chart-input", "keyboard");
		plot.focus();
		expect(plot).toHaveFocus();
		fireEvent.pointerDown(plot);
		expect(root).toHaveAttribute("data-chart-input", "pointer");
		expect(plot).toHaveFocus();
		expect(pointer).toHaveBeenCalledTimes(2);
		expect(keyboard).toHaveBeenCalledTimes(1);
		expect(focus).toHaveBeenCalledTimes(1);
		plot.blur();
		expect(root).not.toHaveAttribute("data-chart-input");
		expect(blur).toHaveBeenCalledTimes(1);
	});

	it("keeps the tooltip layer above the legend and scoped to its chart", () => {
		const { container } = render(
			<ChartContainer config={chartConfig}><div>chart</div></ChartContainer>,
		);
		expect(container.querySelector("[data-chart]")).toHaveClass(
			"isolate",
			"[&_.recharts-tooltip-wrapper]:z-10",
		);
	});

	it("renders tooltip rows with config labels, icons, and formatted values", () => {
		const formatter = vi.fn((value: number, name: string) => (
			<span>{`${name}:${value.toFixed(1)}`}</span>
		));

		render(
			<ChartContainer config={chartConfig}>
				<ChartTooltipContent
					active={true}
					label="cpu"
					payload={[
						{
							color: "#ff0000",
							dataKey: "cpu",
							name: "cpu",
							payload: { fill: "#ff0000" },
							value: 12.345,
						},
						{
							color: "#00ff00",
							dataKey: "mem",
							name: "mem",
							payload: { fill: "#00ff00" },
							value: 42,
						},
					]}
					formatter={formatter}
				/>
			</ChartContainer>,
		);

		expect(screen.getByText("CPU Usage")).toBeInTheDocument();
		expect(screen.getByText("cpu:12.3")).toBeInTheDocument();
		expect(screen.getByText("mem:42.0")).toBeInTheDocument();
		expect(formatter).toHaveBeenCalled();
	});

	it("renders nested labels for single line indicators and hides inactive tooltips", () => {
		const { container, rerender } = render(
			<ChartContainer config={chartConfig}>
				<ChartTooltipContent
					active={true}
					indicator="line"
					label="cpu"
					payload={[
						{
							color: "#ff0000",
							dataKey: "cpu",
							name: "cpu",
							payload: { fill: "#ff0000" },
							value: 12,
						},
					]}
				/>
			</ChartContainer>,
		);

		expect(screen.getAllByText("CPU Usage")).toHaveLength(2);
		expect(screen.getByText("12.00")).toBeInTheDocument();

		rerender(
			<ChartContainer config={chartConfig}>
				<ChartTooltipContent active={false} payload={[]} />
			</ChartContainer>,
		);

		expect(container).not.toHaveTextContent("CPU Usage");
	});

	it("renders legend payloads and chart theme style blocks", () => {
		const { container, rerender } = render(
			<ChartContainer id="summary" config={chartConfig}>
				<ChartLegendContent
					verticalAlign="top"
					payload={[
						{
							color: "#ff0000",
							dataKey: "cpu",
							value: "cpu",
						},
						{
							color: "#00ff00",
							dataKey: "mem",
							value: "mem",
						},
					]}
				/>
			</ChartContainer>,
		);

		expect(screen.getByTestId("cpu-icon")).toBeInTheDocument();
		expect(screen.getByText("mem")).toBeInTheDocument();
		expect(container.querySelector("style")?.textContent).toContain(
			"--color-themed",
		);

		rerender(
			<ChartContainer config={chartConfig}>
				<ChartLegendContent payload={[]} />
			</ChartContainer>,
		);

		expect(screen.queryByText("mem")).not.toBeInTheDocument();
	});
});
