import { queryOptions } from "@tanstack/react-query";
import { fetchConnectivity } from "./connectivity-api";
import { insightRequest, type InsightKind } from "./network-insight-api";

export function connectivityQueryOptions(serverId: number, preload = false) {
	return queryOptions({
		queryKey: ["server-connectivity", serverId],
		// Retain one in-flight read across tab unmounts. Explicit cancellation
		// before a manual result update still prevents an older read committing.
		queryFn: () => preload ? fetchConnectivity(serverId, undefined, "low") : fetchConnectivity(serverId),
		staleTime: query => query.state.data?.state === "running" ? 0 : 15000,
		retry: 1,
	});
}

export function insightQueryOptions(serverId: number, kind: InsightKind, viewer: number, preload = false) {
	return queryOptions({
		queryKey: ["network-insight", serverId, kind, viewer],
		queryFn: () => preload ? insightRequest(serverId, kind, "GET", undefined, "low") : insightRequest(serverId, kind, "GET"),
		staleTime: query => query.state.data?.state === "running" ? 0 : 30000,
		retry: 1,
	});
}
