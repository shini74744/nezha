import {
	Children,
	type ReactNode,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { footerPlacement } from "./footer-collision";

export function FitFooterRow({ children }: { children: ReactNode }) {
	const container = useRef<HTMLDivElement>(null),
		left = useRef<HTMLDivElement>(null),
		right = useRef<HTMLDivElement>(null);
	const [layout, setLayout] = useState({
		leftOffset: 0,
		rightOffset: 0,
		leftScale: 1,
		rightScale: 1,
		leftY: 0,
		rightY: 0,
		height: 24,
		alignment: "normal",
	});
	useLayoutEffect(() => {
		const outer = container.current,
			a = left.current,
			b = right.current;
		if (!outer || !a || !b) return;
		let panel: HTMLElement | null = null,
			frame = 0;
		const measure = () => {
			const current = document.querySelector<HTMLElement>(
				"[data-native-footer-ip]",
			);
			if (current !== panel) {
				if (panel) observer.unobserve(panel);
				panel = current;
				if (panel) observer.observe(panel);
			}
			const nativeCard = panel?.classList.contains("nz-footer-network");
			const rect =
				panel && (nativeCard || panel.dataset.visible === "true")
					? panel.getBoundingClientRect()
					: undefined;
			const header = panel?.querySelector<HTMLElement>(".nz-net-header");
			// Reserve the final fixed position before the slide-in animation finishes.
			const box =
				rect && panel
					? {
							left: rect.left,
							right: rect.right,
							top: panel.offsetTop,
							bottom: panel.offsetTop + panel.offsetHeight,
						}
					: undefined;
			const row = outer.getBoundingClientRect(),
				height = Math.max(a.offsetHeight, b.offsetHeight, 24);
			const next = {
				...footerPlacement(row, a.offsetWidth, b.offsetWidth, innerWidth, box),
				leftY: 0,
				rightY: 0,
				height,
				alignment: "normal",
			};
			if (box && rect && header) {
				const gap = 8;
				const leftEdge = Math.max(
					4,
					Math.min(row.left, box.left - gap - a.offsetWidth),
				);
				const rightEdge = Math.min(
					innerWidth - 4,
					Math.max(row.right, box.right + gap + b.offsetWidth),
				);
				const leftScale = Math.min(
					1,
					Math.max(0, box.left - leftEdge - gap) / Math.max(1, a.offsetWidth),
				);
				const rightScale = Math.min(
					1,
					Math.max(0, rightEdge - box.right - gap) / Math.max(1, b.offsetWidth),
				);
				let center: number;
				if (Math.min(leftScale, rightScale) >= 0.7) {
					const heading = header.getBoundingClientRect();
					center = box.top + heading.top - rect.top + heading.height / 2;
					Object.assign(next, {
						leftOffset: leftEdge - row.left,
						rightOffset: rightEdge - row.right,
						leftScale,
						rightScale,
						alignment: "beside",
					});
				} else {
					// Narrow screens keep readable footer text just above the card.
					center = box.top - gap - height / 2;
					Object.assign(
						next,
						footerPlacement(row, a.offsetWidth, b.offsetWidth, innerWidth),
						{ alignment: "above" },
					);
				}
				// Reserve the narrow footer text row even while hidden, so showing the
				// card does not move the scroll boundary or cover the preceding content.
				const slot = outer.closest<HTMLElement>("[data-footer-network-slot]");
				const reserve = next.alignment === "above" ? height + gap : 0;
				if (
					slot &&
					slot.style.getPropertyValue("--nz-footer-text-row") !== `${reserve}px`
				)
					slot.style.setProperty("--nz-footer-text-row", `${reserve}px`);
				if (panel?.dataset.visible === "true") {
					next.leftY = center - row.top - a.offsetHeight / 2;
					next.rightY = center - row.top - b.offsetHeight / 2;
				} else {
					Object.assign(
						next,
						footerPlacement(row, a.offsetWidth, b.offsetWidth, innerWidth),
						{ alignment: "normal" },
					);
				}
			}
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
		measure();
		addEventListener("scroll", schedule, { passive: true });
		addEventListener("resize", schedule);
		addEventListener("nz-footer-ip-change", measure);
		window.visualViewport?.addEventListener("resize", schedule);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			removeEventListener("scroll", schedule);
			removeEventListener("resize", schedule);
			removeEventListener("nz-footer-ip-change", measure);
			window.visualViewport?.removeEventListener("resize", schedule);
		};
	}, []);
	const items = Children.toArray(children);
	return (
		<div
			className="nz-footer-fit"
			data-network-alignment={layout.alignment}
			ref={container}
			style={{ height: layout.height }}
		>
			<div
				className="nz-footer-side nz-footer-left"
				ref={left}
				style={{
					transform: `translate(${layout.leftOffset}px, ${layout.leftY}px) scale(${layout.leftScale})`,
				}}
			>
				{items[0]}
			</div>
			<div
				className="nz-footer-side nz-footer-right"
				ref={right}
				style={{
					transform: `translate(${layout.rightOffset}px, ${layout.rightY}px) scale(${layout.rightScale})`,
				}}
			>
				{items[1]}
			</div>
		</div>
	);
}
