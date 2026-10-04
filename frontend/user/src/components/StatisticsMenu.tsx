import { ChartBarSquareIcon, ChevronDownIcon } from "@heroicons/react/20/solid";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { type StatisticsView } from "@/hooks/use-statistics-view";
import { cn } from "@/lib/utils";
import {
	DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
	DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "./ui/dropdown-menu";

export default function StatisticsMenu({ value, onChange, split = true, disabled = false }: {
	value: StatisticsView; onChange: (view: StatisticsView) => void; split?: boolean; disabled?: boolean;
}) {
	const { t } = useTranslation();
	const triggerRef = useRef<HTMLButtonElement>(null);
	// onSelect also fires when the selected radio item is activated again.
	const selectView = (next: Exclude<StatisticsView, "closed">) =>
		onChange(value === next ? "closed" : next);
	const itemClass = "my-0.5 min-h-8 cursor-pointer rounded-md py-1 px-2 font-medium [&>span.absolute]:hidden transition-colors focus:bg-blue-50 focus:text-blue-700 data-[state=checked]:bg-blue-50 data-[state=checked]:text-blue-700 dark:focus:bg-white/10 dark:focus:text-white dark:data-[state=checked]:bg-blue-400/15 dark:data-[state=checked]:text-blue-200 [@media(pointer:coarse)]:min-h-11";
	if (!split) return <button type="button" data-statistics-trigger disabled={disabled}
		aria-label={t("statistics.toggle")} aria-pressed={value !== "closed"}
		onClick={() => onChange(value === "closed" ? "traffic" : "closed")}
		className={cn("relative shrink-0 flex items-center justify-center rounded-full bg-blue-100 p-2.5 text-blue-600 dark:bg-blue-900 dark:text-blue-100 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500", value !== "closed" && "bg-blue-600 text-white dark:bg-blue-100 dark:text-blue-600")}>
		<ChartBarSquareIcon className="size-[13px]" aria-hidden="true" />
	</button>;
	return (
		// This toolbar menu must not lock body scrolling or compensate its scrollbar gap.
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<button ref={triggerRef} type="button" disabled={disabled} aria-label={t("statistics.choose")}
					title={t("statistics.choose")} data-statistics-trigger
					className={cn(
						"relative shrink-0 flex items-center justify-center rounded-full bg-blue-100 p-2.5 text-blue-600 dark:bg-blue-900 dark:text-blue-100 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
						value !== "closed" && "bg-blue-600 text-white dark:bg-blue-100 dark:text-blue-600",
					)}>
					<ChartBarSquareIcon className="size-[13px]" aria-hidden="true" />
					<ChevronDownIcon className="absolute bottom-0.5 right-0.5 size-2" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" sideOffset={8} collisionPadding={12}
				onInteractOutside={(event) => {
					// The trigger already toggles the menu. Do not dismiss it again when
					// focus returns there during a quick close/reopen animation.
					if (triggerRef.current?.contains(event.target as Node)) event.preventDefault();
				}}
				aria-label={t("statistics.choose")}
				className="statistics-menu w-auto min-w-24 max-w-[calc(100vw-24px)] rounded-xl border-stone-200/80 bg-white/95 p-1 text-stone-800 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-stone-900/95 dark:text-stone-100">
				<DropdownMenuRadioGroup value={value}>
					<DropdownMenuRadioItem value="traffic" className={itemClass} onSelect={() => selectView("traffic")}>
						{t("statistics.traffic")}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="uptime" className={itemClass} onSelect={() => selectView("uptime")}>
						{t("statistics.uptime")}
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
