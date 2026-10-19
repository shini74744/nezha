import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GpuMemorySummary from "@/components/GpuMemorySummary";
import {
	OfflineMetricCard,
	type LastReport,
} from "@/components/OfflineServerDetail";
import { renderWithProviders } from "@/test/utils";
import type { NezhaGPUStat } from "@/types/nezha-api";

vi.mock("@/lib/detail-modules", () => ({
	PreloadedServerNetworkInsight: () => null,
	loadNetworkChart: async () => ({ default: () => null }),
}));

const memory = (used = 2048, total = 8192): NezhaGPUStat => ({
	utilization: 33,
	memory_used: used,
	memory_total: total,
});

describe("GPU memory summary", () => {
	it("converts official MiB values to project units and percentage", () => {
		render(<GpuMemorySummary memory={memory()} />);
		expect(screen.getByText("2.00 GiB / 8.00 GiB · 25.0%")).toBeInTheDocument();
		expect(screen.getByText("serverDetailChart.gpuMemory")).toBeInTheDocument();
	});
	it.each([
		0,
		undefined,
	])("preserves idle zero with Go omitempty (%s)", (used) => {
		render(<GpuMemorySummary memory={{ ...memory(), memory_used: used }} />);
		expect(screen.getByText("0 KiB / 8.00 GiB · 0.0%")).toBeInTheDocument();
	});
	it("shows full utilization without confusing GPU compute and memory", () => {
		render(<GpuMemorySummary memory={memory(8192)} />);
		expect(
			screen.getByText("8.00 GiB / 8.00 GiB · 100.0%"),
		).toBeInTheDocument();
	});
	it.each([
		undefined,
		{ utilization: 10 },
		memory(0, 0),
		memory(0, -1),
		memory(0, Number.NaN),
		memory(0, Number.POSITIVE_INFINITY),
		memory(-1),
		memory(Number.NaN),
		memory(Number.POSITIVE_INFINITY),
		memory(8193),
		memory(1.5),
		memory(0, Number.MAX_SAFE_INTEGER),
		{ ...memory(), memory_total: "8192" },
		{ ...memory(), memory_used: null },
	])("hides unsupported or malformed readings: %j", (value) => {
		const { container } = render(
			<GpuMemorySummary memory={value as NezhaGPUStat} />,
		);
		expect(container).toBeEmptyDOMElement();
	});
	it("updates, then removes stale data when support disappears", () => {
		const view = render(<GpuMemorySummary memory={memory()} />);
		view.rerender(<GpuMemorySummary memory={memory(4096)} />);
		expect(screen.getByText("4.00 GiB / 8.00 GiB · 50.0%")).toBeInTheDocument();
		view.rerender(<GpuMemorySummary />);
		expect(view.container).toBeEmptyDOMElement();
	});
});

const gpuGroup = (i: number) => ({
	title: `GPU #${i + 1}`,
	keys: [`gpu_${i}`],
	labels: ["GPU"],
	unit: "percent",
	colors: [5],
});
const savedReport = (): LastReport => ({
	server_id: 7,
	tsdb_enabled: true,
	history_days: 1,
	last_report_at: 1000,
	metrics: { gpu_0: 33, gpu_1: 55 },
	recent: {},
	snapshot: {
		at: 1000,
		host: { gpu: ["NVIDIA T4", "NVIDIA A10"] },
		state: { gpu: [33, 55], gpus: [memory(), memory(6144, 24576)] },
	},
});

describe("offline GPU memory", () => {
	it("renders each card from its recorded snapshot", () => {
		const report = savedReport();
		renderWithProviders(
			<>
				<OfflineMetricCard group={gpuGroup(0)} report={report} period="last" />
				<OfflineMetricCard group={gpuGroup(1)} report={report} period="last" />
			</>,
		);
		expect(screen.getByText("2.00 GiB / 8.00 GiB · 25.0%")).toBeInTheDocument();
		expect(
			screen.getByText("6.00 GiB / 24.00 GiB · 25.0%"),
		).toBeInTheDocument();
		expect(
			document.querySelectorAll('[data-gpu-memory="recorded"]'),
		).toHaveLength(2);
	});
	it("does not use unrelated changing metrics as frozen VRAM", () => {
		const report = savedReport();
		const view = renderWithProviders(
			<OfflineMetricCard group={gpuGroup(0)} report={report} period="last" />,
		);
		report.metrics.gpu_0 = 99;
		view.rerender(
			<OfflineMetricCard group={gpuGroup(0)} report={report} period="last" />,
		);
		expect(screen.getByText("2.00 GiB / 8.00 GiB · 25.0%")).toBeInTheDocument();
	});
	it.each([
		"legacy",
		"missing",
		"unsupported",
		"non-gpu",
		"missing-index",
	])("hides unavailable snapshot (%s)", (kind) => {
		const report = savedReport();
		if (kind === "legacy" && report.snapshot) delete report.snapshot.state.gpus;
		if (kind === "missing") delete report.snapshot;
		if (kind === "unsupported" && report.snapshot)
			report.snapshot.state.gpus = [{ utilization: 33 }];
		const group =
			kind === "non-gpu"
				? { ...gpuGroup(0), keys: ["cpu"] }
				: gpuGroup(kind === "missing-index" ? 5 : 0);
		renderWithProviders(
			<OfflineMetricCard group={group} report={report} period="last" />,
		);
		expect(document.querySelector("[data-gpu-memory]")).toBeNull();
	});
	it("does not label a saved reading as one-day history", () => {
		renderWithProviders(
			<OfflineMetricCard
				group={gpuGroup(0)}
				report={savedReport()}
				period="1d"
			/>,
		);
		expect(document.querySelector("[data-gpu-memory]")).toBeNull();
	});
});
