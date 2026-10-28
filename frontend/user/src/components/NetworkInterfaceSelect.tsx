import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "./ui/dropdown-menu";
import { statisticsItemClass, statisticsMenuClass } from "./StatisticsMenu";
export type NetworkInterfaceSelection = {
	value: string;
	names: string[];
	onChange: (value: string) => void;
	pending?: boolean;
	message?: string;
};
export default function NetworkInterfaceSelect({
	selection,
}: {
	selection: NetworkInterfaceSelection;
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
 const [open,setOpen] = useState(false);
 const dialog = triggerRef.current?.closest<HTMLElement>('[role="dialog"]');
	const names = [
		...new Set([
			...selection.names,
			...(selection.value ? [selection.value] : []),
		]),
	];
	return (
		<DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					ref={triggerRef}
					aria-label={"选择网卡，当前：" + (selection.value || "全部")}
					title={selection.value || "全部网卡合计"}
					className="ml-auto flex h-9 min-w-0 max-w-28 shrink items-center justify-center gap-1 rounded-full bg-muted/70 px-2 text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:max-w-40"
				>
					<span className="min-w-0 truncate">{selection.value || "全部"}</span>
					<ChevronDown className="size-3 shrink-0" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
                container={dialog}
                collisionBoundary={dialog || undefined}
				sideOffset={8}
                collisionPadding={12}
                onInteractOutside={(event) => {
                    if (triggerRef.current?.contains(event.target as Node)) event.preventDefault();
                }}
				className={
					statisticsMenuClass +
					" max-h-64 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain"
				}
			>
				<DropdownMenuRadioGroup value={selection.value}>
					{["", ...names].map((name) => (
						<DropdownMenuRadioItem
							key={name || "all"}
							value={name}
							className={statisticsItemClass + " flex items-center gap-2"}
							onSelect={() => selection.onChange(name)}
						>
							<span className="min-w-0 break-all">{name || "全部"}</span>
							<Check
								className={
									"ml-auto size-4 shrink-0 " +
									(selection.value === name ? "" : "invisible")
								}
								aria-hidden="true"
							/>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
