import { useEffect, useRef, useState } from "react";
import type { Feature } from "./config";
import { useAppearanceLayout, useFeature } from "./context";
import { isTouchDevice, useMedia } from "./native-hooks";

type Base = { ip: string; loc: string; asn: string; org: string };
type Probe = { name: string; ms: number };
type Node = { name: string; url: string };
const cacheKey = "nezha_ip_bar_cache_v6";
export function parseVisitorBase(value: Record<string, unknown>): Base {
	const ip = String(value.ip || value.query || ""),
		country = String(value.country_name || value.country || ""),
		city = String(value.city || value.region || value.regionName || "");
	const org = String(
		value.org || value.organization || value.isp || value.as || "",
	);
	return {
		ip,
		loc:
			country && city && country !== city
				? `${country} · ${city}`
				: country || city,
		asn: String(value.asn || org.match(/^AS\d+\b/i)?.[0] || ""),
		org: org.replace(/^AS\d+\s*/i, ""),
	};
}
export function visitorText(base: Base, f: Feature, desktop: boolean) {
	const ip = base.ip.includes(":") ? "IPv6 network" : base.ip;
	const items = [ip];
	if (f.showRegion && base.loc) items.push(base.loc);
	if (desktop) {
		const org = [
			f.showASN ? base.asn : "",
			f.showOrganization ? base.org.replace(/^AS\d+\s*/i, "") : "",
		]
			.filter(Boolean)
			.join(" ");
		if (org) items.push(org);
	}
	return items.filter(Boolean).join(" ｜ ");
}
async function request(
	url: string,
	signal: AbortSignal,
	timeout: number,
	json: boolean,
): Promise<Record<string, unknown> | number> {
	if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
	const controller = new AbortController(),
		cancel = () => controller.abort();
	signal.addEventListener("abort", cancel, { once: true });
	const timer = setTimeout(cancel, timeout),
		started = performance.now();
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			credentials: "omit",
			cache: "no-store",
			...(json ? {} : { mode: "no-cors" as const }),
		});
		if (json) {
			if (!response.ok) throw Error("IP provider failed");
			return await response.json();
		}
		return Math.round(performance.now() - started);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", cancel);
	}
}
async function firstSuccess<T>(
	signal: AbortSignal,
	tasks: ((signal: AbortSignal) => Promise<T>)[],
): Promise<T> {
	const controller = new AbortController(),
		cancel = () => controller.abort();
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	try {
		return await new Promise<T>((resolve, reject) => {
			if (!tasks.length) {
				reject(Error("No providers"));
				return;
			}
			let failed = 0;
			for (const task of tasks)
				Promise.resolve()
					.then(() => task(controller.signal))
					.then(resolve, (error) => {
						if (++failed === tasks.length) reject(error);
					});
		});
	} finally {
		cancel();
		signal.removeEventListener("abort", cancel);
	}
}
function loadCache(source: string, duration: number): Base | null {
	try {
		const data = JSON.parse(localStorage.getItem(cacheKey) || "null");
		return duration > 0 &&
			data?.source === source &&
			Number.isFinite(data.ts) &&
			Date.now() - data.ts < duration &&
			["ip", "loc", "asn", "org"].every(
				(key) => typeof data.base?.[key] === "string",
			) &&
			Date.now() >= data.ts
			? data.base
			: null;
	} catch {
		return null;
	}
}
function latencyClass(ms: number) {
	return ms < 80
		? "lat-excellent"
		: ms < 150
			? "lat-good"
			: ms < 300
				? "lat-mid"
				: "lat-bad";
}
function downlink(f: Feature) {
	const connection = (
		navigator as Navigator & { connection?: { downlink?: number } }
	).connection;
	const value = connection?.downlink;
	return f.showDownlink && typeof value === "number" && Number.isFinite(value)
		? " · ↓" +
				(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10) +
				"Mbps"
		: "";
}
export function NativeVisitorIP() {
	const f = useFeature("visitorIP"),
		desktop = useMedia("(min-width:641px)") && !isTouchDevice(),
		layout = useAppearanceLayout();
	const [base, setBase] = useState<Base | null>(null),
		[status, setStatus] = useState(""),
		[error, setError] = useState("");
	const [net, setNet] = useState<Probe | null>(null),
		[busy, setBusy] = useState(false),
		[hidden, setHidden] = useState(false);
	const controller = useRef<AbortController | null>(null),
		switching = useRef(false),
		currentName = useRef("");
	const source = JSON.stringify([f.ipApiUrls, f.fallbackUrl]),
		network =
			desktop && f.networkEnabled && (f.checkNodes as Node[]).length > 0;
	useEffect(() => {
		if (!f.enabled) return;
		const abort = new AbortController();
		controller.current = abort;
		let active = true;
		switching.current = false;
		currentName.current = "";
		setNet(null);
		setStatus("");
		setError("");
		setBusy(false);
		const cached = loadCache(source, f.cacheDuration);
		setBase(cached);
		const probe = async () => {
			if (!network) return;
			setStatus("检测中…");
			setBusy(true);
			try {
				const winner = await firstSuccess(
					abort.signal,
					(f.checkNodes as Node[]).map((node) => async (signal) => ({
						name: node.name,
						ms: (await request(
							node.url,
							signal,
							f.checkTimeout,
							false,
						)) as number,
					})),
				);
				if (active) {
					setNet(winner);
					currentName.current = winner.name;
					setStatus("");
				}
			} catch {
				if (active) setStatus("测速失败");
			} finally {
				if (active) setBusy(false);
			}
		};
		void (async () => {
			let next: Base | null = null;
			try {
				const data = await firstSuccess(
					abort.signal,
					(f.ipApiUrls as string[]).map((url) => async (signal) => {
						const value = (await request(
							url,
							signal,
							f.queryTimeout,
							true,
						)) as Record<string, unknown>;
						if (!value.ip && !value.query) throw Error("Missing IP");
						return value;
					}),
				);
				next = parseVisitorBase(data);
				if (
					desktop &&
					f.fallbackUrl &&
					((f.showASN && !next.asn) ||
						(f.showOrganization && !next.org) ||
						(f.showRegion && !next.loc))
				) {
					try {
						const fallback = parseVisitorBase(
							(await request(
								f.fallbackUrl,
								abort.signal,
								f.fallbackTimeout,
								true,
							)) as Record<string, unknown>,
						);
						next = {
							ip: next.ip || fallback.ip,
							loc: next.loc || fallback.loc,
							asn: next.asn || fallback.asn,
							org: next.org || fallback.org,
						};
					} catch {
						/* Optional metadata must not hide a working IP response. */
					}
				}
				if (active) {
					setBase(next);
					if (f.cacheDuration > 0)
						try {
							localStorage.setItem(
								cacheKey,
								JSON.stringify({ ts: Date.now(), source, base: next }),
							);
						} catch {
							/* Storage can be disabled. */
						}
				}
			} catch {
				if (active && !cached) setError("无法获取IP信息");
			}
			if (active && (next || cached)) await probe();
		})();
		return () => {
			active = false;
			abort.abort();
			controller.current = null;
			switching.current = false;
		};
	}, [f, source, desktop, network]);
	useEffect(() => {
		if (!f.enabled) return;
		const footer = layout.footer.current;
		if (!footer) return;
		const update = () => {
			const rect = footer.getBoundingClientRect();
			setHidden(
				rect.height > 0 &&
					rect.top <= innerHeight + f.bottomThreshold &&
					rect.bottom >= 0,
			);
		};
		const observer = new IntersectionObserver(update, {
			rootMargin: `0px 0px ${f.bottomThreshold}px 0px`,
		});
		observer.observe(footer);
		const resize = new ResizeObserver(update);
		resize.observe(footer);
		update();
		window.addEventListener("resize", update);
		return () => {
			observer.disconnect();
			resize.disconnect();
			window.removeEventListener("resize", update);
		};
	}, [f.enabled, f.bottomThreshold, layout]);
	async function cycle() {
		if (!network || switching.current || busy || !controller.current) return;
		const signal = controller.current.signal,
			nodes = f.checkNodes as Node[],
			index = nodes.findIndex((n) => n.name === currentName.current),
			node = nodes[(index + 1) % nodes.length];
		switching.current = true;
		setBusy(true);
		setStatus("测速中…");
		try {
			const ms = (await request(
				node.url,
				signal,
				f.switchTimeout,
				false,
			)) as number;
			if (!signal.aborted) {
				setNet({ name: node.name, ms });
				setStatus("");
			}
		} catch {
			if (!signal.aborted) {
				setNet(null);
				setStatus(`${node.name} 检测失败`);
			}
		} finally {
			if (!signal.aborted) {
				currentName.current = node.name;
				setBusy(false);
				switching.current = false;
			}
		}
	}
	if (!f.enabled) return null;
	const text = base
		? visitorText(base, f, desktop)
		: error || "正在获取IP信息…";
	const detail =
		status || (net ? `${net.name} 延迟 ${net.ms}ms${downlink(f)}` : "");
	return (
		<div
			id="ip-bar"
			data-native-visitor-ip
			className={hidden ? "ip-hidden" : ""}
			inert={hidden}
			aria-hidden={hidden}
		>
			<div className="ip-inner">
				<span className="ip-icon" aria-hidden />
				<div className="ip-text">
					<span className="ip-l">Your IP:</span>
					<span id="ip-val" title={text + (detail ? ` ｜ ${detail}` : "")}>
						<span id="ip-base">{text}</span>
						{network && (
							<button
								type="button"
								id="ip-net"
								className={`ip-net ${net ? latencyClass(net.ms) : "lat-mid"}`}
								aria-label="点击切换测速点"
								aria-busy={busy}
								disabled={busy}
								onClick={() => void cycle()}
							>
								{detail ? ` ｜ ${detail}` : ""}
							</button>
						)}
					</span>
				</div>
			</div>
		</div>
	);
}
