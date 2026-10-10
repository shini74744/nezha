import {
	type CSSProperties,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useLocation } from "react-router-dom";
import type { Feature } from "./config";
import { useFeature } from "./context";
import { useMedia } from "./native-hooks";

function SponsorContent({
	f,
	compact,
	mobile = false,
}: {
	f: Feature;
	compact: boolean;
	mobile?: boolean;
}) {
	return (
		<div className={`bottom-marquee${compact ? " bm-compact-content" : ""}`}>
			<div className="bm-track">
				<span className="bm-item">{f.startText || "感谢"}</span>
				{(f.sponsors as { name: string; url: string; logo: string }[]).map(
					(item, i) => (
						<a
							key={i}
							className="bm-item"
							href={item.url}
							target="_blank"
							rel="noopener noreferrer"
						>
							<img
								className="bm-logo"
								src={item.logo}
								alt={`${item.name || "赞助商"} Logo`}
								referrerPolicy="no-referrer"
								loading={mobile ? "lazy" : "eager"}
							/>
						</a>
					),
				)}
				<span className="bm-item">{f.endText || "的赞助支持！"}</span>
			</div>
		</div>
	);
}
function DesktopCapsule({ f }: { f: Feature }) {
	const slot = useRef<HTMLDivElement>(null),
		fit = useRef<HTMLDivElement>(null),
		capsule = useRef<HTMLElement>(null);
	const [compact, setCompact] = useState(false),
		[phase, setPhase] = useState<"shrinking" | "staying" | "fading" | "hidden">(
			"shrinking",
		);
	const [hovered, setHovered] = useState(false),
		[fitVisible, setFitVisible] = useState(false);
	const remaining = useRef(Math.max(0, f.stayDuration));
	useEffect(() => {
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => setCompact(true));
		});
		const timer = setTimeout(
			() => setPhase("staying"),
			Math.max(0, f.shrinkDuration),
		);
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
			clearTimeout(timer);
		};
	}, [f.shrinkDuration]);
	useEffect(() => {
		if (phase !== "staying" || (f.pauseOnHover && hovered)) return;
		const started = performance.now(),
			timer = setTimeout(() => setPhase("fading"), remaining.current);
		return () => {
			clearTimeout(timer);
			remaining.current = Math.max(
				0,
				remaining.current - (performance.now() - started),
			);
		};
	}, [phase, hovered, f.pauseOnHover]);
	useEffect(() => {
		if (phase !== "fading") return;
		const timer = setTimeout(
			() => setPhase("hidden"),
			Math.max(0, f.fadeDuration),
		);
		return () => clearTimeout(timer);
	}, [phase, f.fadeDuration]);
	useLayoutEffect(() => {
		const host = slot.current,
			frame = fit.current,
			node = capsule.current;
		if (!host || !frame || !node) return;
		const update = () => {
			const width = host.clientWidth;
			// Measure the fixed compact layout, never the animated rectangle.
			// The outer frame fits the largest pose before paint; the inner
			// transform only gets smaller and cannot feed back into this observer.
			const start = Math.min(
				62 / 42,
				Math.max(0, width - 24) / Math.max(1, node.offsetWidth),
				65 / Math.max(1, node.offsetHeight),
			);
			// Preserve the normal compact size when it fits. In tight slots keep
			// a small visible shrink instead of cancelling the entire animation.
			const end = Math.min(1, start / 1.12);
			frame.style.setProperty("--bm-fit", String(start));
			frame.style.setProperty("--bm-motion-end", String(start > 0 ? end / start : 1));
			setFitVisible(width >= 80);
		};
		const observer = new ResizeObserver(update);
		observer.observe(host);
		observer.observe(node);
		// Image intrinsic sizes are available in the load handler, before paint.
		node.addEventListener("load", update, true);
		node.addEventListener("error", update, true);
		update();
		return () => {
			observer.disconnect();
			node.removeEventListener("load", update, true);
			node.removeEventListener("error", update, true);
		};
	}, []);
	return (
		<div ref={slot} className="nz-sponsor-slot" data-native-sponsor-slot>
			<div ref={fit} className="nz-sponsor-fit">
			<section
				ref={capsule}
				id="bmWrap"
				aria-label="赞助商"
				aria-hidden={!fitVisible || phase === "hidden"}
				inert={!fitVisible || phase === "hidden" || phase === "fading"}
				className={
					"bm-wrap nz-native-sponsor" +
					(compact ? " bm-compact" : "") +
					(phase === "fading" || phase === "hidden" ? " bm-pc-hidden" : "")
				}
				style={
					{
						"--bm-shrink-duration": `${Math.max(0, f.shrinkDuration)}ms`,
						"--bm-fade-duration": `${Math.max(0, f.fadeDuration)}ms`,
						visibility: fitVisible ? "visible" : "hidden",
						display: phase === "hidden" ? "none" : undefined,
					} as CSSProperties
				}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				onFocusCapture={() => setHovered(true)}
				onBlurCapture={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node))
						setHovered(false);
				}}
			>
				<SponsorContent f={f} compact />
			</section>
			</div>
		</div>
	);
}
export function NativeDesktopSponsor({
	detail = false,
}: {
	detail?: boolean;
} = {}) {
	const f = useFeature("sponsor"),
		desktop = useMedia("(min-width:641px)"),
		{ pathname } = useLocation();
	const target = detail ? pathname !== "/" && !f.homeOnly : pathname === "/";
	if (!f.enabled || !f.desktop || !desktop || !target) return null;
	const content = <DesktopCapsule key={pathname + JSON.stringify(f)} f={f} />;
	return detail ? <div className="nz-sponsor-detail">{content}</div> : content;
}
export function NativeMobileSponsor() {
	const f = useFeature("sponsor"),
		mobile = useMedia("(max-width:640px)");
	const root=useRef<HTMLElement>(null), [visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!f.enabled||!f.mobile||!mobile||!root.current)return;
  const footer=root.current.closest("[data-footer-region]")||root.current.parentElement!;
  let frame=0,shown=false;
  const update=()=>{
   frame=0;const viewport=window.visualViewport;
   const edge=footer.getBoundingClientRect().bottom,bottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight);
   const next=edge<=bottom+Math.max(2,Number(f.mobileBottomThreshold)||0)+(shown?24:0);
   shown=next;setVisible(next);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update)};
  const resize=new ResizeObserver(schedule);resize.observe(footer);
  window.addEventListener("scroll",schedule,{passive:true});window.addEventListener("resize",schedule);
  window.visualViewport?.addEventListener("resize",schedule);window.visualViewport?.addEventListener("scroll",schedule);
  schedule();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);window.visualViewport?.removeEventListener("resize",schedule);window.visualViewport?.removeEventListener("scroll",schedule)};
 },[f.enabled,f.mobile,f.mobileBottomThreshold,mobile]);
 if (!f.enabled || !f.mobile || !mobile) return null;
 return (
		<section
			id="bmWrap"
			ref={root}
            className={"bm-wrap nz-native-sponsor nz-mobile-sponsor"+(visible?" bm-mobile-visible":"")}
            aria-hidden={!visible} inert={!visible}
            style={{"--bm-fade-duration": Math.max(0,f.fadeDuration)+"ms"} as CSSProperties}
			aria-label="赞助商"
		>
			<SponsorContent f={f} compact mobile />
		</section>
	);
}