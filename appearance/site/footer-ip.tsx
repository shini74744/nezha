import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { useAppearanceLayout, useFeature } from "./context";
import { FooterNetworkCard, isBuiltInFooterURL } from "./footer-network";
import { isTouchDevice } from "./native-hooks";
export function NativeFooterIP() {
	const f = useFeature("footerIP"),
		[visible, setVisible] = useState(false),
		[dismissed, setDismissed] = useState(false);
	const { connected, lastData } = useWebSocketContext();
	const mobile = isTouchDevice(),
		native = isBuiltInFooterURL(f.url);
	const ready = connected && lastData !== null,
		allowed = !mobile;
	const shown = f.enabled && allowed && ready && visible && !dismissed;
	const layout = useAppearanceLayout();
	const footer = useFeature("footer");
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const slot = layout.footer.current;
		setHost(
			native &&
				allowed &&
				footer.enabled &&
				f.enabled &&
				slot?.hasAttribute("data-footer-network-slot")
				? slot
				: null,
		);
	}, [native, allowed, footer.enabled, f.enabled, layout.footer]);
	useLayoutEffect(() => {
		const panel = panelRef.current;
		if (!native || !host || !panel) return;
		const measure = () => {
			const height = panel.offsetHeight;
			if (height > 0) host.style.setProperty("--nz-measured-network-height", `${height}px`);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(panel);
		measure();
		return () => {
			observer.disconnect();
			host.style.removeProperty("--nz-measured-network-height");
		};
	}, [native, host]);

	useEffect(() => {
		setVisible(false);
		setDismissed(false);
		if (!f.enabled || !allowed || !ready) return;
		let timer = 0;
		let previouslyAtBottom: boolean | undefined;
		const atBottom = () =>
			innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
		const update = () => {
			const bottom = atBottom();
			if (bottom === previouslyAtBottom) return;
			previouslyAtBottom = bottom;
			clearTimeout(timer);
			if (bottom) {
				timer = window.setTimeout(() => {
					previouslyAtBottom = atBottom();
					setVisible(previouslyAtBottom);
				}, native ? 120 : 300);
			} else {
				setVisible(false);
				setDismissed(false);
			}
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
	}, [f.enabled, allowed, ready, native]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Notify the copyright placement when overlay visibility or height changes.
	useEffect(() => {
		const notify = () => dispatchEvent(new Event("nz-footer-ip-change"));
		notify();
		return () => {
			requestAnimationFrame(notify);
		};
	}, [shown, f.height]);
	if (!f.enabled || !allowed) return null;
	const panel = (
		<div
			ref={panelRef}
			data-native-footer-ip
			data-visible={shown ? "true" : "false"}
			className={`nz-footer-ip${native ? " nz-footer-network" : ""}${host ? " nz-footer-in-flow" : ""}`}
			inert={!shown}
			aria-hidden={!shown}
			style={{
				display: !allowed ? "none" : undefined,
				transform: host
					? "none"
					: native ? "translateX(-50%)" : `translateX(-50%) translateY(${shown ? 0 : 20}px)`,
				opacity: shown ? 1 : 0,
				pointerEvents: shown ? "auto" : "none",
				height: native ? undefined : f.height,
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
	return host ? createPortal(panel, host) : panel;
}
