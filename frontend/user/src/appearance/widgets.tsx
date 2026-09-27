import {
	useEffect,
	useMemo,
	useState,
	type ReactNode,
	type CSSProperties,
} from "react";
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
	const [offlineAlpha, setOfflineAlpha] = useState("0.60");
	useEffect(() => {
		setOfflineAlpha("0.60");
		if (!enabled || online) return;
		let phase = 0, direction = 1;
		const timer = window.setInterval(() => {
			phase += direction * 0.05;
			if (phase >= 1) { phase = 1; direction = -1; }
			else if (phase <= 0) { phase = 0; direction = 1; }
			setOfflineAlpha((0.4 + phase * 0.4).toFixed(2));
		}, 100);
		return () => window.clearInterval(timer);
	}, [enabled, online]);
	const hue =
		30 + (((now % 300000) / 300000 + namePhase[detail ? 1 : 0]) % 1) * 300;
	return (
		<span
			className={
				enabled ? (online ? "nz-name-online" : "nz-name-offline") : undefined
			}
			style={
				enabled
					? { color: online ? "hsl(" + hue.toFixed(0) + ",80%,60%)" : "rgba(255, 0, 0, " + offlineAlpha + ")" }
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
	icon,
	overview = false,
}: {
	bytes: number;
	direction: "up" | "down";
	fallback?: ReactNode;
	icon?: ReactNode;
	overview?: boolean;
}) {
	const shared = useFeature("speed");
 const f = overview ? {enabled:shared.enabled && shared.overviewEnabled,bits:shared.overviewBits,color:shared.overviewColor,animation:shared.overviewAnimation}
  : {...shared,enabled:shared.enabled && shared.cardEnabled};
	if (!f.enabled || (!f.bits && !f.color && !f.animation)) return <>{icon}{fallback ?? formatSpeed(bytes, false)}</>;
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
			className={[
        overview && (f.bits || f.color || f.animation) ? "nz-overview-rate" : "",
        f.animation && level > 0 ? (overview ? "" : "nz-speed nz-card-rate ") + effect : "",
      ].filter(Boolean).join(" ") || undefined}
			style={f.color ? { color } : undefined}
		>
			{icon}<span className={overview ? "nz-rate-value" : undefined}>{formatSpeed(bytes, f.bits, overview)}</span>
		</span>
	);
}
export { NativeTraffic } from "./traffic";
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
	// Match the original device guard, including narrow desktop windows.
	const mobile = /Mobi|Android/i.test(navigator.userAgent);
	useEffect(() => {
		setVisible(false);
		if (!f.enabled || mobile) return;
		let timer = 0,
			last = window.scrollY;
		const update = () => {
			clearTimeout(timer);
			const down = window.scrollY >= last;
			last = window.scrollY;
			if (
				down &&
				innerHeight + scrollY >= document.documentElement.scrollHeight - 2
			)
				timer = window.setTimeout(() => {
					if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2)
						setVisible(true);
				}, 300);
			else setVisible(false);
		};
		addEventListener("scroll", update, { passive: true });
		return () => {
			clearTimeout(timer);
			removeEventListener("scroll", update);
		};
	}, [f.enabled, mobile]);
	if (!f.enabled) return null;
	return (
		<div
			data-native-footer-ip
			className="nz-footer-ip"
			style={{
				display: mobile ? "none" : undefined,
				transform: "translateX(-50%) translateY(" + (visible ? 0 : 20) + "px)",
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
