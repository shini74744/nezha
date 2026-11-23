import {
	Children,
	type ReactNode,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useFeature } from "./context";
import { footerPlacement } from "./footer-collision";
import { isBuiltInFooterURL } from "./footer-network";

export function FitFooterRow({ children }: { children: ReactNode }) {
	const ip = useFeature("footerIP"),
		native = ip.enabled && isBuiltInFooterURL(ip.url);
	const container = useRef<HTMLDivElement>(null),
		left = useRef<HTMLDivElement>(null),
		right = useRef<HTMLDivElement>(null);
	const [layout, setLayout] = useState({
		leftOffset: 0,
		rightOffset: 0,
		leftScale: 1,
		rightScale: 1,
		height: 24,
	});
	useLayoutEffect(() => {
		const outer = container.current,
			a = left.current,
			b = right.current;
		if (!outer || !a || !b) return;
		const slot = outer.closest<HTMLElement>("[data-footer-network-slot]");
		let frame = 0,
			panel: HTMLElement | null = null;
		const measure = () => {
			const row = outer.getBoundingClientRect(),
				height = Math.max(a.offsetHeight, b.offsetHeight, 24);
			let placement = footerPlacement(
				row,
				a.offsetWidth,
				b.offsetWidth,
				innerWidth,
			);
			if (native && slot) {
				// Keep both labels in their normal positions before, during and after reveal.
				const bounds = slot.getBoundingClientRect(),
					gap = 8;
				const start =
					row.left +
					placement.leftOffset +
					a.offsetWidth * placement.leftScale +
					gap;
				const end =
					row.right +
					placement.rightOffset -
					b.offsetWidth * placement.rightScale -
					gap;
				// Reserve equal space on both sides so the card stays centered on the page.
				const center = bounds.left + bounds.width / 2;
				const available = Math.max(0, 2 * Math.min(center - start, end - center)),
					inline = available >= 360;
				const width = Math.min(650, inline ? available : bounds.width);
				const x = (bounds.width - width) / 2;
				const y = row.top - bounds.top + (inline ? 0 : height + 6);
				const values = {
					"--nz-network-left": `${Math.max(0, x)}px`,
					"--nz-network-top": `${y}px`,
					"--nz-network-width": `${width}px`,
					"--nz-footer-network-height": `${y + Number(ip.height)}px`,
				};
				for (const [key, value] of Object.entries(values))
					if (slot.style.getPropertyValue(key) !== value)
						slot.style.setProperty(key, value);
				slot.dataset.networkLayout = inline ? "inline" : "stacked";
			} else {
				const current = document.querySelector<HTMLElement>(
					"[data-native-footer-ip]",
				);
				if (current !== panel) {
					if (panel) observer.unobserve(panel);
					panel = current;
					if (panel) observer.observe(panel);
				}
				const rect =
					panel?.dataset.visible === "true"
						? panel.getBoundingClientRect()
						: undefined;
				const box =
					rect && panel
						? {
								left: rect.left,
								right: rect.right,
								top: panel.offsetTop,
								bottom: panel.offsetTop + panel.offsetHeight,
							}
						: undefined;
				placement = footerPlacement(
					row,
					a.offsetWidth,
					b.offsetWidth,
					innerWidth,
					box,
				);
			}
			const next = { ...placement, height };
			setLayout((old) =>
				Object.keys(next).every(
					(k) => old[k as keyof typeof old] === next[k as keyof typeof next],
				)
					? old
					: next,
			);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(outer);
		observer.observe(a);
		observer.observe(b);
		if (slot) observer.observe(slot);
		measure();
		addEventListener("resize", schedule);
		// Only legacy overlays need scroll-driven collision calculations.
		if (!native) {
			addEventListener("scroll", schedule, { passive: true });
			addEventListener("nz-footer-ip-change", schedule);
		}
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			removeEventListener("resize", schedule);
			removeEventListener("scroll", schedule);
			removeEventListener("nz-footer-ip-change", schedule);
		};
	}, [native, ip.height]);
	const items = Children.toArray(children);
	return (
		<div
			className="nz-footer-fit"
			ref={container}
			style={{ height: layout.height }}
		>
			<div
				className="nz-footer-side nz-footer-left"
				ref={left}
				style={{
					transform: `translateX(${layout.leftOffset}px) scale(${layout.leftScale})`,
				}}
			>
				{items[0]}
			</div>
			<div
				className="nz-footer-side nz-footer-right"
				ref={right}
				style={{
					transform: `translateX(${layout.rightOffset}px) scale(${layout.rightScale})`,
				}}
			>
				{items[1]}
			</div>
		</div>
	);
}
