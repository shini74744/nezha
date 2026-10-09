import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectivityResult } from "@/lib/connectivity-api";
import {
	BROWSER_PROBE_MAX_TARGETS,
	BROWSER_PROBE_WORKERS,
	type BrowserConnectivityRun,
} from "@/lib/browser-connectivity";

import { createBrowserConnectivityRunner, type BrowserConnectivityRunner } from "@/lib/browser-connectivity-worker-client";

type LocalRun = BrowserConnectivityRun & { fullBatch: boolean };
type Session = {
	serverId: number;
	run: LocalRun;
	queue: Set<string>;
	active: Map<string, AbortController>;
	runner: BrowserConnectivityRunner;
};
const resetTarget = ({
	id,
	name,
	group,
	host,
	icon,
}: ConnectivityResult): ConnectivityResult => ({
	id,
	name,
	group,
	host,
	icon,
	status: "pending",
	phase: "queued",
	samples: [],
});

export function useBrowserConnectivity(serverId: number) {
	const [state, setState] = useState<{ serverId: number; run: LocalRun }>();
	const latest = useRef<typeof state>(undefined);
	const current = useRef<Session | undefined>(undefined);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const clearUpdate = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = undefined;
	}, []);
	const publish = (run: LocalRun, immediate = false) => {
		latest.current = { serverId, run };
		if (immediate) {
			clearUpdate();
			setState(latest.current);
			return;
		}
		if (timer.current !== undefined) return;
		// Group concurrent completions into one render, without delaying clicks.
		timer.current = setTimeout(() => {
			timer.current = undefined;
			setState(latest.current);
		}, 80);
	};
// biome-ignore lint/correctness/useExhaustiveDependencies: Abort requests and clear ephemeral results when the viewed node changes.
	useEffect(() => {
		latest.current = undefined;
		setState(undefined);
		return () => {
			const session = current.current;
			current.current = undefined;
			session?.active.forEach((controller) => { controller.abort(); });
			session?.runner.dispose();
			clearUpdate();
		};
	}, [serverId, clearUpdate]);

	const replace = (session: Session, result: ConnectivityResult) => {
		session.run = {
			...session.run,
			results: session.run.results.map((row) =>
				row.id === result.id ? result : row,
			),
		};
	};
	const pump = (session: Session) => {
		if (current.current !== session) return;
		for (const id of session.queue) {
			if (session.active.size >= BROWSER_PROBE_WORKERS) break;
			// Repeated clicks abort the old request and retain one replacement.
			// Keep its slot occupied until it settles, so concurrency stays bounded.
			if (session.active.has(id)) continue;
			session.queue.delete(id);
			const target = session.run.results.find((row) => row.id === id)!;
			const controller = new AbortController();
			session.active.set(id, controller);
			replace(session, { ...target, phase: "running" });
			void session.runner.run(target, controller.signal, (run) => {
				if (current.current !== session || session.active.get(id) !== controller ||
					controller.signal.aborted || session.queue.has(id)) return;
				replace(session, run.results[0]);
				publish(session.run);
			}).then(
				(run) => {
					if (
						current.current !== session ||
						session.active.get(id) !== controller
					)
						return;
					session.active.delete(id);
					if (!session.queue.has(id)) replace(session, run.results[0]);
					pump(session);
				},
			);
		}
		if (!session.active.size && !session.queue.size) {
			session.runner.dispose();
			session.run = { ...session.run, state: "complete" };
			current.current = undefined;
			publish(session.run, true);
		} else publish(session.run);
	};
	const start = (targets: readonly ConnectivityResult[], targetId?: string) => {
		if (current.current || !targets.length) return;
		const results = Array.from(
			new Map(
				targets
					.slice(0, BROWSER_PROBE_MAX_TARGETS)
					.map((row) => [row.id, resetTarget(row)]),
			).values(),
		);
		if (targetId && !results.some(row => row.id === targetId)) return;
        const session: Session = {
			serverId,
			run: { state: "running", cancelled: false, fullBatch: !targetId, results: results.map(row => targetId && row.id !== targetId ? {...row,phase:undefined} : row) },
			queue: new Set(results.filter(row => !targetId || row.id === targetId).map((row) => row.id)),
			active: new Map(),
			runner: createBrowserConnectivityRunner(),
		};
		current.current = session;
		publish(session.run, true);
		pump(session);
	};
	const retry = (targetId: string) => {
		const saved = latest.current;
		if (saved?.serverId !== serverId) return;
		const target = saved.run.results.find((row) => row.id === targetId);
		if (!target) return;
		const session: Session = current.current || {
			serverId,
			run: {
				...saved.run,
				state: "running",
				cancelled: false,
				fullBatch: false,
			},
			queue: new Set(),
			active: new Map(),
			runner: createBrowserConnectivityRunner(),
		};
		current.current = session;
		replace(session, resetTarget(target));
		// User-requested retries take the next free slot ahead of batch work.
		session.queue = new Set([targetId, ...session.queue]);
		session.active.get(targetId)?.abort();
		publish(session.run, true);
		pump(session);
	};
	const stop = useCallback(() => {
		const session = current.current;
		if (!session) return;
		current.current = undefined;
		session.active.forEach((controller) => { controller.abort(); });
		session.runner.dispose();
		clearUpdate();
		const run: LocalRun = {
			...session.run,
			state: "complete",
			cancelled: true,
			fullBatch: false,
			results: session.run.results.map((row) =>
				row.phase !== "queued" && row.phase !== "running"
					? row
					: {
							...row,
							status: "cancelled",
							phase: "complete",
						},
			),
		};
		latest.current = { serverId: session.serverId, run };
		setState(latest.current);
	}, [clearUpdate]);
	return {
		run: state?.serverId === serverId ? state.run : undefined,
		start,
		retry,
		stop,
	};
}