import type React from "react";
import type { CycleTransferStats, NezhaServer } from "@/types/nezha-api";
import { CycleTransferStatsClient } from "./CycleTransferStatsClient";

export function getCycleTransferRows(serverList: NezhaServer[], cycleStats: CycleTransferStats) {
	const ids = new Set(serverList.map((server) => String(server.id)));
	return Object.entries(cycleStats).flatMap(([cycleId, cycle]) =>
		Object.entries(cycle.server_name ?? {}).flatMap(([serverId, serverName]) => {
			if (!ids.has(serverId)) return [];
			const transfer = cycle.transfer?.[serverId] || 0;
			const nextUpdate = cycle.next_update?.[serverId] || "";
			if (!transfer && !nextUpdate) return [];
			const max = typeof cycle.max === "object" && cycle.max !== null ? cycle.max[serverId] : cycle.max;
			const from = typeof cycle.from === "object" && cycle.from !== null ? cycle.from[serverId] : cycle.from;
			const to = typeof cycle.to === "object" && cycle.to !== null ? cycle.to[serverId] : cycle.to;
			if (!Number.isFinite(max) || max <= 0 || !from || !to) return [];
			return [{ key: cycleId + "-" + serverId, name: cycle.name, from, to, max,
				serverStats: [{ serverId, serverName, transfer, nextUpdate }] }];
		}),
	);
}

interface CycleTransferStatsProps {
	serverList: NezhaServer[];
	cycleStats: CycleTransferStats;
	className?: string;
}

export const CycleTransferStatsCard: React.FC<CycleTransferStatsProps> = ({
	serverList, cycleStats, className,
}) => {
	const rows = getCycleTransferRows(serverList, cycleStats);
	if (!rows.length) return null;
	return (
		<section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
			{rows.map(({key, ...row}) => (
				<CycleTransferStatsClient key={key} {...row} className={className} />
			))}
		</section>
	);
};
export default CycleTransferStatsCard;
