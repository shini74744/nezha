import { describe, it, expect, vi } from "vitest";
import cpuTemperatureCases from "../../../../../model/testdata/cpu_temperature_cases.json";
import { render, screen, fireEvent } from "@testing-library/react";
import HardwareMetricCard from "@/components/HardwareMetricCard";
import {
	availableModes,
	cpuTemperature,
	cpuTemperatureReading,
	hardwarePoints,
	hardwareValue,
	memoryPair,
} from "@/lib/hardware-metrics";
import { createServer } from "@/test/fixtures";
import type { NezhaServerStatus } from "@/types/nezha-api";
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, fallback?: string) => fallback ?? key,
	}),
}));
const state: Partial<NezhaServerStatus> = {
	cpu: 20,
	cpu_frequency_mhz: 2800,
	cpu_frequency_kind: "reported",
	gpu: [10, 0],
	gpus: [
		{
			name: "Intel [1]",
			utilization: 10,
			shared_memory_used: 1024,
			shared_memory_total: 8192,
		},
		{ name: "RTX [2]", utilization: 0, memory_used: 512, memory_total: 4096 },
	],
	temperatures: [
		{ Name: "coretemp_core_0", Temperature: 50 },
		{ Name: "coretemp_core_1", Temperature: 60 },
		{ Name: "ACPI ThermalZone", Temperature: 95 },
		{ Name: "GPU Core / RTX [2]", Temperature: 45 },
	],
};
describe("hardware metric selection", () => {
	it("CPU switches units and skips ACPI", () => {
		render(<HardwareMetricCard id={1} now={1000} state={state} />);
		expect(screen.getByText("20.0%")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "点击切换到CPU 温度" }));
		expect(screen.getByText("60.0 °C")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "点击切换到CPU 频率" }));
		expect(screen.getByText("2.80 GHz")).toBeInTheDocument();
		expect(screen.getByText("系统报告频率")).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "点击切换到CPU 使用率" }),
		);
		expect(screen.getByText("20.0%")).toBeInTheDocument();
	});
	it("separates integrated shared memory, dedicated VRAM and core temperature", () => {
		expect(availableModes(state, 0, "Intel [1]")).toEqual(["usage", "shared"]);
		expect(availableModes(state, 1, "RTX [2]")).toEqual([
			"usage",
			"memory",
			"temperature",
		]);
		expect(hardwareValue(state, "temperature", 0, "Intel [1]")).toBeUndefined();
		const view = render(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={state}
				index={1}
				identity="RTX [2]"
				name="RTX [2]"
			/>,
		);
		expect(screen.getByText("0.0%")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "点击切换到GPU 显存" }));
		expect(screen.getByText("12.5%")).toBeInTheDocument();
		expect(screen.getByText("512.00 MiB / 4.00 GiB")).toBeInTheDocument();
		view.rerender(
			<HardwareMetricCard
				id={1}
				now={2000}
				state={{ ...state, cpu: 99 }}
				index={1}
				identity="RTX [2]"
				name="RTX [2]"
			/>,
		);
		expect(
			view.container.querySelector('[data-hardware-mode="memory"]'),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "点击切换到GPU 温度" }));
		expect(screen.getByText("45.0 °C")).toBeInTheDocument();
	});
	it.each([
		false,
		true,
	])("GPU cycles usage, VRAM, temperature, shared memory (recorded=%s)", (recorded) => {
		const complete = {
			...state,
			gpus: [
				state.gpus![0],
				{
					...state.gpus![1],
					shared_memory_used: 1024,
					shared_memory_total: 8192,
				},
			],
		};
		expect(availableModes(complete, 1, "RTX [2]")).toEqual([
			"usage",
			"memory",
			"temperature",
			"shared",
		]);
		const view = render(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={complete}
				index={1}
				identity="RTX [2]"
				name="RTX [2]"
				recorded={recorded}
			/>,
		);
		for (const [next, mode, value, pair] of [
			["GPU 显存", "memory", "12.5%", "512.00 MiB / 4.00 GiB"],
			["GPU 温度", "temperature", "45.0 °C", null],
			["GPU 共享内存", "shared", "12.5%", "1.00 GiB / 8.00 GiB"],
			["GPU 使用率", "usage", "0.0%", null],
		]) {
			fireEvent.click(
				screen.getByRole("button", { name: `点击切换到${next}` }),
			);
			expect(
				view.container.querySelector(`[data-hardware-mode="${mode}"]`),
			).toBeInTheDocument();
			expect(screen.getByText(value!)).toBeInTheDocument();
			if (pair) expect(screen.getByText(pair)).toBeInTheDocument();
		}
		expect(
			availableModes({ ...complete, temperatures: [] }, 1, "RTX [2]"),
		).toEqual(["usage", "memory", "shared"]);
	});
	it("hides unsupported and invalid metrics, accepts omitted idle memory", () => {
		expect(
			cpuTemperature({
				temperatures: [{ Name: "ACPI ThermalZone", Temperature: 99 }],
			}),
		).toBeUndefined();
		expect(
			availableModes({
				cpu: 0,
				cpu_frequency_mhz: NaN,
				cpu_frequency_kind: "current",
			}),
		).toEqual(["usage"]);
		expect(memoryPair({ utilization: 0, memory_total: 4096 })?.percent).toBe(0);
		expect(
			memoryPair({ utilization: 0, memory_total: 4096, memory_used: 4097 }),
		).toBeUndefined();
		expect(
			hardwareValue(
				{ cpu_frequency_mhz: 2400, cpu_frequency_kind: "bogus" },
				"frequency",
			),
		).toBeUndefined();
	});
	it("keeps card identity when GPU array order changes and keeps zero samples", () => {
		const server = createServer({ id: 1 });
		server.state = { ...server.state, ...state };
		const reordered = {
			...server,
			state: {
				...server.state,
				gpu: [0, 10],
				gpus: [state.gpus![1], state.gpus![0]],
			},
		};
		const p = hardwarePoints(
			[{ now: 1000, servers: [reordered] }],
			1,
			2000,
			state,
			"usage",
			1,
			"RTX [2]",
		);
		expect(p.map((v) => v.value)).toEqual([0, 0]);
	});
	it("offline uses saved frequency values and fixed sample timestamp", () => {
		const view = render(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={state}
				recorded
				recent={{ cpu_frequency_mhz: [{ ts: 900, value: 2700 }] }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "点击切换到CPU 温度" }));
		fireEvent.click(screen.getByRole("button", { name: "点击切换到CPU 频率" }));
		expect(screen.getByText("2.80 GHz")).toBeInTheDocument();
		view.rerender(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={state}
				recorded
				recent={{ cpu_frequency_mhz: [{ ts: 900, value: 2700 }] }}
			/>,
		);
		expect(screen.getByText("2.80 GHz")).toBeInTheDocument();
	});
	it("missing support cannot leave stale memory mode or value", () => {
		const view = render(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={state}
				index={1}
				identity="RTX [2]"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "点击切换到GPU 显存" }));
		view.rerender(
			<HardwareMetricCard
				id={1}
				now={2000}
				state={{
					gpu: [0, 0],
					gpus: [
						{ name: "Intel [1]", utilization: 0 },
						{ name: "RTX [2]", utilization: 0 },
					],
				}}
				index={1}
				identity="RTX [2]"
			/>,
		);
		expect(
			view.container.querySelector('[data-hardware-mode="usage"]'),
		).toBeInTheDocument();
		expect(screen.queryByText("12.5%")).not.toBeInTheDocument();
	});
});

it("identifies platform CPU sensors without heatsink or PMU substitution", () => {
	for (const name of [
		"TC0D",
		"pACC MTR Temp Sensor0",
		"eACC MTR Temp Sensor12",
		"CPU Core 0",
		"k10temp_tdie",
	]) {
		expect(
			cpuTemperature({ temperatures: [{ Name: name, Temperature: 55 }] }),
		).toBe(55);
	}
	for (const name of [
		"TC0H",
		"TC0P",
		"PMU tdie1",
		"CPU Heatsink",
		"CPU Proximity",
		"GPU MTR Temp Sensor0",
		"ACPI ThermalZone",
	]) {
		expect(
			cpuTemperature({ temperatures: [{ Name: name, Temperature: 55 }] }),
		).toBeUndefined();
	}
});

describe("CPU package priority", () => {
	it.each(cpuTemperatureCases)("$name", ({
		temperatures,
		expected,
		source,
	}) => {
		const reading = cpuTemperatureReading({ temperatures });
		expect(reading?.value ?? null).toBe(expected);
		expect(reading?.source ?? null).toBe(source);
		const server = createServer({ id: 1 });
		server.state.temperatures = temperatures;
		const before = JSON.stringify(server);
		expect(
			hardwarePoints(
				[{ now: 900, servers: [server] }],
				1,
				1000,
				server.state,
				"temperature",
			).map((p) => p.value),
		).toEqual([expected, expected]);
		expect(JSON.stringify(server)).toBe(before);
	});
	it.each([
		NaN,
		Infinity,
		-Infinity,
	])("rejects non-finite package %s", (Temperature) => {
		expect(
			cpuTemperature({
				temperatures: [
					{ Name: "CPU Package", Temperature },
					{ Name: "CPU Core 0", Temperature: 47 },
				],
			}),
		).toBe(47);
	});
	it.each([
		false,
		true,
	])("updates source labels without changing offline time (recorded=%s)", (recorded) => {
		const packaged = {
			...state,
			temperatures: [
				...state.temperatures!,
				{ Name: "coretemp_package_id_0", Temperature: 45 },
			],
		};
		const view = render(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={packaged}
				recorded={recorded}
				recent={{ cpu_temperature: [{ ts: 900, value: 44 }] }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "点击切换到CPU 温度" }));
		expect(screen.getByText("45.0 °C")).toBeInTheDocument();
		expect(screen.getByText("CPU 封装温度")).toBeInTheDocument();
		view.rerender(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={packaged}
				recorded={recorded}
				recent={{ cpu_temperature: [{ ts: 900, value: 44 }] }}
			/>,
		);
		expect(screen.getByText("45.0 °C")).toBeInTheDocument();
		view.rerender(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={state}
				recorded={recorded}
			/>,
		);
		expect(screen.getByText("60.0 °C")).toBeInTheDocument();
		expect(screen.getByText("最高核心温度")).toBeInTheDocument();
		view.rerender(
			<HardwareMetricCard
				id={1}
				now={1000}
				state={{ ...state, temperatures: [{ Name: "TC0D", Temperature: 55 }] }}
				recorded={recorded}
			/>,
		);
		expect(
			screen.getByText("CPU 传感器温度（未识别封装或核心）"),
		).toBeInTheDocument();
		expect(screen.getByText("55.0 °C")).toBeInTheDocument();
	});
});
