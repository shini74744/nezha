import {
	useEffect,
	useMemo,
	useState,
	type ReactNode,
	type CSSProperties,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "./context";
import { formatBytes } from "@/lib/format";
import {greetingMessages, chooseGreeting} from "./greeting-clock";
import "./rate.css";
export function useTick(period = 1000) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (period <= 0) return;
		const id = setInterval(() => setNow(Date.now()), period);
		return () => clearInterval(id);
	}, [period]);
	return now;
}
export function NativeDescription({ fallback }: { fallback: ReactNode }) {
	const runtime = useFeature("runtime"),
		brand = useFeature("branding"),
		now = useTick();
	if (runtime.enabled) {
		const delta = Math.max(
			0,
			Math.floor((now - Date.parse(runtime.startDate)) / 1000),
		);
		return (
			<>
				{runtime.prefix}
				{Math.floor(delta / 86400)}天{Math.floor(delta / 3600) % 24}小时
				{Math.floor(delta / 60) % 60}分{delta % 60}秒
			</>
		);
	}
	return <>{brand.enabled ? brand.description : fallback}</>;
}
export function NativeGreeting({ fallback }: { fallback: ReactNode }) {
	const f = useFeature("greeting");
	const now = useTick(f.enabled ? 1000 : 0);
	// Depend on the active texts, not each tick; do not reroll every second.
	const messagesKey = JSON.stringify(greetingMessages(f.rules, new Date(now)));
	const [selection, setSelection] = useState({ key: "", text: "" });
	useEffect(() => {
		if (!f.enabled) return;
		let last = "";
		try { last = localStorage.getItem("lastGreeting") || ""; } catch {}
		const next = chooseGreeting(JSON.parse(messagesKey), last);
		setSelection({ key: messagesKey, text: next });
		if (next) {
			try { localStorage.setItem("lastGreeting", next); } catch {}
		}
	}, [messagesKey, f.enabled]);
	return <>{f.enabled && selection.key === messagesKey && selection.text ? selection.text : fallback}</>;
}
const namePhase = [Math.random(), Math.random()];
export function NativeName({
	children,
	online,
	detail = false,
}: {
	children: ReactNode;
	online: boolean;
	detail?: boolean;
}) {
	const f = useFeature("nameColor"),
		enabled = f.enabled && (detail ? f.detail : f.list),
		now = useTick(enabled && online ? 1000 : 0);
	const hue =
		30 + (((now % 300000) / 300000 + namePhase[detail ? 1 : 0]) % 1) * 300;
	return (
		<span
			className={
				enabled ? (online ? "nz-name-online" : "nz-name-offline") : undefined
			}
			style={
				enabled && online
					? { color: "hsl(" + hue.toFixed(0) + ",80%,60%)" }
					: undefined
			}
		>
			{children}
		</span>
	);
}
export function formatSpeed(bytes: number, bits: boolean, overview = false) {
	const n = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
	if (!bits) return formatBytes(n) + "/s";
	const mbps = (n * 8) / 1048576,
		threshold = overview ? 1024 : 1000;
	if (mbps <= 0) return "0Mbps";
	return mbps >= threshold
		? (mbps / threshold).toFixed(2) + "Gbps"
		: mbps >= 100
			? mbps.toFixed(0) + "Mbps"
			: mbps >= 10
				? mbps.toFixed(1) + "Mbps"
				: mbps.toFixed(2) + "Mbps";
}
export function NativeSpeed({
	bytes,
	direction,
	fallback,
	overview = false,
}: {
	bytes: number;
	direction: "up" | "down";
	fallback?: ReactNode;
	overview?: boolean;
}) {
	const shared = useFeature("speed");
 const f = overview ? {enabled:shared.enabled && shared.overviewEnabled,bits:shared.overviewBits,color:shared.overviewColor,animation:shared.overviewAnimation}
  : {...shared,enabled:shared.enabled && shared.cardEnabled};
	if (!f.enabled) return <>{fallback ?? formatSpeed(bytes, false)}</>;
	const strength = overview
			? Math.min(Math.pow(Math.max(0, bytes) / 104857600, 0.4), 1)
			: Math.min(Math.log10(Math.max(0, bytes) + 1) / Math.log10(31457281), 1),
		p = Math.round((1 - strength) * (overview ? 200 : 255));
	const color =
		direction === "up"
			? "rgb(255," + p + "," + p + ")"
			: "rgb(" + p + "," + p + ",255)";
	const level = overview
		? bytes > 104857600
			? 5
			: bytes > 62914560
				? 4
				: bytes > 41943040
					? 3
					: bytes > 20971520
						? 2
						: bytes > 0
							? 1
							: 0
		: bytes > 31457280
			? 3
			: bytes > 20971520
				? 2
				: bytes > 10485760
					? 1
					: 0;
	const effect = overview
		? "nz-overview-speed-" + level + (direction === "down" ? "-dl" : "")
		: "nz-" + (direction === "up" ? "upload" : "download") + "-boost-" + level;
	return (
		<span
			data-native-speed={direction}
			data-color={f.color}
			className={f.animation && level > 0 ? "nz-speed " + effect : undefined}
			style={f.color ? { color } : undefined}
		>
			{formatSpeed(bytes, f.bits, overview)}
		</span>
	);
}
type Traffic = {
	name: string;
	max: number;
	from: string;
	to: string;
	transfer: Record<string, number>;
	next_update: Record<string, string>;
};
export function NativeTraffic({ serverId }: { serverId: number }) {
	const f = useFeature("traffic"),
		now = useTick(Math.max(1000, f.toggleInterval));
	const { data } = useQuery({
		queryKey: ["native-traffic"],
		enabled: f.enabled,
		queryFn: async () => {
			const r = await fetch("/api/v1/service");
			if (!r.ok) throw Error("Traffic unavailable");
			const body = await r.json();
			return (body.success ? body.data.cycle_transfer_stats : {}) as Record<
				string,
				Traffic
			>;
		},
		refetchInterval: 60000,
		retry: 1,
	});
	if (!f.enabled || !data) return null;
	const matches = Object.entries(data).filter(
		([, s]) =>
			s.max > 0 &&
			s.transfer &&
			Object.prototype.hasOwnProperty.call(s.transfer, String(serverId)),
	);
	return (
		<>
			{matches.map(([id, s]) => {
				const used = s.transfer[String(serverId)],
					percent = (used / s.max) * 100,
					color =
						"hsl(" +
						(120 - Math.min(100, Math.max(0, percent)) * 1.2) +
						",65%,45%)",
					phase = Math.floor(now / f.toggleInterval) % 3;
				return (
					<div
						data-native-traffic={serverId}
						key={id}
						className="w-full min-w-0 space-y-1 text-[10px]"
						title={
							s.name +
							"；下次统计：" +
							new Date(s.next_update?.[String(serverId)]).toLocaleString(
								"zh-CN",
								{ hour12: false },
							)
						}
					>
						<div className="flex justify-between gap-2">
							<span style={{ color }}>
								{formatBytes(used)} / {formatBytes(s.max)}
							</span>
							<span>
								{phase === 0
									? new Date(s.from).toLocaleDateString() +
										" - " +
										new Date(s.to).toLocaleDateString()
									: phase === 1
										? "本月流量统计"
										: percent.toFixed(2) + "%"}
							</span>
						</div>
						<div
							className="h-1.5 rounded-full bg-muted"
							role="progressbar"
							aria-label={s.name}
							aria-valuenow={Math.min(100, percent)}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<div
								className="h-full rounded-full transition-all"
								style={{
									width: Math.min(100, Math.max(0, percent)) + "%",
									backgroundColor: color,
								}}
							/>
						</div>
					</div>
				);
			})}
		</>
	);
}
export function NativeFooter() {
	const f = useFeature("footer"),
		tick = useTick(f.enabled ? 6000 : 0);
	const letters = useMemo(
		() =>
			Array.from(String(f.text)).map((c) => ({
				c,
				color:
					"#" +
					Math.floor(Math.random() * 16777215)
						.toString(16)
						.padStart(6, "0"),
			})),
		[f.text, tick],
	);
	useEffect(() => {
		if (!f.enabled) return;
		const links = ["fontawesome", "solid", "brands"].map((name) => {
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = "/appearance/fontawesome/css/" + name + ".min.css";
			link.dataset.nezhaAppearance = "footer";
			document.head.append(link);
			return link;
		});
		return () => links.forEach((link) => link.remove());
	}, [f.enabled]);
	return (
		<footer className="mx-auto w-full max-w-5xl px-4 pb-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
			<a
				href={f.url}
				target="_blank"
				rel="noopener noreferrer"
				className="nz-brand-footer"
			>
				<i aria-hidden="true" className="fas fa-server" />
				{letters.map(({ c, color }, i) => (
					<span
						key={tick + "-" + i}
						style={{ "--letter": i, "--target-color": color } as CSSProperties}
					>
						{c}
					</span>
				))}
			</a>
			<a
				href={f.poweredUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="nz-powered"
			>
				<i aria-hidden="true" className="fab fa-github" /> {f.poweredText}
			</a>
		</footer>
	);
}
export function NativeFooterIP() {
	const f = useFeature("footerIP"),
		[visible, setVisible] = useState(false);
	useEffect(() => {
		if (!f.enabled) return;
		let timer = 0,
			last = window.scrollY;
		const update = () => {
			clearTimeout(timer);
			const down = window.scrollY >= last;
			last = window.scrollY;
			if (
				down &&
				innerWidth > 768 &&
				innerHeight + scrollY >= document.documentElement.scrollHeight - 2
			)
				timer = window.setTimeout(() => setVisible(true), 300);
			else setVisible(false);
		};
		addEventListener("scroll", update, { passive: true });
		return () => {
			clearTimeout(timer);
			removeEventListener("scroll", update);
		};
	}, [f.enabled]);
	if (!f.enabled) return null;
	return (
		<div
			data-native-footer-ip
			className="nz-footer-ip"
			style={{
				opacity: visible ? 1 : 0,
				pointerEvents: visible ? "auto" : "none",
				height: f.height,
			}}
		>
			<iframe
				title="IP 详细信息"
				src={f.url}
				loading="lazy"
				sandbox="allow-scripts allow-same-origin"
				referrerPolicy="no-referrer"
				className="h-full w-full rounded-lg border-0"
			/>
		</div>
	);
}
