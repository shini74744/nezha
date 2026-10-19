import type {
	NezhaServerStatus,
	NezhaGPUStat,
	NezhaWebsocketResponse,
} from "@/types/nezha-api";
export type State = Partial<NezhaServerStatus>;
export type HardwareMode =
	| "usage"
	| "temperature"
	| "frequency"
	| "memory"
	| "shared";
export const valid = (v: unknown, max = Number.MAX_VALUE): v is number =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
export function cpuTemperature(state: State): number | undefined {
	const values = (state.temperatures ?? [])
		.filter(
			(t) =>
				!/acpi|thermalzone|gpu|nvme|disk|pmu|pmgr|heatsink|proximity/i.test(
					t.Name,
				) &&
				/(^|[^a-z])(cpu|coretemp|k10temp|tctl|tdie|package id|core [0-9]|cpu_thermal|cpu-thermal)([^a-z]|$)|^tc0d$|^[pe]acc mtr temp sensor[0-9]+$/i.test(
					t.Name,
				),
		)
		.map((t) => t.Temperature)
		.filter((v) => valid(v, 150) && v > 0);
	return values.length ? Math.max(...values) : undefined;
}
export function gpuTemperature(
	state: State,
	name?: string,
): number | undefined {
	if (!name) return;
	const values = (state.temperatures ?? []).filter(
		(t) =>
			t.Name === "GPU Core / " + name &&
			valid(t.Temperature, 150) &&
			t.Temperature > 0,
	);
	return values.length === 1 ? values[0].Temperature : undefined;
}
export function memoryPair(gpu: NezhaGPUStat | undefined, shared = false) {
	const total = shared ? gpu?.shared_memory_total : gpu?.memory_total;
	const used = shared ? gpu?.shared_memory_used : gpu?.memory_used;
	if (!valid(total, 1 << 30) || total <= 0 || !Number.isInteger(total)) return;
	const n = used === undefined ? 0 : used;
	if (!valid(n, total) || !Number.isInteger(n)) return;
	return {
		used: n * 1048576,
		total: total * 1048576,
		percent: (n / total) * 100,
	};
}
export function frequency(state: State) {
	const mhz = state.cpu_frequency_mhz;
	return valid(mhz, 100000) &&
		mhz > 0 &&
		["current", "reported", "nominal"].includes(state.cpu_frequency_kind ?? "")
		? mhz
		: undefined;
}
export function sampleGPU(state: State, index: number, name?: string) {
	return name ? state.gpus?.find((g) => g.name === name) : state.gpus?.[index];
}
export function hardwareValue(
	state: State,
	mode: HardwareMode,
	index?: number,
	name?: string,
): number | undefined {
	const gpu = index === undefined ? undefined : sampleGPU(state, index, name);
	switch (mode) {
		case "usage": {
			const v =
				index === undefined
					? state.cpu
					: (gpu?.utilization ?? (!name ? state.gpu?.[index] : undefined));
			return valid(v, 100) ? v : undefined;
		}
		case "temperature":
			return index === undefined
				? cpuTemperature(state)
				: gpuTemperature(state, gpu?.name);
		case "frequency":
			return frequency(state);
		case "memory":
			return memoryPair(gpu)?.percent;
		case "shared":
			return memoryPair(gpu, true)?.percent;
	}
}
export function availableModes(
	state: State,
	index?: number,
	name?: string,
): HardwareMode[] {
	const modes: HardwareMode[] =
		index === undefined
			? ["usage", "temperature", "frequency"]
			: ["usage", "memory", "shared", "temperature"];
	return modes.filter(
		(mode) => hardwareValue(state, mode, index, name) !== undefined,
	);
}
export function hardwarePoints(
	history: NezhaWebsocketResponse[],
	id: number,
	now: number,
	state: State,
	mode: HardwareMode,
	index?: number,
	name?: string,
) {
	const points = new Map<number, { timeStamp: string; value: number | null }>();
	for (const payload of history) {
		const server = payload.servers.find((s) => s.id === id);
		if (server && valid(payload.now))
			points.set(payload.now, {
				timeStamp: String(payload.now),
				value: hardwareValue(server.state, mode, index, name) ?? null,
			});
	}
	points.set(now, {
		timeStamp: String(now),
		value: hardwareValue(state, mode, index, name) ?? null,
	});
	return [...points.entries()]
		.sort((a, b) => a[0] - b[0])
		.slice(-60)
		.map(([, p]) => p);
}
export function recordedMetricKey(mode: HardwareMode, index?: number) {
	if (index === undefined)
		return mode === "usage"
			? "cpu"
			: mode === "temperature"
				? "cpu_temperature"
				: "cpu_frequency_mhz";
	return (
		"gpu_" +
		index +
		(mode === "usage"
			? ""
			: mode === "memory"
				? "_memory_percent"
				: mode === "shared"
					? "_shared_percent"
					: "_temperature")
	);
}
