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
import { fetchServerMetrics } from "@/lib/nezha-api";
vi.mock("@/lib/nezha-api",()=>({fetchServerMetrics:vi.fn()}));
const renderProbe=vi.hoisted(()=>({chart:vi.fn()}));
vi.mock("recharts", () => ({
	ResponsiveContainer: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	LineChart: ({ children }: { children: ReactNode }) => {renderProbe.chart();return <div>{children}</div>},
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
 it("does not redraw frozen charts on incoming reports, but refresh captures the newest report",()=>{
  const {rerender}=render(<ChartDetailButton {...props}/>);open();
  const count=renderProbe.chart.mock.calls.length;
  for(let i=1;i<=12;i++)rerender(<ChartDetailButton {...props} data={[...props.data,{timeStamp:String(ts+90000),value:80+i}]}/>);
  expect(renderProbe.chart).toHaveBeenCalledTimes(count);
  expect(readout()).toHaveTextContent("30.0%");
  fireEvent.click(screen.getByRole("button",{name:"更新查看快照"}));
  expect(readout()).toHaveTextContent("92.0%");
 });

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


describe("live detailed history presets",()=>{
 const end=ts+86400000;
 const live={...props,period:"realtime" as const,history:{serverId:7,metrics:[{metric:"cpu" as const,key:"value"}]},data:[{timeStamp:String(end-3000),value:11},{timeStamp:String(end),value:12}]};
 const response=(value=42)=>({success:true,data:{data_points:Array.from({length:2881},(_,i)=>({ts:ts+i*30000,value}))}});
 const bounds=()=>{const el=document.querySelector("[data-detail-plot]")!;return [Number(el.getAttribute("data-window-start")),Number(el.getAttribute("data-window-end"))];};
 it("loads a full day once, selects exact 1/6/24 hour windows, restores all and returns to live",async()=>{
  vi.spyOn(Date,"now").mockReturnValue(end);
  vi.mocked(fetchServerMetrics).mockResolvedValue(response() as any);
  render(<ChartDetailButton {...live}/>);open();
  expect(screen.getByRole("button",{name:"恢复全部"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"近 1 小时"}));
  await waitFor(()=>expect(readout()).toHaveTextContent("42.0%"));
  expect(bounds()).toEqual([end-3600000,end]);expect(screen.getByText("121 / 121")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"近 1 小时"})).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByRole("button",{name:"近 6 小时"}));expect(bounds()).toEqual([end-21600000,end]);
  expect(screen.getByText("721 / 721")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"近 24 小时"}));expect(bounds()).toEqual([ts,end]);
  expect(screen.getByText("2881 / 2881")).toBeInTheDocument();expect(screen.getByRole("button",{name:"恢复全部"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"近 1 小时"}));fireEvent.click(screen.getByRole("button",{name:"恢复全部"}));
  expect(bounds()).toEqual([ts,end]);expect(screen.getByRole("button",{name:"近 1 小时"})).toHaveAttribute("aria-pressed","false");
  expect(fetchServerMetrics).toHaveBeenCalledTimes(1);expect(fetchServerMetrics).toHaveBeenCalledWith(7,"cpu","1d",expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button",{name:"返回实时快照"}));expect(readout()).toHaveTextContent("12.0%");expect(bounds()).toEqual([end-3000,end]);
 });
 it("shows no records for an empty history without silently keeping the live minute",async()=>{
  vi.spyOn(Date,"now").mockReturnValue(end);vi.mocked(fetchServerMetrics).mockResolvedValue({success:true,data:{data_points:[]}} as any);
  render(<ChartDetailButton {...live}/>);open();fireEvent.click(screen.getByRole("button",{name:"近 6 小时"}));
  await waitFor(()=>expect(screen.getByText("这个范围没有记录。")).toBeInTheDocument());
  expect(bounds()).toEqual([end-21600000,end]);
  fireEvent.click(screen.getByRole("button",{name:"近 24 小时"}));expect(bounds()).toEqual([ts,end]);
  fireEvent.click(screen.getByRole("button",{name:"返回实时快照"}));expect(readout()).toHaveTextContent("12.0%");
 });
 it("preserves live values on failure and retry switches only after success",async()=>{
  vi.spyOn(Date,"now").mockReturnValue(end);vi.mocked(fetchServerMetrics).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response() as any);
  render(<ChartDetailButton {...live}/>);open();fireEvent.click(screen.getByRole("button",{name:"近 1 小时"}));
  await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("读取失败"));expect(readout()).toHaveTextContent("12.0%");
  fireEvent.click(screen.getByRole("button",{name:"重试"}));await waitFor(()=>expect(readout()).toHaveTextContent("42.0%"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 });
 it("cancels superseded requests and ignores late responses; closing cancels pending work",async()=>{
  vi.spyOn(Date,"now").mockReturnValue(end);
  const pending:{resolve:(v:any)=>void,signal:AbortSignal}[]=[];
  vi.mocked(fetchServerMetrics).mockImplementation((_id,_metric,_period,signal)=>new Promise(resolve=>pending.push({resolve,signal:signal!})));
  const {unmount}=render(<ChartDetailButton {...live}/>);open();
  fireEvent.click(screen.getByRole("button",{name:"近 1 小时"}));fireEvent.click(screen.getByRole("button",{name:"近 6 小时"}));
  expect(pending[0].signal.aborted).toBe(true);
  pending[1].resolve(response(60));await waitFor(()=>expect(readout()).toHaveTextContent("60.0%"));
  pending[0].resolve(response(1));await waitFor(()=>expect(bounds()).toEqual([end-21600000,end]));
  expect(readout()).not.toHaveTextContent("1.0%");
  fireEvent.click(screen.getByRole("button",{name:"刷新历史记录"}));unmount();expect(pending[2].signal.aborted).toBe(true);
 });
 it("disables hour shortcuts when the exact metric has no historical source",()=>{
  render(<ChartDetailButton {...props} period="realtime"/>);open();
  for(const h of [1,6,24])expect(screen.getByRole("button",{name:"近 "+h+" 小时"})).toBeDisabled();
  expect(screen.getByText(/该指标尚未保存小时级历史/)).toBeInTheDocument();
 });
});
