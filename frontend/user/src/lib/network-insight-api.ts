export interface ASNode {
	asn: number;
	name: string;
	tier1: boolean;
}
export interface BGPPath {
	origin: ASNode;
	direct?: ASNode;
	second?: ASNode;
	count: number;
}
export interface BGPTopology {
	family: string;
	prefix?: string;
	observed_at?: string;
	total: number;
	paths: BGPPath[];
	status: string;
	source: string;
}
export interface MediaResult {
	id: string;
	name: string;
	icon: string;
	family: string;
	status: string;
	region?: string;
}
export interface InsightSnapshot {
	state: string;
	started_at?: number;
	finished_at?: number;
	retry_at?: number;
	topologies?: BGPTopology[];
	results?: MediaResult[];
}
export interface InsightData extends InsightSnapshot {
	server_id: number;
	can_run: boolean;
	online: boolean;
	history?: InsightSnapshot[];
}
export type InsightKind = "bgp" | "streaming";
export async function insightRequest(
	id: number,
	kind: InsightKind,
	method: "GET" | "POST" = "GET",
	signal?: AbortSignal,
): Promise<InsightData> {
	let csrf = "";
	try {
		csrf = decodeURIComponent(
			document.cookie
				.split("; ")
				.find((v) => v.startsWith("nz-csrf="))
				?.slice(8) || "",
		);
	} catch {}
	const response = await fetch(`/api/v1/server/${id}/${kind}`, {
		method,
		signal,
		cache: "no-store",
		headers: method === "POST" ? { "X-CSRF-Token": csrf } : undefined,
	});
	const body = await response.json();
	if (!response.ok || !body.success)
		throw new Error(body.error || "读取检测结果失败");
	return body.data;
}
