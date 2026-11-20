import type { SVGProps } from "react";
import { cn } from "@/lib/utils";
import { usagePercent } from "@/lib/usage-color";
import { usePixelAlignedHeight } from "@/lib/pixel-scale";

type ThinProgressProps = Omit<SVGProps<SVGSVGElement>, "color" | "children"> & {
	value: number;
	color: string;
	trackColor?: string;
};

// Crisp SVG edges keep fractional card positions from blurring a thin bar.
// Leave overflow visible so the viewport does not clip a pixel-snapped edge.
export function ThinProgress({
	value,
	color,
	trackColor,
	className,
	...props
}: ThinProgressProps) {
	const percent = usagePercent(value);
	const paintedHeight = usePixelAlignedHeight(4);
	const y = (4 - paintedHeight) / 2;
	return (
		<svg
			{...props}
			data-thin-progress
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			width="100%"
			height={4}
			className={cn(
				"block h-[4px] w-full shrink-0 overflow-visible",
				className,
			)}
		>
			<rect
				width="100%"
				height={paintedHeight}
				y={y}
				shapeRendering="crispEdges"
				className="fill-secondary"
				style={{ fill: trackColor }}
			/>
			<rect
				data-progress-fill
				height={paintedHeight}
				y={y}
				shapeRendering="crispEdges"
				className="transition-[width,fill] duration-500 ease-linear motion-reduce:transition-none"
				style={{ width: percent + "%", fill: color }}
			/>
		</svg>
	);
}
