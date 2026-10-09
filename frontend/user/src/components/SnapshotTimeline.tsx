import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Native scrolling keeps touch gestures and keyboard focus usable without
// translating the page or changing the selected snapshot while swiping.
export default function SnapshotTimeline({
	children,
	mobileControls,
	label = "BGP 历史快照",
}: {
	children: ReactNode;
	mobileControls?: HTMLElement | null;
	label?: string;
}) {
	const viewport = useRef<HTMLElement>(null);
	const [edges, setEdges] = useState({ left: false, right: false });
	// biome-ignore lint/correctness/useExhaustiveDependencies: Snapshot children can change the scroll edges without resizing the viewport.
	useEffect(() => {
		const el = viewport.current;
		if (!el) return;
		const measure = () => {
			const next = {
				left: el.scrollLeft > 1,
				right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
			};
			setEdges((prev) =>
				prev.left === next.left && prev.right === next.right ? prev : next,
			);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		el.addEventListener("scroll", measure, { passive: true });
		measure();
		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", measure);
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
				className="rounded-md border p-1 disabled:opacity-30"
			>
				<ChevronLeft className="size-4" />
			</button>
			<button
				type="button"
				aria-label="较早快照"
				disabled={!edges.right}
				onClick={() => scroll(1)}
				className="rounded-md border p-1 disabled:opacity-30"
			>
				<ChevronRight className="size-4" />
			</button>
		</>
	);
	return (
		<div className="relative min-w-0 max-w-full mb-2" data-snapshot-timeline>
			{(edges.left || edges.right) && (
				<>
					<div
						className={
							mobileControls
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
				className="flex flex-nowrap w-full min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]"
			>
				{children}
			</nav>
		</div>
	);
}
