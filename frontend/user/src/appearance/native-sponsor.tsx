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
		capsule = useRef<HTMLElement>(null);
	const [compact, setCompact] = useState(false),
		[phase, setPhase] = useState<"shrinking" | "staying" | "fading" | "hidden">(
			"shrinking",
		);
	const [hovered, setHovered] = useState(false),
		[fit, setFit] = useState({ scale: 1, visible: false });
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
			node = capsule.current;
		if (!host || !node) return;
		const update = () => {
			const width = host.clientWidth,
				scale = Math.min(
					1,
					Math.max(0, width - 24) / Math.max(1, node.offsetWidth),
					65 / Math.max(1, node.offsetHeight),
				);
			setFit((previous) =>
				previous.scale === scale && previous.visible === width >= 80
					? previous
					: { scale, visible: width >= 80 },
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(host);
		observer.observe(node);
		update();
		return () => observer.disconnect();
	}, []);
	return (
		<div ref={slot} className="nz-sponsor-slot" data-native-sponsor-slot>
			<section
				ref={capsule}
				id="bmWrap"
				aria-label="赞助商"
				aria-hidden={!fit.visible || phase === "hidden"}
				inert={!fit.visible || phase === "hidden" || phase === "fading"}
				className={
					"bm-wrap nz-native-sponsor" +
					(compact ? " bm-compact" : "") +
					(phase === "fading" || phase === "hidden" ? " bm-pc-hidden" : "")
				}
				style={
					{
						"--bm-fit": fit.scale,
						"--bm-shrink-duration": `${Math.max(0, f.shrinkDuration)}ms`,
						"--bm-fade-duration": `${Math.max(0, f.fadeDuration)}ms`,
						visibility: fit.visible ? "visible" : "hidden",
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
				<SponsorContent f={f} compact={compact} />
			</section>
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