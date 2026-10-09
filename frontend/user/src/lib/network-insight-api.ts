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
 tested_at?: number;
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
export interface ReturnHop {
	ttl: number;
	ip?: string;
	asn?: string;
	location?: string;
	organization?: string;
	rtt_ms?: number;
	samples: number;
	network?: string;
	stage?: string;
	ip_hidden?: boolean;
	latitude?: number;
	longitude?: number;
}
export interface ReturnSelection {
	id: string;
	family: string;
}
export interface ReturnResult {
	tested_at?: number;
	id: string;
	name: string;
	carrier: string;
	family: string;
	target?: string;
	comparison_key?: string;
	protocol: string;
	status: string;
	route?: string[];
	hops?: ReturnHop[];
	line?: string;
	confidence?: string;
	evidence?: string[];
}
export interface InsightSnapshot {
 auto_attempt?: number;
 auto_retry_at?: number;
 auto_first_started_at?: number;
	retest?: ReturnSelection;
	routes?: ReturnResult[];
	scheduled_at?: number;
	state: string;
	started_at?: number;
	finished_at?: number;
	retry_at?: number;
	topologies?: BGPTopology[];
	results?: MediaResult[];
}
export interface InsightData extends InsightSnapshot {
	queue_position?: number;
	server_id: number;
	can_run: boolean;
	can_view_ip?: boolean;
	available_families?: string[];
	online: boolean;
	history?: InsightSnapshot[];
}
export type InsightKind = "bgp" | "streaming" | "return-route";
export async function insightRequest(
	id: number,
	kind: InsightKind,
	method: "GET" | "POST" = "GET",
	signal?: AbortSignal,
	priority?: RequestPriority,
	selection?: ReturnSelection,
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
	const suffix =
		selection && kind === "return-route" && method === "POST"
			? `/${encodeURIComponent(selection.id)}/${encodeURIComponent(selection.family)}`
			: "";
	const response = await fetch(`/api/v1/server/${id}/${kind}${suffix}`, {
		method,
		signal,
		priority,
		cache: "no-store",
		headers: method === "POST" ? { "X-CSRF-Token": csrf } : undefined,
	});
	const body = await response.json();
	if (!response.ok || !body.success)
		throw new Error(body.error || "读取检测结果失败");
	return body.data;
}
