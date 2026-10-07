export type ConnectivityStatus =
	| "pending"
	| "running"
	| "ok"
	| "http_error"
	| "timeout"
	| "dns_error"
	| "tls_error"
	| "query_disabled"
	| "batch_timeout"
	| "agent_timeout"
	| "offline"
	| "error"
	| "refused"
	| "unreachable"
	| "unstable";
export interface ConnectivitySample {
	status: ConnectivityStatus;
	delay_ms?: number;
	http_status?: number;
}
export interface ConnectivityResult {
	id: string;
	name: string;
	group: string;
	host: string;
	icon?: string;
	phase?: "queued" | "running" | "complete";
	status: ConnectivityStatus;
	samples: ConnectivitySample[];
	delay_ms?: number;
}
export interface ConnectivitySnapshot {
	scheduled_at?: number;
	state: "idle" | "running" | "complete";
	started_at?: number;
	finished_at?: number;
	retry_at?: number;
	rounds: number;
	results: ConnectivityResult[];
}
export interface ConnectivityData extends ConnectivitySnapshot {
	full_batch?: boolean;
	server_id: number;
	online: boolean;
	can_run: boolean;
	can_bypass_cooldown?: boolean;
	latest?: ConnectivitySnapshot;
}
export async function fetchConnectivity(
	serverId: number,
	signal?: AbortSignal,
	priority?: RequestPriority,
): Promise<ConnectivityData> {
	const response = await fetch(`/api/v1/server/${serverId}/connectivity`, {
		signal,
		priority,
		cache: "no-store",
	});
	const body = await response.json();
	if (!response.ok || !body.success)
		throw new Error(body.error || "connectivity_read_failed");
	return body.data;
}
export async function startConnectivity(
	serverId: number,
	targetId?: string,
): Promise<ConnectivityData> {
	const raw =
		document.cookie
			.split("; ")
			.find((item) => item.startsWith("nz-csrf="))
			?.slice("nz-csrf=".length) || "";
	let csrf = "";
	try {
		csrf = decodeURIComponent(raw);
	} catch {
		/* Server will safely reject invalid cookies. */
	}
	const response = await fetch(`/api/v1/server/${serverId}/connectivity${targetId ? "/" + encodeURIComponent(targetId) : ""}`, {
		method: "POST",
		headers: { "X-CSRF-Token": csrf },
	});
	const body = await response.json();
	if (!response.ok || !body.success)
		throw new Error(body.error || "connectivity_start_failed");
	return body.data;
}
