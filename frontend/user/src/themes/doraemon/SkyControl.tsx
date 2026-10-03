import { ChevronDown, Clock, Moon, Sun } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export type SkyMode = "auto" | "light" | "dark";
const modes = [
	{
		value: "auto",
		label: "自动",
		title: "跟随北京时间",
		description: "07:00–19:00 晴空，其余时间夜空",
		icon: Clock,
	},
	{
		value: "light",
		label: "晴空",
		title: "晴空模式",
		description: "保持明亮的蓝天",
		icon: Sun,
	},
	{
		value: "dark",
		label: "夜空",
		title: "夜空充电",
		description: "保持柔和的夜色",
		icon: Moon,
	},
] as const;
export function SkyControl({
	mode,
	onChange,
}: {
	mode: SkyMode;
	onChange: (mode: SkyMode) => void;
}) {
	const selected = modes.find((item) => item.value === mode) || modes[0];
	const Icon = selected.icon;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="dora-sky-control"
					aria-label={`天空模式：${selected.label}`}
					title={selected.title}
				>
					<Icon size={15} aria-hidden="true" />
					<span>{selected.label}</span>
					<ChevronDown size={12} aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="dora-sky-menu"
				align="end"
				sideOffset={8}
				collisionPadding={12}
			>
				<DropdownMenuRadioGroup
					value={mode}
					onValueChange={(value) => onChange(value as SkyMode)}
				>
					{modes.map(({ value, title, description, icon: ModeIcon }) => (
						<DropdownMenuRadioItem
							key={value}
							value={value}
							className="dora-sky-option"
						>
							<ModeIcon size={16} aria-hidden="true" />
							<span>
								<b>{title}</b>
								<small>{description}</small>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
