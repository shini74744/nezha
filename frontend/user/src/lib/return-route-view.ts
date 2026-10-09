import type {
	ReturnHop,
	ReturnResult,
	InsightSnapshot,
} from "./network-insight-api";
export function returnHopRows(
	hops: ReturnHop[],
	compact: boolean,
): Array<{ hop: ReturnHop; end: number }> {
	const rows: Array<{ hop: ReturnHop; end: number }> = [];
	for (const hop of hops) {
		const previous = rows[rows.length - 1];
		if (
			compact &&
			!hop.samples &&
			previous &&
			!previous.hop.samples &&
			hop.ttl === previous.end + 1
		)
			previous.end = hop.ttl;
		else rows.push({ hop, end: hop.ttl });
	}
	return rows;
}
export const returnStages: Record<string, { text: string; help: string }> = {
	origin: {
		text: "节点出口",
		help: "检测起始响应，可能属于节点或接入商网络。",
	},
	international: {
		text: "国际段",
		help: "根据响应节点的位置标注；不代表海缆走向。",
	},
	landing: {
		text: "登陆点·推测",
		help: "境外响应之后首次观测到的中国大陆响应，不代表已确认的物理海缆登陆站。",
	},
	domestic: { text: "境内段", help: "本次响应的地理信息位于中国大陆。" },
	destination: { text: "到达", help: "该跳响应地址与本次检测目标一致。" },
};

// The backend marks destination before hiding private addresses. Never use the
// last responding intermediate router as the final destination latency.
export function finalReturnRTT(r?: ReturnResult): number | undefined {
	if (!r || r.status !== "reached") return;
	const hops = (r.hops || []).filter(
		(h) =>
			(h.stage === "destination" || (!!r.target && h.ip === r.target)) &&
			h.samples > 0 &&
			Number.isFinite(h.samples) &&
			typeof h.rtt_ms === "number" &&
			Number.isFinite(h.rtt_ms) &&
			h.rtt_ms >= 0,
	);
	if (!hops.length) return;
	const total = hops.reduce((n, h) => n + h.samples, 0);
	return hops.reduce((n, h) => n + (h.rtt_ms! * h.samples) / total, 0);
}

// Script-style network categories, NOT end-to-end performance or GIA proof.
// Source: zhanghanyun/backtrace/asn.go. Prefer the backend's prefix-aware network.
export function returnQuality(
	h: ReturnHop,
): "优质线路" | "普通线路" | undefined {
	if (!h.samples) return;
	const network =
		h.network ||
		(
			{
				"4809": "电信 CN2",
				"9929": "联通 9929",
				"58807": "移动 CMIN2",
				"4134": "电信 163",
				"4837": "联通 4837",
				"58453": "移动 CMI",
				"9808": "移动 9808",
			} as Record<string, string>
		)[h.asn || ""];
	if (["电信 CN2", "联通 9929", "移动 CMIN2"].includes(network))
		return "优质线路";
	if (["电信 163", "联通 4837", "移动 CMI", "移动 9808"].includes(network))
		return "普通线路";
}
export const returnQualityHelp =
	"按该跳所属网络的常见分级标注；不代表全程质量、实时速度或已确认 CN2 GIA。";

export function completedReturnSnapshots(
	history: InsightSnapshot[] = [],
): InsightSnapshot[] {
	const seen = new Set<number>();
	return [...history]
		.filter((s) => {
			if (
				!s.finished_at ||
				["running", "queued", "pending"].includes(s.state) ||
				seen.has(s.finished_at)
			)
				return false;
			seen.add(s.finished_at);
			return true;
		})
		.sort((a, b) => b.finished_at! - a.finished_at!);
}
export const returnRouteKey = (r: ReturnResult) =>
	JSON.stringify([r.id, r.family]);
export function comparableReturnRoutes(
	a?: ReturnResult,
	b?: ReturnResult,
): boolean {
	if (
		!a ||
		!b ||
		returnRouteKey(a) !== returnRouteKey(b) ||
		a.protocol !== b.protocol
	)
		return false;
	if (a.comparison_key && b.comparison_key)
		return a.comparison_key === b.comparison_key;
	// Safe compatibility fallback for old backends; never assume hidden targets match.
	return !!a.target && a.target === b.target;
}
function hopSignature(h: ReturnHop) {
	return !h.samples
		? "unanswered"
		: JSON.stringify([h.ip || "", h.asn || "", h.network || "", h.stage || ""]);
}
export function compareReturnHops(a?: ReturnResult, b?: ReturnResult) {
	const left = new Map<number, ReturnHop[]>(),
		right = new Map<number, ReturnHop[]>();
	for (const [route, map] of [
		[a, left],
		[b, right],
	] as const)
		for (const hop of route?.hops || [])
			map.set(hop.ttl, [...(map.get(hop.ttl) || []), hop]);
	return [...new Set([...left.keys(), ...right.keys()])]
		.sort((x, y) => x - y)
		.map((ttl) => {
			const before = left.get(ttl) || [],
				after = right.get(ttl) || [];
			const signature = (h: ReturnHop[]) =>
				[...new Set(h.map(hopSignature))].sort().join("|");
			return {
				ttl,
				before,
				after,
				changed: signature(before) !== signature(after),
			};
		});
}
export function compareReturnSnapshots(
	before: InsightSnapshot,
	after: InsightSnapshot,
	family: string,
) {
	const a = new Map(
		(before.routes || [])
			.filter((r) => r.family === family)
			.map((r) => [returnRouteKey(r), r]),
	);
	const b = new Map(
		(after.routes || [])
			.filter((r) => r.family === family)
			.map((r) => [returnRouteKey(r), r]),
	);
	return [...new Set([...b.keys(), ...a.keys()])].map((key) => {
		const left = a.get(key),
			right = b.get(key),
			comparable = comparableReturnRoutes(left, right);
		const first = finalReturnRTT(left),
			last = finalReturnRTT(right),
			hops = compareReturnHops(left, right);
		const changed =
			!left ||
			!right ||
			!comparable ||
			left.status !== right.status ||
			left.line !== right.line ||
			JSON.stringify(left.route || []) !== JSON.stringify(right.route || []) ||
			hops.some((h) => h.changed);
		return {
			key,
			before: left,
			after: right,
			comparable,
			hops,
			changed,
			delta:
				comparable && first !== undefined && last !== undefined
					? last - first
					: undefined,
		};
	});
}
export const returnStatusText: Record<string, string> = {
	pending: "等待检测",
	reached: "已到达",
	partial: "部分路由",
	no_reply: "未收到响应",
	timeout: "检测超时",
	offline: "节点离线",
	disabled: "检测已停用",
	unsupported: "暂不支持此节点系统",
	tool_missing: "缺少检测工具",
	permission: "需要节点执行权限",
	download_failed: "检测工具下载失败",
	integrity_failed: "检测工具校验失败",
	probe_failed: "检测未完成",
	invalid_result: "检测结果无效",
	invalid_target: "检测地址无效",
};
