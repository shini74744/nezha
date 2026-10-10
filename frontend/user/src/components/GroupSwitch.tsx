import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useActiveIndicator } from "@/hooks/use-active-indicator";
import { cn } from "@/lib/utils";
import {
	DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
	DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "./ui/dropdown-menu";
import "./GroupSwitch.css";

const buttonClass = "relative shrink-0 flex h-[30px] min-w-[44px] cursor-pointer items-center justify-center rounded-full px-[9px] py-0 text-[13px] leading-[18px] font-medium transition-colors duration-200 hover:text-stone-950 dark:hover:text-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500";
const menuItemClass = "my-0.5 min-h-8 cursor-pointer rounded-md py-1 px-2 font-medium [&>span.absolute]:hidden transition-colors focus:bg-blue-50 focus:text-blue-700 data-[state=checked]:bg-blue-50 data-[state=checked]:text-blue-700 dark:focus:bg-white/10 dark:focus:text-white dark:data-[state=checked]:bg-blue-400/15 dark:data-[state=checked]:text-blue-200 [@media(pointer:coarse)]:min-h-11";

export default function GroupSwitch({ tabs, currentTab, setCurrentTab }: {
	tabs: string[];
	currentTab: string;
	setCurrentTab: (tab: string) => void;
}) {
	const { t } = useTranslation();
	const groups = useMemo(() => tabs.filter(tab => tab !== "All"), [tabs]);
	const rootRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const { containerRef, enableIndicatorAnimation, indicator, itemRefs, setItemRef } =
		useActiveIndicator(groups, currentTab);
	const customBackgroundImage = window.CustomBackgroundImage || undefined;
	const selectedClass = (tab: string) => currentTab === tab
		? "text-black dark:text-white" : "text-stone-500 dark:text-stone-400";
	const select = (tab: string) => {
		if (currentTab !== tab) enableIndicatorAnimation();
		setCurrentTab(tab);
		setMenuOpen(false);
	};

	// Equal-sized cells guarantee at most three group labels, regardless of names.
	// Measure natural text width but cap long names; the menu retains their full text.
	useLayoutEffect(() => {
		const root = rootRef.current, track = containerRef.current;
		if (!root || !track) return;
		const labels = [...track.querySelectorAll<HTMLElement>("[data-group-name]")];
		const update = () => {
			const width = Math.min(96, Math.max(44, ...labels.map(el => Math.ceil(el.scrollWidth) + 18)));
			root.style.setProperty("--group-tab-width", width + "px");
		};
		const observer = new ResizeObserver(update);
		labels.forEach(el => observer.observe(el));
		update();
		return () => observer.disconnect();
	}, [groups, containerRef]);

	useEffect(() => {
		const root = rootRef.current, container = scrollRef.current;
		if (!root || !container) return;
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey || container.scrollWidth <= container.clientWidth) return;
			const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientWidth : 1);
			const previous = container.scrollLeft;
			container.scrollLeft += delta;
			if (container.scrollLeft !== previous) event.preventDefault();
		};
		root.addEventListener("wheel", onWheel, { passive: false });
		return () => root.removeEventListener("wheel", onWheel);
	}, [groups.length]);

	useEffect(() => {
		const active = itemRefs.current[groups.indexOf(currentTab)], container = scrollRef.current;
		if (!active || !container) return;
		const left = Math.max(0, active.offsetLeft - container.clientWidth / 2 + active.offsetWidth / 2);
		if (typeof container.scrollTo === "function") container.scrollTo({ left, behavior: "smooth" });
		else container.scrollLeft = left;
	}, [currentTab, groups, itemRefs]);

	useEffect(() => { setMenuOpen(false); }, [currentTab, tabs.length]);
	if (!groups.length) return null;
	return (
		<div ref={rootRef} data-group-switch="" role="group"
			aria-label={t("group.label", { defaultValue: "服务器分组" })}
			style={{ "--group-visible-count": Math.min(3, groups.length) } as CSSProperties}
			className={cn("relative flex min-w-0 max-w-full items-center gap-0.5 rounded-full bg-stone-100 p-[2px] ring-1 ring-inset ring-black/[0.04] dark:bg-stone-800 dark:ring-white/[0.06]",
				customBackgroundImage && "bg-stone-100/60 dark:bg-stone-800/60")}>
			<DropdownMenu modal={false} open={menuOpen} onOpenChange={open => {
				// First click returns to All; clicking the selected All opens the chooser.
				if (open && currentTab !== "All") select("All");
				else setMenuOpen(open);
			}}>
				<DropdownMenuTrigger asChild>
					<button ref={triggerRef} type="button" aria-pressed={currentTab === "All"}
						className={cn(buttonClass, selectedClass("All"))}>
						{currentTab === "All" && <span data-group-indicator="" aria-hidden="true"
							className="pointer-events-none absolute inset-0 rounded-full bg-white shadow-sm shadow-black/5 dark:bg-stone-700 dark:shadow-none" />}
						<span className="relative z-20 whitespace-nowrap">{t("group.all", { defaultValue: "All" })}</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" sideOffset={8} collisionPadding={12}
					onInteractOutside={event => {
						if (triggerRef.current?.contains(event.target as Node)) event.preventDefault();
					}}
					aria-label={t("group.label", { defaultValue: "服务器分组" })}
					className="group-choice-menu w-auto min-w-24 max-w-[calc(100vw-24px)] max-h-[min(320px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto rounded-xl border-stone-200/80 bg-white/95 p-1 text-stone-800 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-stone-900/95 dark:text-stone-100">
					<DropdownMenuRadioGroup value={currentTab}>
						{tabs.map(tab => <DropdownMenuRadioItem key={tab} value={tab} className={menuItemClass} onSelect={() => select(tab)}>
							<span className="break-words min-w-0">{tab === "All" ? t("group.all", { defaultValue: "All" }) : tab}</span>
						</DropdownMenuRadioItem>)}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<div ref={scrollRef} data-group-scroll="" className="group-tabs-viewport scrollbar-hidden">
				<div ref={containerRef} className="group-tabs-track relative">
					{indicator && <div aria-hidden="true" data-group-indicator=""
						className="active-indicator-fade-in pointer-events-none absolute left-0 top-0 z-10 rounded-full bg-white shadow-sm shadow-black/5 dark:bg-stone-700 dark:shadow-none"
						style={{ height: indicator.height, width: indicator.width,
							transform: `translate(${indicator.x}px, ${indicator.y}px)`,
							transition: indicator.shouldAnimate ? "transform 0.25s var(--timing), width 0.25s var(--timing)" : "none" }} />}
					{groups.map((tab, index) => <button type="button" key={tab} ref={setItemRef(index)}
						aria-pressed={currentTab === tab} title={tab} onClick={() => select(tab)}
						className={cn(buttonClass, "group-tab", selectedClass(tab))}>
						<span className="relative z-20 block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
							<span data-group-name="" className="inline-block w-max">{tab}</span>
						</span>
					</button>)}
				</div>
			</div>
		</div>
	);
}
