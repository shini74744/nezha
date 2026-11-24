import { ThinProgress } from "@/components/ui/thin-progress";
import { usageColor } from "@/lib/usage-color";

export default function ServerUsageBar({ value }: { value: number }) {
	return (
		<ThinProgress
			aria-label="Server Usage Bar"
			barHeight={3}
			data-server-usage
			value={value}
			color={usageColor(value)}
		/>
	);
}
