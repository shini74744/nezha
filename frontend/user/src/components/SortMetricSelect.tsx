import { ChevronDown } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SORT_TYPES, type SortType } from "@/context/sort-context";
import { useSort } from "@/hooks/use-sort";

export default function SortMetricSelect() {
	const { t } = useTranslation();
	const { sortType, setSortType, setSortOrder } = useSort();
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		// Sorting is a toolbar action, not a modal: keep page scrolling and its gutter intact.
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<button
					ref={triggerRef}
					type="button"
					data-sort-trigger
					aria-label="Sort metric"
					className="flex h-full w-auto min-w-0 items-center justify-between gap-1 rounded-r-full rounded-l-none border-0 bg-transparent py-0 pl-1.5 pr-3 text-sm text-inherit shadow-none focus:outline-hidden focus:ring-2 focus:ring-blue-400/60 focus:ring-offset-0"
				>
					<span className="line-clamp-1">{t(`sort.types.${sortType.replace(/ /g, "_")}`)}</span>
					<ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={8}
				collisionPadding={12}
				onInteractOutside={(event) => {
					// Avoid a second dismissal when focus returns to a rapidly toggled trigger.
					if (triggerRef.current?.contains(event.target as Node)) event.preventDefault();
				}}
				className="server-sort-menu max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] min-w-20 max-w-[calc(100vw-24px)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border-stone-200/80 bg-white/95 p-1 text-stone-800 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-stone-900/95 dark:text-stone-100"
			>
				<DropdownMenuRadioGroup value={sortType} onValueChange={(value) => {
					if (!SORT_TYPES.includes(value as SortType) || value === sortType) return;
					setSortType(value as SortType);
					if (value === "default") setSortOrder("desc");
				}}>
					{SORT_TYPES.map((type) => (
						<DropdownMenuRadioItem
							key={type}
							value={type}
							className="my-0.5 min-h-8 cursor-pointer rounded-md py-1 px-2 font-medium [&>span.absolute]:hidden transition-colors focus:bg-blue-50 focus:text-blue-700 data-[state=checked]:bg-blue-50 data-[state=checked]:text-blue-700 dark:focus:bg-white/10 dark:focus:text-white dark:data-[state=checked]:bg-blue-400/15 dark:data-[state=checked]:text-blue-200 [@media(pointer:coarse)]:min-h-11"
						>
							{t(`sort.types.${type.replace(/ /g, "_")}`)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
