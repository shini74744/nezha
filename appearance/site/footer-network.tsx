import { Copy, Globe2, Radio, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFeature } from "./context";
import { parseVisitorBase } from "./native-visitor-ip";
import "./footer-network.css";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

type Source = { id: string; name: string; url: string; trace?: boolean };
type Result = { ip?: string; detail?: string; ms?: number; error?: string };
const probes: Source[] = [
	{
		id: "byte",
		name: "字节跳动",
		url: "https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/jquery/3.6.0/jquery.min.js",
	},
	{
		id: "bili",
		name: "Bilibili",
		url: "https://www.bilibili.com/favicon.ico?ddnezha-probe=1",
	},
	{
		id: "jsdelivr",
		name: "jsDelivr",
		url: "https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js",
	},
	{
		id: "youtube",
		name: "YouTube",
		url: "https://www.youtube.com/favicon.ico?ddnezha-probe=1",
	},
];
export function isBuiltInFooterURL(value: string) {
	if (!value) return true;
	try {
		const u = new URL(value);
		return (
			["ip.skk.moe", "embed-legacy.ip.skk.moe"].includes(u.hostname) &&
			/^\/simple(?:-dark)?\/?$/.test(u.pathname) &&
			!u.search &&
			!u.hash
		);
	} catch {
		return false;
	}
}
function sourceName(url: string, index: number) {
	try {
		return new URL(url).hostname.replace(/^api\./, "");
	} catch {
		return `IP 来源 ${index + 1}`;
	}
}
export function parseFooterIP(
	value: Record<string, unknown>,
	settings: Record<string, unknown>,
) {
	const base = parseVisitorBase(value);
	// Treat provider data as text. Never render returned markup or fake a successful IP.
	if (!base.ip || !/^[\da-fA-F:.]+$/.test(base.ip))
		throw Error("IP 数据不完整");
	const details = [
		settings.showRegion && base.loc,
		settings.showASN &&
			base.asn &&
			(/^AS/i.test(base.asn) ? base.asn : `AS${base.asn}`),
		settings.showOrganization && base.org,
	].filter(Boolean);
	return { ip: base.ip, detail: details.join(" · ") };
}
export async function footerRequest(
	source: Source,
	signal: AbortSignal,
	timeout: number,
	ip: boolean,
	settings: Record<string, unknown>,
): Promise<Result> {
	if (signal.aborted) throw new DOMException("Aborted", "AbortError");
	const controller = new AbortController();
	const cancel = () => {
		clearTimeout(timer);
		controller.abort();
	};
	signal.addEventListener("abort", cancel, { once: true });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeout);
	const start = performance.now();
	try {
		const r = await fetch(source.url, {
			signal: controller.signal,
			credentials: "omit",
			cache: "no-store",
			referrerPolicy: "no-referrer",
			...(!ip ? { mode: "no-cors" as const } : {}),
		});
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
		if (!ip) {
			if (r.type !== "opaque" && !r.ok) throw Error("Request failed");
			return { ms: Math.max(0, Math.round(performance.now() - start)) };
		}
		if (!r.ok) throw Error("Provider failed");
		if (source.trace) {
			const values = Object.fromEntries(
				(await r.text()).split("\n").map((line) => line.split("=")),
			);
			return parseFooterIP({ ip: values.ip, country: values.loc }, settings);
		}
		return parseFooterIP(await r.json(), settings);
	} catch {
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
		return { error: timedOut ? "请求超时" : "暂不可用" };
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", cancel);
	}
}
export function FooterNetworkCard({
	active,
	onClose,
}: {
	active: boolean;
	onClose: () => void;
}) {
	const settings = useFeature("visitorIP");
	const cardSurface = window.CustomBackgroundImage ? "bg-card/70" : "bg-card";
	const sources: Source[] = (settings.ipApiUrls as string[]).map(
		(url, index) => ({ id: `ip-${index}`, name: sourceName(url, index), url }),
	);
	for (const extra of [
		{ id: "ip-sb", name: "IP.SB", url: "https://api.ip.sb/geoip" },
		{
			id: "ip-cf",
			name: "Cloudflare",
			url: "https://one.one.one.one/cdn-cgi/trace",
			trace: true,
		},
	])
		if (!sources.some((s) => s.url === extra.url)) sources.push(extra);
	const signature = JSON.stringify([
		sources,
		settings.showRegion,
		settings.showASN,
		settings.showOrganization,
		settings.queryTimeout,
	]);
	const [results, setResults] = useState<Record<string, Result>>({});
	const [busy, setBusy] = useState(false),
		[retry, setRetry] = useState(0),
		[notice, setNotice] = useState("");
	const [completed, setCompleted] = useState("");
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (!active) setExpanded(false);
	}, [active]);
	const loaded = useRef(""),
		run = useRef(0);
	useEffect(() => {
		if (!active) return;
		const key = `${signature}:${retry}`;
		if (loaded.current === key) return;
		const [
			requestedSources,
			showRegion,
			showASN,
			showOrganization,
			queryTimeout,
		] = JSON.parse(signature) as [Source[], boolean, boolean, boolean, number];
		const displaySettings = { showRegion, showASN, showOrganization };
		const controller = new AbortController(),
			generation = ++run.current;
		setBusy(true);
		setNotice("");
		setResults({});
		setCompleted("");
		const tasks = [
			...requestedSources.map((s) => ({ s, ip: true })),
			...probes.map((s) => ({ s, ip: false })),
		];
		void Promise.all(
			tasks.map(async ({ s, ip }) => {
				try {
					const result = await footerRequest(
						s,
						controller.signal,
						ip ? queryTimeout : 4000,
						ip,
						displaySettings,
					);
					if (!controller.signal.aborted && generation === run.current)
						setResults((old) => ({ ...old, [s.id]: result }));
				} catch {
					/* Hide/unmount cancels this generation without displaying a false error. */
				}
			}),
		).then(() => {
			if (!controller.signal.aborted && generation === run.current) {
				loaded.current = key;
				setBusy(false);
				setCompleted(
					new Date().toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					}),
				);
			}
		});
		return () => controller.abort();
		// signature contains every setting used for IP requests; active/retry own the request lifetime.
	}, [active, signature, retry]);
	async function copy(ip: string) {
		try {
			await navigator.clipboard.writeText(ip);
			setNotice("IP 已复制");
		} catch {
			setNotice("复制失败，请选择 IP 后手动复制");
		}
	}
	const row = (s: Source) => {
		const result = results[s.id];
		return (
			<div className="nz-net-source" key={s.id}>
				<span className="nz-net-provider">{s.name}</span>
				<div className="nz-net-address">
					{result?.ip ? (
						<>
							<strong title={result.ip}>{result.ip}</strong>
							<button
								type="button"
								className="nz-net-icon"
								aria-label={`复制 ${s.name} IP`}
								onClick={() => {
									if (result.ip) void copy(result.ip);
								}}
							>
								<Copy size={14} />
							</button>
						</>
					) : (
						<span className={result?.error ? "nz-net-failure" : "nz-net-muted"}>
							{result?.error || "检测中…"}
						</span>
					)}
				</div>
				{result?.detail && (
					<p className="nz-net-location" title={result.detail}>
						{result.detail}
					</p>
				)}
			</div>
		);
	};
	return (
		<section className={`nz-net-card ${cardSurface}`} aria-label="网络信息">
			<header className="nz-net-header">
				<div className="nz-net-title">
					<Globe2 size={17} />
					<h2>网络信息</h2>
				</div>
				<div className="nz-net-actions">
					<Popover open={expanded} onOpenChange={setExpanded}>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="nz-net-refresh"
								aria-label="查看全部检测来源"
							>
								详情
							</button>
						</PopoverTrigger>
						<PopoverContent
							side="top"
							align="center"
							collisionPadding={12}
							className={`nz-net-details ${cardSurface}`}
							aria-label="全部检测来源"
						>
							<h3>公网 IP · 全部检测来源</h3>
							{sources.map(row)}
							<p className="nz-net-hint">不同检测来源可能经过不同网络出口。</p>
						</PopoverContent>
					</Popover>
					<span className="nz-net-updated">
						{busy ? "检测中…" : completed ? `${completed} 更新` : ""}
					</span>
					<button
						type="button"
						className="nz-net-refresh"
						onClick={() => setRetry((v) => v + 1)}
						disabled={busy}
						aria-label="重新检测网络"
					>
						<RefreshCw size={14} />
						重新检测
					</button>
					<button
						type="button"
						className="nz-net-icon"
						aria-label="收起网络信息"
						onClick={onClose}
					>
						<X size={16} />
					</button>
				</div>
			</header>
			<div className="nz-net-columns">
				<div className="nz-net-ip">
					<h3>
						公网 IP <span>当前浏览器</span>
					</h3>
					{sources[0] && row(sources[0])}
					{notice && (
						<p className="nz-net-notice" role="status">
							{notice}
						</p>
					)}
				</div>
				<div className="nz-net-probes">
					<h3>
						<Radio size={13} />
						网站响应
					</h3>
					<dl>
						{probes.map((s) => (
							<div key={s.id}>
								<dt>{s.name}</dt>
								<dd
									className={
										results[s.id]?.error
											? "nz-net-failure"
											: results[s.id]?.ms !== undefined
												? "nz-net-latency"
												: "nz-net-muted"
									}
								>
									{results[s.id]?.ms !== undefined ? (
										<>
											<strong>{results[s.id].ms}</strong>
											<span>ms</span>
										</>
									) : (
										results[s.id]?.error || "检测中…"
									)}
								</dd>
							</div>
						))}
					</dl>
				</div>
			</div>
		</section>
	);
}
