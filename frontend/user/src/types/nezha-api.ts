export interface NezhaWebsocketResponse {
	now: number;
	online?: number;
	servers: NezhaServer[];
}

export interface NezhaServer {
	connectivity_disabled?: boolean;
 network_default_view?: "connectivity" | "latency";
 network_display_mode?: "both" | "connectivity" | "latency" | "hidden";
 connectivity_local_only?: boolean;
	bgp_disabled?: boolean;
	return_route_disabled?: boolean;
	streaming_disabled?: boolean;
	hide_for_display?: boolean;
	id: number;
	name: string;
	public_note: string;
	last_active: string;
	country_code: string;
	host: NezhaServerHost;
	state: NezhaServerStatus;
}

export interface NezhaServerHost {
	platform: string;
	platform_version: string;
	cpu: string[];
	gpu: string[];
	mem_total: number;
	disk_total: number;
	swap_total: number;
	arch: string;
	boot_time: number;
	version: string;
}

export interface NezhaNetworkInterfaceRate { name: string; in_speed: number; out_speed: number; available: boolean; }

export interface NezhaServerStatus {
 network_interfaces?: NezhaNetworkInterfaceRate[];
 cpu_frequency_mhz?: number;
 cpu_frequency_kind?: string;
	cpu: number;
	mem_used: number;
	swap_used: number;
	disk_used: number;
	disk_read_speed?: number;
	disk_write_speed?: number;
	disk_io_available?: boolean;
	net_in_transfer: number;
	net_out_transfer: number;
	net_in_speed: number;
	net_out_speed: number;
	uptime: number;
	load_1: number;
	load_5: number;
	load_15: number;
	tcp_conn_count: number;
	udp_conn_count: number;
	process_count: number;
	temperatures: temperature[];
	gpu: number[];
	// Per-card figures from the official GPU memory protocol, in MiB.
	// Index-aligned with gpu. Prefer sample.name: host.gpu may also contain virtual adapters.
	gpus?: NezhaGPUStat[];
}

export interface NezhaGPUStat {
 name?: string;
 shared_memory_used?: number;
 shared_memory_total?: number;
	utilization: number;
	// Go omitempty omits a valid zero used value when total is known.
	memory_used?: number;
	memory_total?: number;
}

interface temperature {
	Name: string;
	Temperature: number;
}

export interface ServerGroupResponse {
	success: boolean;
	data: ServerGroup[];
}

export interface ServerGroup {
	group: {
		id: number;
		created_at: string;
		updated_at: string;
		name: string;
	};
	servers: number[];
}

export interface LoginUserResponse {
	success: boolean;
	data: {
 role?: number;
		id: number;
		username: string;
		password: string;
		created_at: string;
		updated_at: string;
	};
}

export interface MonitorResponse {
	success: boolean;
	data: NezhaMonitor[];
}

export type ServerMonitorChart = {
	[key: string]: {
		created_at: number;
		avg_delay: number;
		packet_loss?: number;
	}[];
};

export interface NezhaMonitor {
	monitor_id: number;
	monitor_name: string;
	display_index?: number;
	server_id: number;
	server_name: string;
	created_at: number[];
	avg_delay: number[];
	packet_loss?: number[];
}

export interface ServiceResponse {
	success: boolean;
	data: {
		services: {
			[key: string]: ServiceData;
		};
		cycle_transfer_stats: CycleTransferStats;
	};
}

export interface ServiceData {
	service_name: string;
	current_up: number;
	current_down: number;
	total_up: number;
	total_down: number;
	delay: number[];
	up: number[];
	down: number[];
}

export interface CycleTransferStats {
	[key: string]: CycleTransferData;
}

export interface CycleTransferData {
	name: string;
	from: string | { [key: string]: string };
	to: string | { [key: string]: string };
	max: number | { [key: string]: number };
	min: number | { [key: string]: number };
	server_name: {
		[key: string]: string;
	};
	transfer: {
		[key: string]: number;
	};
	next_update: {
		[key: string]: string;
	};
}

type SettingConfig = {
	show_network_in_detail?: boolean;
	statistics_split?: boolean;
	appearance_config?: string;
	doraemon_appearance_config?: string;
	debug: boolean;
	language: string;
	site_name: string;
	user_template: string;
	admin_template: string;
	custom_code: string;
};

export interface SettingResponse {
	success: boolean;
	data: {
		config: SettingConfig;
		version: string;
		tsdb_enabled?: boolean;
	};
}

export type MetricType =
 | `nic_${string}_${"in" | "out"}_speed`
	| "cpu"
	| "memory"
	| "swap"
	| "disk"
	| "disk_read_speed"
	| "disk_write_speed"
	| "net_in_speed"
	| "net_out_speed"
	| "net_in_transfer"
	| "net_out_transfer"
	| "load1"
	| "load5"
	| "load15"
	| "tcp_conn"
	| "udp_conn"
	| "process_count"
	| "temperature"
	| "uptime"
	| "gpu";

export type MetricPeriod = "1d" | "7d" | "30d";

export interface MetricDataPoint {
	ts: number;
	value: number;
}

export interface ServerMetricsData {
	server_id: number;
	server_name: string;
	metric: string;
	data_points: MetricDataPoint[];
}

export interface ServerMetricsResponse {
	success: boolean;
	data: ServerMetricsData;
}
export interface OnlinePeriod {
	start: string;
	end: string;
	ongoing: boolean;
}

export interface DailyOnlineStat {
	date: string;
	online_seconds: number;
}

export interface OnlineHistoryData {
	server_id: number;
	server_name: string;
	days: number;
	max_days: number;
	/** 面板时区（Daily 拆日的日界），前端按同一时区渲染 */
	timezone?: string;
	window_start: string;
	window_end: string;
	total_online_seconds: number;
	online_rate: number;
	currently_online: boolean;
	last_active?: string;
	periods: OnlinePeriod[];
	daily: DailyOnlineStat[];
}

export interface OnlineHistoryResponse {
	success: boolean;
	data: OnlineHistoryData;
}
