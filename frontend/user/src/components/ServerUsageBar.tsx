import { Progress } from "@/components/ui/progress";
import { usageColor, usagePercent } from "@/lib/usage-color";

type ServerUsageBarProps = {
	value: number;
};

export default function ServerUsageBar({ value }: ServerUsageBarProps) {
	const percent = usagePercent(value);
	return (
		<Progress
			aria-label="Server Usage Bar"
			data-server-usage
			value={percent}
			indicatorStyle={{ backgroundColor: usageColor(percent) }}
			indicatorClassName="transition-[transform,background-color] duration-500 ease-linear motion-reduce:transition-none"
			className="h-[3px] rounded-sm"
		/>
	);
}
