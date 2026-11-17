import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import useTooltip from "@/hooks/use-tooltip";
import { saveMainPageScrollPosition } from "@/lib/navigation";

const MapTooltip = memo(function MapTooltip({
	width = 900,
	height = 500,
}: {
	width?: number;
	height?: number;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { tooltipData } = useTooltip();

	if (!tooltipData) return null;

	const horizontalPlacement =
		tooltipData.centroid[0] > width * 0.65 ? "calc(-100% - 12px)" : "12px";
	const verticalPlacement =
		tooltipData.centroid[1] < height * 0.25
			? "8px"
			: tooltipData.centroid[1] > height * 0.75
				? "calc(-100% - 8px)"
				: "-50%";

	return (
		<div
			className="global-map-tooltip tooltip-animate absolute hidden lg:block text-sm z-50"
			data-testid="map-tooltip"
			key={tooltipData.country}
			style={{
				left: `${(tooltipData.centroid[0] / width) * 100}%`,
				top: `${(tooltipData.centroid[1] / height) * 100}%`,
				transform: `translate(${horizontalPlacement}, ${verticalPlacement})`,
			}}
			onMouseEnter={(e) => {
				e.stopPropagation();
			}}
		>
			<div>
				<p className="font-medium">
					{tooltipData.country === "China"
						? "Mainland China"
						: tooltipData.country}
				</p>
				<p className="text-neutral-600 dark:text-neutral-400 text-xs font-light mb-1">
					{tooltipData.count} {t("map.Servers")}
				</p>
			</div>
			<div
				className="border-t dark:border-neutral-700 pt-1"
				style={{
					maxHeight: "200px",
					overflowY: "auto",
				}}
			>
				{tooltipData.servers.map((server) => (
					<button
						key={server.id}
						type="button"
						className="flex items-center gap-1.5 py-0.5 text-neutral-500 transition-colors hover:text-black dark:text-neutral-400 dark:hover:text-white"
						onClick={() => {
							saveMainPageScrollPosition();
							navigate(`/server/${server.id}`);
						}}
					>
						<span
							className={`h-1.5 w-1.5 shrink-0 rounded-full ${server.status ? "bg-green-500" : "bg-red-500"}`}
						/>
						<span className="text-xs">{server.name}</span>
					</button>
				))}
			</div>
		</div>
	);
});

export default MapTooltip;
