import { useEffect, useLayoutEffect, useState } from "react";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { useAppearanceLayout, useFeature } from "./context";
import { FooterNetworkCard, isBuiltInFooterURL } from "./footer-network";
export function NativeFooterIP() {
	const f = useFeature("footerIP"),
		[visible, setVisible] = useState(false),
		[dismissed, setDismissed] = useState(false);
	const { connected, lastData } = useWebSocketContext();
	const mobile = /Mobi|Android/i.test(navigator.userAgent),
		native = isBuiltInFooterURL(f.url);
	const ready = connected && lastData !== null,
		allowed = native || !mobile;
	const shown = f.enabled && allowed && ready && visible && !dismissed;
	const layout = useAppearanceLayout();
	const footer = useFeature("footer");
	const [anchorTop, setAnchorTop] = useState<number | null>(null);
	useLayoutEffect(() => {
		const slot = layout.footer.current;
		if (
			!native ||
			!footer.enabled ||
			!f.enabled ||
			!slot?.hasAttribute("data-footer-network-slot")
		) {
			setAnchorTop(null);
			return;
		}
		let frame = 0;
		const measure = () => {
			const textRow =
				parseFloat(
					getComputedStyle(slot).getPropertyValue("--nz-footer-text-row"),
				) || 0;
			setAnchorTop(slot.getBoundingClientRect().top + textRow);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(slot);
		addEventListener("scroll", schedule, { passive: true });
		addEventListener("resize", schedule);
		measure();
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			removeEventListener("scroll", schedule);
			removeEventListener("resize", schedule);
		};
	}, [native, f.enabled, footer.enabled, layout.footer]);
	useEffect(() => {
		setVisible(false);
		setDismissed(false);
		if (!f.enabled || !allowed || !ready) return;
		let timer = 0,
			last = window.scrollY;
		const atBottom = () =>
			innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
		const update = () => {
			clearTimeout(timer);
			const down = window.scrollY >= last;
			last = window.scrollY;
			if (!atBottom()) setDismissed(false);
			if (down && atBottom())
				timer = window.setTimeout(() => setVisible(atBottom()), 300);
			else setVisible(false);
		};
		const observer = new ResizeObserver(update);
		observer.observe(document.documentElement);
		observer.observe(document.body);
		addEventListener("scroll", update, { passive: true });
		addEventListener("resize", update);
		update();
		return () => {
			clearTimeout(timer);
			observer.disconnect();
			removeEventListener("scroll", update);
			removeEventListener("resize", update);
		};
	}, [f.enabled, allowed, ready]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Notify the copyright placement when overlay visibility or height changes.
	useEffect(() => {
		const notify = () => dispatchEvent(new Event("nz-footer-ip-change"));
		notify();
		return () => {
			requestAnimationFrame(notify);
		};
	}, [shown, f.height, anchorTop]);
	if (!f.enabled) return null;
	return (
		<div
			data-native-footer-ip
			data-visible={shown ? "true" : "false"}
			className={`nz-footer-ip${native ? " nz-footer-network" : ""}`}
			inert={!shown}
			aria-hidden={!shown}
			style={{
				display: !allowed ? "none" : undefined,
				top: native && anchorTop !== null ? anchorTop : undefined,
				bottom: native && anchorTop !== null ? "auto" : undefined,
				transform: `translateX(-50%) translateY(${shown ? 0 : 20}px)`,
				opacity: shown ? 1 : 0,
				pointerEvents: shown ? "auto" : "none",
				height: f.height,
			}}
		>
			{native ? (
				<FooterNetworkCard active={shown} onClose={() => setDismissed(true)} />
			) : (
				shown && (
					<iframe
						title="IP 详细信息"
						src={f.url}
						loading="lazy"
						sandbox="allow-scripts allow-same-origin"
						referrerPolicy="no-referrer"
						className="h-full w-full rounded-lg border-0"
					/>
				)
			)}
		</div>
	);
}
