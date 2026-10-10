import { useEffect, useRef, useState } from "react";

export type StatisticsView = "closed" | "traffic" | "cycle" | "uptime";
export function isStatisticsView(value: unknown): value is StatisticsView {
	return value === "closed" || value === "traffic" || value === "cycle" || value === "uptime";
}

/** Restore only once per theme; polling must never override a user's selection. */
export function useStatisticsView(prefix: string, ready: boolean, hasTraffic: boolean) {
	const key = prefix + "statisticsView";
	const restoredKey = useRef<string | null>(null);
	const [view, setView] = useState<StatisticsView>("closed");
	useEffect(() => {
		if (restoredKey.current === key) return;
		let saved: string | null = null;
		let legacy = false;
		try {
			saved = localStorage.getItem(key);
			legacy = localStorage.getItem(prefix + "showServices") === "1";
		} catch { /* Private browsing still supports switching for this visit. */ }
		if (isStatisticsView(saved)) {
			restoredKey.current = key;
			setView(saved);
		} else if (legacy || window.ForceShowServices) {
			if (!ready) return;
			restoredKey.current = key;
			setView(hasTraffic ? "traffic" : "uptime");
		} else {
			restoredKey.current = key;
			setView("closed");
		}
	}, [key, prefix, ready, hasTraffic]);

	function select(next: StatisticsView) {
		restoredKey.current = key;
		setView(next);
		try { localStorage.setItem(key, next); } catch { /* Optional persistence. */ }
	}
	return [view, select] as const;
}
