import { createPortal } from "react-dom";
import "./snapshot-timeline.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Native scrolling keeps touch gestures and keyboard focus usable without
// translating the page or changing the selected snapshot while swiping.
export default function SnapshotTimeline({
	children,
	mobileControls,
	inlineControls = false,
	label = "BGP 历史快照",
}: {
	children: ReactNode;
	mobileControls?: HTMLElement | null;
	inlineControls?: boolean;
	label?: string;
}) {
	const viewport = useRef<HTMLElement>(null);
    const region = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ left: false, right: false });
	// biome-ignore lint/correctness/useExhaustiveDependencies: Snapshot children can change the scroll edges without resizing the viewport.
	useEffect(() => {
		const el = viewport.current;
		const wheelRegion = region.current;
        if (!el || !wheelRegion) return;
		const measure = () => {
			const next = {
				left: el.scrollLeft > 1,
				right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
			};
			setEdges((prev) =>
				prev.left === next.left && prev.right === next.right ? prev : next,
			);
		};
		const wheel = (event: WheelEvent) => {
			if (event.ctrlKey) return; // Preserve browser zoom / trackpad pinch.
            const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (!amount) return;
            // Own wheel input throughout the region, including both ends and the controls.
            // Touch scrolling remains native; only wheel chaining to the page is blocked.
            event.preventDefault();
            event.stopPropagation();
            const delta = amount * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1);
            const max = Math.max(0, el.scrollWidth - el.clientWidth);
            el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta));
		};
		wheelRegion.addEventListener("wheel", wheel, { passive: false });
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		el.addEventListener("scroll", measure, { passive: true });
		measure();
		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", measure);
			wheelRegion.removeEventListener("wheel", wheel);
		};
	}, [children]);
	const scroll = (direction: number) => {
		const el = viewport.current;
		if (el)
			el.scrollBy({
				left: direction * Math.max(160, el.clientWidth * 0.8),
				behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
					? "instant"
					: "smooth",
			});
	};
	const controls = (
		<>
			{" "}
			<button
				type="button"
				aria-label="较新快照"
				disabled={!edges.left}
				onClick={() => scroll(-1)}
				className="flex size-8 shrink-0 items-center justify-center rounded-md border p-1 disabled:opacity-30 sm:size-7"
			>
				<ChevronLeft className="size-4" />
			</button>
			<button
				type="button"
				aria-label="较早快照"
				disabled={!edges.right}
				onClick={() => scroll(1)}
				className="flex size-8 shrink-0 items-center justify-center rounded-md border p-1 disabled:opacity-30 sm:size-7"
			>
				<ChevronRight className="size-4" />
			</button>
		</>
	);
	return (
		<div
            ref={region}
			className={
				"relative min-w-0 max-w-full " +
				(inlineControls ? "flex items-center gap-2" : "mb-2")
			}
			data-snapshot-timeline
		>
			{(edges.left || edges.right) && (
				<>
					<div
						className={
							inlineControls
								? (mobileControls ? "order-2 hidden shrink-0 gap-1 sm:flex" : "order-2 flex shrink-0 flex-col gap-1 sm:flex-row")
								: mobileControls
									? "hidden sm:flex justify-end gap-1 mb-1"
									: "flex justify-end gap-1 mb-1"
						}
					>
						{controls}
					</div>
					{mobileControls &&
						createPortal(
							<div className="flex gap-1" data-mobile-snapshot-controls>
								{controls}
							</div>,
							mobileControls,
						)}
				</>
			)}
			<nav
				ref={viewport}
				aria-label={label}
				className="snapshot-timeline-viewport flex flex-nowrap w-full min-w-0 max-w-full flex-1 gap-2 overflow-x-auto overscroll-x-contain py-1"
			>
				{children}
			</nav>
		</div>
	);
}
