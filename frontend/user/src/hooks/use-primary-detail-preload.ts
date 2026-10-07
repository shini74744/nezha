import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadNetworkChart, loadServerDetailChart, loadServerNetworkSection } from "@/lib/detail-modules";
import { monitorQueryOptions } from "@/lib/monitor-query";

export function usePrimaryDetailPreload(serverId?: number) {
	const client = useQueryClient();
	useEffect(() => {
		if (!serverId || !Number.isSafeInteger(serverId) || serverId < 1) return;
		// Only warm this node's primary panes. No hidden chart mounts, polling,
		// or connectivity/BGP/streaming reads are started by this hook.
		let task: ReturnType<typeof setTimeout> | undefined;
		const frame = requestAnimationFrame(() => {
			task = setTimeout(() => {
				void loadServerDetailChart().catch(() => {});
				void loadServerNetworkSection().catch(() => {});
				void loadNetworkChart().catch(() => {});
				void client.prefetchQuery(monitorQueryOptions(serverId, "1d"));
			}, 0);
		});
		return () => { cancelAnimationFrame(frame); clearTimeout(task); };
	}, [client, serverId]);
}
