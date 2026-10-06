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
export interface BGPGraphNode extends ASNode {
	layer: number;
	role: "origin" | "direct" | "transit";
	sample_count: number;
	collector_count: number;
	near_tier1?: boolean;
	route_server?: boolean;
}
export interface BGPGraphEdge {
	source: number;
	target: number;
	kind: "observed" | "supplemental";
	provenance: string;
	sample_count: number;
	collector_count: number;
}
export interface BGPGraph {
	version: number;
	nodes: BGPGraphNode[];
	edges: BGPGraphEdge[];
	paths: { asns: number[]; count: number; collector_count: number }[];
	observed_path_count: number;
	included_path_count: number;
	collector_count: number;
	truncated: boolean;
	supplemental_edges: BGPGraphEdge[];
	supplemental_status: string;
	annotation_status: string;
	legacy?: boolean;
}
export interface BGPTopology {
	graph?: BGPGraph;
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
	scheduled_at?: number;
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
	can_view_ip?: boolean;
	available_families?: string[];
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
