import { X } from "lucide-react";
import { type CSSProperties, memo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import useTooltip from "@/hooks/use-tooltip";
import { saveMainPageScrollPosition } from "@/lib/navigation";

const MapTooltip = memo(function MapTooltip({
	width = 900,
	height = 500,
	onClose,
}: {
	width?: number;
	height?: number;
	onClose?: () => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { tooltipData } = useTooltip();

	if (!tooltipData) return null;

	const verticalPlacement =
		tooltipData.centroid[1] < height * 0.25
			? "8px"
			: tooltipData.centroid[1] > height * 0.75
				? "calc(-100% - 8px)"
				: "-50%";

	return (
		<div
			className="global-map-tooltip tooltip-animate absolute text-sm z-50"
			data-testid="map-tooltip"
			key={tooltipData.country}
			style={
				{
					"--map-tooltip-x": `clamp(12px, calc(${(tooltipData.centroid[0] / width) * 100}% - 110px), calc(100% - 232px))`,
					"--map-tooltip-y": `${(tooltipData.centroid[1] / height) * 100}%`,
					"--map-tooltip-transform": `translateY(${verticalPlacement})`,
				} as CSSProperties
			}
			onMouseEnter={(e) => {
				e.stopPropagation();
			}}
		>
			{onClose && (
				<button
					type="button"
					className="global-map-tooltip-close"
					onClick={onClose}
					aria-label={t("map.Close")}
				>
					<X size={14} />
				</button>
			)}
			<div>
				<p className="font-medium">
					{tooltipData.country === "China"
						? "Mainland China"
						: tooltipData.country}
				</p>
				<p className="text-neutral-600 dark:text-neutral-400 text-xs font-light mb-1">
					{tooltipData.count} {t("map.Servers")}
					<span className="block">
						{t("map.Online")}{" "}
						{tooltipData.servers.filter((server) => server.status).length} ·{" "}
						{t("map.Offline")}{" "}
						{tooltipData.servers.filter((server) => !server.status).length}
					</span>
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
							onClose?.();
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
