import { ThinProgress } from "@/components/ui/thin-progress";
import { remainingTimeColor } from "@/lib/usage-color";
import { cn } from "@/lib/utils";

export default function RemainPercentBar({
	value,
	className,
}: {
	value: number;
	className?: string;
}) {
	return (
		<ThinProgress
			barHeight={3}
			data-expiry-progress
			aria-label="Remaining time"
			value={value}
			color={remainingTimeColor(value)}
			className={cn("w-[70px]", className)}
		/>
	);
}
