import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import "./connectivity-marquee.css";

// Measure the actual text after fonts/layout settle. Short messages never move.
export default function ConnectivityMarquee({
	children,
	text,
	className,
}: {
	children: ReactNode;
	text: string;
	className?: string;
}) {
	const viewport = useRef<HTMLSpanElement>(null),
		track = useRef<HTMLSpanElement>(null);
	const [distance, setDistance] = useState(0),
		[visible, setVisible] = useState(true);
	useEffect(() => {
		const box = viewport.current,
			content = track.current;
		if (!box || !content || !text) {
			setDistance(0);
			return;
		}
		let active = true;
		const measure = () => {
			if (active)
				setDistance(
					Math.max(0, Math.ceil(content.scrollWidth - box.clientWidth)),
				);
		};
		measure();
		const resize =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(measure)
				: null;
		resize?.observe(box);
		resize?.observe(content);
		window.addEventListener("resize", measure);
		void document.fonts?.ready.then(measure);
		return () => {
			active = false;
			resize?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [text]);
	useEffect(() => {
		const box = viewport.current;
		if (!box || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver((entries) =>
			setVisible(entries[0]?.isIntersecting ?? true),
		);
		observer.observe(box);
		return () => observer.disconnect();
	}, []);
	const overflowing = distance > 1;
	return (
		<span
			ref={viewport}
			className={`nz-connectivity-marquee ${className || ""}`}
			data-connectivity-status
			data-overflow={overflowing}
			data-visible={visible}
			title={text}
			tabIndex={overflowing ? 0 : undefined}
			style={
				{
					"--nz-pan-end": `-${distance}px`,
					"--nz-pan-duration": `${Math.max(6, (2 * distance) / 22 + 3)}s`,
				} as CSSProperties
			}
		>
			<span ref={track} className="nz-connectivity-marquee-track">
				{children}
			</span>
		</span>
	);
}
