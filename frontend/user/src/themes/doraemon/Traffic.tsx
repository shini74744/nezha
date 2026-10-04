import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { normalize } from "@/appearance/config";
import { TrafficRow } from "@/appearance/traffic";

export type DoraemonTrafficStat = {
	quota_type?: "limited" | "unlimited" | "unset";
	name?: string;
	max: number;
	used: number;
	from: string;
	to: string;
	direction: string;
	partial?: boolean;
	estimated?: boolean;
	error?: string;
};
type TrafficState = {
	data?: Record<string, DoraemonTrafficStat>;
	pending: boolean;
	failed: boolean;
	interval: number;
};
export const doraemonTrafficKey = ["doraemon-plan-traffic"] as const;
const TrafficContext = createContext<TrafficState | null>(null);

// One subscription for the whole list, not one request/timer per card.
export function DoraemonTrafficProvider({
	children,
	appearance,
}: {
	children: ReactNode;
	appearance?: string;
}) {
	// Reuse the saved rotation interval without enabling unrelated appearance features.
	const interval = useMemo(
		() => normalize(appearance).features.traffic.toggleInterval as number,
		[appearance],
	);
	const { data, isPending, isError } = useQuery({
		queryKey: doraemonTrafficKey,
		queryFn: async ({ signal }) => {
			const response = await fetch("/api/v1/server-traffic", {
				signal,
				credentials: "same-origin",
				cache: "no-store",
			});
			if (!response.ok) throw new Error("Traffic unavailable");
			const body = await response.json();
			if (
				!body.success ||
				!body.data ||
				typeof body.data !== "object" ||
				Array.isArray(body.data)
			) {
				throw new Error("Traffic unavailable");
			}
			return body.data as Record<string, DoraemonTrafficStat>;
		},
		refetchInterval: 30_000,
		staleTime: 15_000,
		refetchOnMount: "always",
		retry: 1,
	});
	return (
		<TrafficContext.Provider
			value={{ data, pending: isPending, failed: isError, interval }}
		>
			{children}
		</TrafficContext.Provider>
	);
}

function TrafficMessage({ children }: { children: ReactNode }) {
	return <div className="dora-traffic dora-traffic-message">{children}</div>;
}

export function DoraemonTrafficRow({
	stat,
	serverId = 0,
	interval = 5000,
}: {
	stat: DoraemonTrafficStat;
	serverId?: number;
	interval?: number;
}) {
	if (stat.error) return <TrafficMessage>流量套餐设置需检查</TrafficMessage>;
	if (
		!Number.isFinite(stat.max) ||
		stat.max < 0 ||
		!Number.isFinite(stat.used) ||
		stat.used < 0 ||
		(stat.max > 0 && !Number.isFinite((stat.used / stat.max) * 100))
	) {
		return <TrafficMessage>流量数据暂不可用</TrafficMessage>;
	}
	// Use the original beautification renderer: same units, gradient, stripes and rotation.
	// Reset its rotation when the backend rolls over into a new accounting cycle.
	return (
		<section className="dora-traffic" aria-label="本期流量">
			<TrafficRow
				key={serverId + ":" + stat.from}
				serverId={serverId}
				stat={{ ...stat, name: stat.name || "本期流量" }}
				interval={interval}
			/>
		</section>
	);
}

export function DoraemonTraffic({ serverId }: { serverId: number }) {
	const state = useContext(TrafficContext);
	if (!state) return null;
	if (state.pending) return <TrafficMessage>流量加载中…</TrafficMessage>;
	// Do not present a stale previous-cycle percentage as current after a failed refresh.
	if (state.failed)
		return <TrafficMessage>流量暂不可用，稍后重试</TrafficMessage>;
	const stat = state.data?.[String(serverId)];
	if (!stat || typeof stat !== "object")
		return <TrafficMessage>暂无本期流量数据</TrafficMessage>;
	return (
		<DoraemonTrafficRow
			stat={stat}
			serverId={serverId}
			interval={state.interval}
		/>
	);
}
