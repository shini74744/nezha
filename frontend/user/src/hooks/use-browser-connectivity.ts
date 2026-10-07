import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectivityResult } from "@/lib/connectivity-api";
import { runBrowserConnectivity, type BrowserConnectivityRun } from "@/lib/browser-connectivity";

export function useBrowserConnectivity(serverId: number) {
	const [state, setState] = useState<{ serverId: number; run: BrowserConnectivityRun }>();
	const job = useRef<AbortController | undefined>(undefined);
	const pending = useRef<BrowserConnectivityRun | undefined>(undefined);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const clearUpdate = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = undefined;
		pending.current = undefined;
	}, []);
	useEffect(() => {
		setState(undefined);
		return () => {
			job.current?.abort();
			job.current = undefined;
			clearUpdate();
		};
	}, [serverId, clearUpdate]);

	const start = (targets: readonly ConnectivityResult[]) => {
		if (job.current || !targets.length) return;
		const controller = new AbortController();
		job.current = controller;
		clearUpdate();
		const apply = (run: BrowserConnectivityRun) => {
			if (job.current === controller) setState({ serverId, run });
		};
		const queue = (run: BrowserConnectivityRun) => {
			if (job.current !== controller) return;
			pending.current = run;
			if (timer.current !== undefined) return;
			// Coalesce concurrent completions instead of repainting the whole
			// catalog for every individual response.
			timer.current = setTimeout(() => {
				timer.current = undefined;
				if (pending.current) apply(pending.current);
				pending.current = undefined;
			}, 80);
		};
		// Clear old results immediately; runBrowserConnectivity creates an
		// independent copy and can never mutate the shared server query cache.
		apply({ state: "running", cancelled: false, results: targets.map(
			({ id, name, group, host, icon }) => ({ id, name, group, host, icon, status: "pending", phase: "queued", samples: [] }),
		) });
		void runBrowserConnectivity(targets, controller.signal, queue).then(run => {
			if (job.current !== controller) return;
			clearUpdate();
			apply(run);
			job.current = undefined;
		});
	};
	const stop = useCallback(() => job.current?.abort(), []);
	return {
		run: state?.serverId === serverId ? state.run : undefined,
		start,
		stop,
	};
}
