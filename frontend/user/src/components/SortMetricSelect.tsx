import { useTranslation } from "react-i18next";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SORT_TYPES, type SortType } from "@/context/sort-context";
import { useSort } from "@/hooks/use-sort";

export default function SortMetricSelect() {
	const { t } = useTranslation();
	const { sortType, setSortType, setSortOrder } = useSort();
	return (
		<Select
			value={sortType}
			onValueChange={(value) => {
				if (!SORT_TYPES.includes(value as SortType)) return;
				setSortType(value as SortType);
				if (value === "default") setSortOrder("desc");
			}}
		>
			<SelectTrigger
				aria-label="Sort metric"
				className="h-full w-auto min-w-0 gap-1 rounded-r-full rounded-l-none border-0 bg-transparent py-0 pl-1.5 pr-3 text-inherit shadow-none focus:ring-2 focus:ring-blue-400/60 focus:ring-offset-0 [&>svg]:size-3.5 [&>svg]:opacity-70"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent
				align="end"
				sideOffset={8}
				collisionPadding={12}
				className="server-sort-menu max-h-[min(32rem,var(--radix-select-content-available-height))] min-w-20 max-w-[calc(100vw-24px)] rounded-xl border-stone-200/80 bg-white/95 text-stone-800 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-stone-900/95 dark:text-stone-100"
			>
				{SORT_TYPES.map((type) => (
					<SelectItem
						key={type}
						value={type}
						className="my-0.5 min-h-8 cursor-pointer rounded-md py-1 px-2 font-medium [&>span.absolute]:hidden transition-colors focus:bg-blue-50 focus:text-blue-700 data-[state=checked]:bg-blue-50 data-[state=checked]:text-blue-700 dark:focus:bg-white/10 dark:focus:text-white dark:data-[state=checked]:bg-blue-400/15 dark:data-[state=checked]:text-blue-200 [@media(pointer:coarse)]:min-h-11"
					>
						{t(`sort.types.${type.replace(/ /g, "_")}`)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
