import {
	fireEvent,
	render,
	screen,
	within,
	waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import ChartDetailButton from "@/components/ChartDetail";
vi.mock("recharts", () => ({
	ResponsiveContainer: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CartesianGrid: () => null,
	Line: () => null,
	ReferenceArea: () => null,
	ReferenceLine: () => null,
	XAxis: () => null,
	YAxis: () => null,
}));
const ts = Date.parse("2026-10-26T00:00:00+08:00");
const props = {
	scopeKey: "7:1d:cpu",
	title: "CPU",
	period: "1d" as const,
	series: [{ key: "value", label: "使用率", color: "blue" }],
	formatValue: (v: number) => v.toFixed(1) + "%",
	data: [
		{ timeStamp: String(ts), value: 10 },
		{ timeStamp: String(ts + 30000), value: 20 },
		{ timeStamp: String(ts + 60000), value: 30 },
	],
};
const open = () =>
	fireEvent.click(screen.getByRole("button", { name: "CPU详细查看" }));
const readout = () => document.querySelector("[data-detail-readout]")!;
describe("chart detailed view", () => {
	it("freezes open samples until explicitly refreshed and closes when server or period changes", () => {
		const { rerender } = render(<ChartDetailButton {...props} />);
		open();
		expect(readout()).toHaveTextContent("30.0%");
		rerender(
			<ChartDetailButton
				{...props}
				data={[...props.data, { timeStamp: String(ts + 90000), value: 99 }]}
			/>,
		);
		expect(readout()).toHaveTextContent("30.0%");
		expect(readout()).not.toHaveTextContent("99.0%");
		fireEvent.click(screen.getByRole("button", { name: "更新查看快照" }));
		expect(readout()).toHaveTextContent("99.0%");
		rerender(<ChartDetailButton {...props} scopeKey="8:1d:cpu" />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
	it("steps and locks points, and keyboard navigation uses actual samples", async () => {
		const user = userEvent.setup();
		render(<ChartDetailButton {...props} />);
		open();
		fireEvent.click(screen.getByRole("button", { name: "上一点" }));
		expect(readout()).toHaveTextContent("20.0%");
		expect(readout()).toHaveTextContent("已锁定");
		const plot = screen.getByRole("group", { name: /图表选点/ });
		plot.focus();
		await user.keyboard("{Home}");
		expect(readout()).toHaveTextContent("10.0%");
		expect(screen.getByRole("button", { name: "上一点" })).toBeDisabled();
		await user.keyboard("{ArrowRight}");
		expect(readout()).toHaveTextContent("20.0%");
		await user.keyboard("{Escape}");
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "解除锁定" })).toBeDisabled();
	});
	it("locates the nearest actual record and rejects out-of-range input", () => {
		render(<ChartDetailButton {...props} />);
		open();
		fireEvent.change(screen.getByLabelText("定位时间"), {
			target: { value: "2026-10-26T00:00:44" },
		});
		fireEvent.click(screen.getByRole("button", { name: "定位" }));
		expect(readout()).toHaveTextContent("20.0%");
		expect(readout()).toHaveTextContent("最近的实际采样点");
		fireEvent.change(screen.getByLabelText("定位时间"), {
			target: { value: "2026-10-27T00:00:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "定位" }));
		expect(screen.getByRole("alert")).toHaveTextContent("范围内");
	});
	it("applies a bounded range and preserves values on invalid input", () => {
		render(<ChartDetailButton {...props} />);
		open();
		fireEvent.change(screen.getByLabelText("开始时间"), {
			target: { value: "2026-10-26T00:00:30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "查看范围" }));
		expect(screen.getByText("2 / 2")).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("开始时间"), {
			target: { value: "2026-10-26T01:00:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "查看范围" }));
		expect(screen.getByRole("alert")).toHaveTextContent("不能晚于");
		fireEvent.click(screen.getByRole("button", { name: "恢复全部" }));
		expect(screen.getByText("3 / 3")).toBeInTheDocument();
	});
	it("disables empty or failed records, and treats missing data separately from zero", () => {
		const { rerender } = render(<ChartDetailButton {...props} data={[]} />);
		expect(screen.getByRole("button")).toBeDisabled();
		rerender(<ChartDetailButton {...props} disabled />);
		expect(screen.getByRole("button")).toBeDisabled();
		rerender(
			<ChartDetailButton
				{...props}
				data={[{ timeStamp: String(ts), value: null }]}
			/>,
		);
		open();
		expect(readout()).toHaveTextContent("无记录");
	});
	it("can locate a single live sample whose timestamp has milliseconds", () => {
		render(
			<ChartDetailButton
				{...props}
				period="realtime"
				data={[{ timeStamp: String(ts + 789), value: 0 }]}
			/>,
		);
		open();
		fireEvent.click(screen.getByRole("button", { name: "定位" }));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(readout()).toHaveTextContent("0.0%");
	});
	it("closes captured data when its source becomes unavailable", () => {
        const {rerender}=render(<ChartDetailButton {...props}/>);open();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        rerender(<ChartDetailButton {...props} disabled/>);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByRole("button",{name:"CPU详细查看"})).toBeDisabled();
    });
	it("returns focus to the entry after closing", async () => {
		render(<ChartDetailButton {...props} />);
		const entry = screen.getByRole("button", { name: "CPU详细查看" });
		entry.focus();
		open();
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
		);
		await waitFor(() => expect(entry).toHaveFocus());
	});
});
