import { cn } from "@/lib/utils";

import { Progress } from "./ui/progress";

export default function RemainPercentBar({
	value,
	className,
}: {
	value: number;
	className?: string;
}) {
	const percentage = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
	// Interpolate hue continuously: full remaining time is green, expiry is red.
	const color = `hsl(${percentage * 1.2} 70% 45%)`;
	return (
		<Progress
			data-expiry-progress
			aria-label={"Server Usage Bar"}
			aria-labelledby={"Server Usage Bar"}
			value={percentage}
			style={{ color }}
			indicatorClassName="bg-current"
			className={cn(
				"h-[3px] rounded-sm w-[70px] transition-colors duration-500 motion-reduce:transition-none",
				className,
			)}
		/>
	);
}
