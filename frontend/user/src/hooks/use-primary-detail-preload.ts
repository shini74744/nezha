import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadNetworkChart, loadServerDetailChart, loadServerNetworkSection, loadServerConnectivity, loadServerNetworkInsight, loadBGPTopology } from "@/lib/detail-modules";
import { monitorQueryOptions } from "@/lib/monitor-query";
import { connectivityQueryOptions, insightQueryOptions } from "@/lib/detail-result-query";
import { fetchLoginUser } from "@/lib/nezha-api";

interface SecondaryPanes { connectivity?: boolean; bgp?: boolean; streaming?: boolean }
function whenIdle(work: () => void) {
	if (typeof window.requestIdleCallback === "function") {
		const id = window.requestIdleCallback(work);
		return () => window.cancelIdleCallback(id);
	}
	const id = setTimeout(work, 50);
	return () => clearTimeout(id);
}

export function usePrimaryDetailPreload(serverId?: number, { connectivity = false, bgp = false, streaming = false }: SecondaryPanes = {}) {
	const client = useQueryClient();
	const warmTab = useCallback(async (tab: string, preload = false) => {
		if (!serverId || !Number.isSafeInteger(serverId) || serverId < 1) return;
		if (tab === "Connectivity" && connectivity) {
			void loadServerConnectivity().catch(() => {});
			await client.prefetchQuery(connectivityQueryOptions(serverId, preload));
		} else if ((tab === "BGP" && bgp) || (tab === "Streaming" && streaming)) {
			void loadServerNetworkInsight().catch(() => {});
			if (tab === "BGP") void loadBGPTopology().catch(() => {});
			// Resolve identity before choosing a cache key: an administrator's
			// IP-bearing response must never be cached as a guest response.
			const member = await client.fetchQuery({
				queryKey: ["login-user"], queryFn: fetchLoginUser, staleTime: 30000, retry: 0,
			}).catch(() => undefined);
			const viewer = member?.data?.id || 0;
			await client.prefetchQuery(insightQueryOptions(serverId, tab === "BGP" ? "bgp" : "streaming", viewer, preload));
		}
	}, [client, serverId, connectivity, bgp, streaming]);

	useEffect(() => {
		if (!serverId || !Number.isSafeInteger(serverId) || serverId < 1) return;
		let stopped = false;
		let cancelIdle: (() => void) | undefined;
		let task: ReturnType<typeof setTimeout> | undefined;
		const frame = requestAnimationFrame(() => {
			task = setTimeout(() => {
				const primary = [
					loadServerDetailChart(), loadServerNetworkSection(), loadNetworkChart(),
					client.prefetchQuery(monitorQueryOptions(serverId, "1d")),
				];
				void Promise.allSettled(primary);
				// Issue primary work first, then warm the remaining panes in idle
				// turns concurrently with those requests, not after they finish.
				// Only read saved results; never mount or poll hidden panes.
				const tabs = ["Connectivity", "Streaming", "BGP"];
				const next = () => {
					if (stopped || !tabs.length) return;
					cancelIdle = whenIdle(() => {
						if (stopped) return;
						void warmTab(tabs.shift()!, true);
						next();
					});
				};
				next();
			}, 0);
		});
		return () => { stopped = true; cancelAnimationFrame(frame); clearTimeout(task); cancelIdle?.(); };
	}, [client, serverId, warmTab]);
	return warmTab;
}
