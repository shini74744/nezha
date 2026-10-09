import catalog from "../../../../service/connectivity/catalog.json";
import { averageConnectivityDelay } from "./connectivity-latency";
import type { ConnectivityResult, ConnectivitySample } from "./connectivity-api";

export const BROWSER_PROBE_TIMEOUT_MS = 3000;
export const BROWSER_PROBE_WORKERS = 6;
export const BROWSER_PROBE_ROUNDS = 10;
export const BROWSER_PROBE_WARMUPS = 2;

// Ship only public built-ins. Administrator paths/queries are never exposed.
const resourceURLs = new Map(catalog.map(target => [target.host, target.url]));
export const BROWSER_PROBE_MAX_TARGETS = 120;

// Both server and browser use the same built-in lightweight resources. Custom
// public hosts use /favicon.ico, never private administrator paths or queries.
export function browserProbeURL(host: string, pageURL: string = location.href): string | undefined {
	if (!host || host.length > 253 || host !== host.trim()) return;
	const hostname = host.toLowerCase();
	const labels = hostname.split(".");
	const cloudflare = hostname === "1.1.1.1";
	if (!cloudflare && (labels.length < 2 || !/[a-z]/.test(labels[labels.length - 1]) ||
		labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return;
	if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|onion)$/.test(hostname)) return;
	try {
		const url = new URL(resourceURLs.get(hostname) || `https://${hostname}/favicon.ico`);
		// Do not probe the panel itself, including custom catalog entries for it.
		if (url.hostname !== hostname || url.hostname === new URL(pageURL).hostname) return;
		return url.href;
	} catch { return; }
}

export interface BrowserConnectivityRun {
	state: "running" | "complete";
	results: ConnectivityResult[];
	cancelled: boolean;
}

async function probe(host: string, signal: AbortSignal, pageURL: string): Promise<ConnectivitySample> {
	const url = browserProbeURL(host, pageURL);
	if (!url) return { status: "browser_unsupported" };
	if (signal.aborted) return { status: "cancelled" };
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener("abort", abort, { once: true });
	let timeout = false;
	const timer = setTimeout(() => { timeout = true; controller.abort(); }, BROWSER_PROBE_TIMEOUT_MS);
	const started = performance.now();
	try {
		const response = await fetch(url, {
			method: "HEAD", mode: "no-cors", credentials: "omit",
			cache: "no-store", referrerPolicy: "no-referrer",
			redirect: "follow", signal: controller.signal,
		});
		if (signal.aborted) return { status: "cancelled" };
		// no-cors requires redirect=follow in the Fetch standard. Credentials
		// remain omitted through redirects. Opaque HTTP status/body is hidden.
		if (response.type === "error") return { status: "browser_error" };
		return { status: "ok", delay_ms: Math.max(0, performance.now() - started) };
	} catch {
		return { status: signal.aborted ? "cancelled" : timeout ? "timeout" : "browser_error" };
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
		controller.abort();
	}
}

// Browser-only, bounded work. No panel mutations, storage, cookies or result
// uploads. HEAD avoids downloading bodies. Normal site redirects are included
// in elapsed time and remain subject to browser mixed-content/network policy.
export async function runBrowserConnectivity(
	targets: readonly ConnectivityResult[],
	signal: AbortSignal,
	onUpdate: (run: BrowserConnectivityRun) => void,
	pageURL: string = location.href,
): Promise<BrowserConnectivityRun> {
	const results: ConnectivityResult[] = targets.slice(0, BROWSER_PROBE_MAX_TARGETS).map(
		({ id, name, group, host, icon }) => ({ id, name, group, host, icon, status: "pending", phase: "queued", samples: [] }),
	);
	let next = 0;
	const snapshot = (state: BrowserConnectivityRun["state"]): BrowserConnectivityRun =>
		({ state, results: [...results], cancelled: signal.aborted });
	const worker = async () => {
		while (!signal.aborted && next < results.length) {
			const index = next++;
			results[index] = { ...results[index], phase: "running" };
			onUpdate(snapshot("running"));
			// Warm DNS/TLS/HTTP connections without inventing dots or averaging cold requests.
			for (let warmup = 0; warmup < BROWSER_PROBE_WARMUPS && !signal.aborted; warmup++) {
				await probe(results[index].host, signal, pageURL);
			}
			for (let round = 0; round < BROWSER_PROBE_ROUNDS && !signal.aborted; round++) {
				const sample = await probe(results[index].host, signal, pageURL);
				// Cancellation is not a failed sample; keep only completed attempts.
				if (signal.aborted) break;
				const samples = [...results[index].samples, sample];
				const delay_ms = averageConnectivityDelay(samples);
				results[index] = {
					...results[index], samples, delay_ms,
					phase: round === BROWSER_PROBE_ROUNDS - 1 ? "complete" : "running",
					status: samples.every(s => s.status === samples[0].status) ? samples[0].status : "unstable",
				};
				onUpdate(snapshot("running"));
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(BROWSER_PROBE_WORKERS, results.length) }, worker));
	for (let i = 0; i < results.length; i++) {
		if (results[i].phase !== "complete")
			results[i] = { ...results[i], phase: "complete", status: "cancelled" };
	}
	return snapshot("complete");
}
