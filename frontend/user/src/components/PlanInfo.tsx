import { cn, type PublicNoteData } from "@/lib/utils";
import { carrierRoutes, readNetworkRoutes } from "@/lib/network-routes";
import RouteLogo from "./RouteLogo";
import PlanBadgeContents from "./PlanBadgeContents";
import {carrierColorStyle} from "../../../shared/carrier-colors";
import OtherCarrierBadges from "./OtherCarrierBadges";
import {extraNotes,extraNoteColor} from "../../../shared/extra-note-colors";

export default function PlanInfo({
	parsedData,
	className,
}: {
	parsedData: PublicNoteData;
	className?: string;
}) {
	if (!parsedData?.planDataMod) {
		return null;
	}

	const extraList = extraNotes(parsedData.planDataMod.extra);
	const networkRoutes = readNetworkRoutes(parsedData.planDataMod);

	return (
		<section data-plan-info className={cn("flex min-w-0 max-w-full gap-1 items-center flex-wrap mt-0.5", className)}>
			{parsedData.planDataMod.bandwidth !== "" && (
				<p
					className={cn(
						"inline-flex items-center justify-center min-h-[18px] text-center leading-[12px] text-[9px] bg-blue-600 dark:bg-blue-800 text-blue-200 dark:text-blue-300  w-fit rounded-[5px] px-[3px] py-[1.5px]",
					)}
				>
					<PlanBadgeContents>{parsedData.planDataMod.bandwidth}</PlanBadgeContents>
				</p>
			)}
			{parsedData.planDataMod.trafficVol !== "" && (
				<p
					className={cn(
						"inline-flex items-center justify-center min-h-[18px] text-center leading-[12px] text-[9px] bg-green-600 text-green-200 dark:bg-green-800 dark:text-green-300  w-fit rounded-[5px] px-[3px] py-[1.5px]",
					)}
				>
					<PlanBadgeContents>{parsedData.planDataMod.trafficVol}</PlanBadgeContents>
				</p>
			)}
			{parsedData.planDataMod.IPv4 === "1" && (
				<p
					className={cn(
						"inline-flex items-center justify-center min-h-[18px] text-center leading-[12px] text-[9px] bg-purple-600 text-purple-200 dark:bg-purple-800 dark:text-purple-300  w-fit rounded-[5px] px-[3px] py-[1.5px]",
					)}
				>
					<PlanBadgeContents>IPv4</PlanBadgeContents>
				</p>
			)}
			{parsedData.planDataMod.IPv6 === "1" && (
				<p
					className={cn(
						"inline-flex items-center justify-center min-h-[18px] text-center leading-[12px] text-[9px] bg-pink-600 text-pink-200 dark:bg-pink-800 dark:text-pink-300  w-fit rounded-[5px] px-[3px] py-[1.5px]",
					)}
				>
					<PlanBadgeContents>IPv6</PlanBadgeContents>
				</p>
			)}
			{carrierRoutes.map(({ key, label, className }) => networkRoutes[key] && (
				<p key={key} title={label} data-carrier={key} style={carrierColorStyle(parsedData.planDataMod?.networkRouteColors?.[key])}
					className={cn("inline-flex items-center justify-center min-h-[18px] text-center leading-[12px] gap-[3px] text-[9px] w-fit max-w-full rounded-[5px] px-[3px] py-[1.5px]", className)}>
					<PlanBadgeContents icon={<RouteLogo value={parsedData.planDataMod?.networkRouteLogos?.[key]} carrier={key} color={carrierColorStyle(parsedData.planDataMod?.networkRouteColors?.[key])?.color} />}>{networkRoutes[key]}</PlanBadgeContents>
				</p>
			))}
			<OtherCarrierBadges entries={parsedData.planDataMod.networkRouteEntries} color={parsedData.planDataMod.networkRouteColors?.other}/>
			{extraList.map((extra, index) => {
				return (
					<p
						key={index} data-extra-note={index} style={carrierColorStyle(extraNoteColor(parsedData.planDataMod?.extraColors,index))}
						className={cn(
							"inline-flex items-center justify-center min-h-[18px] text-center leading-[12px] text-[9px] w-fit max-w-full break-words rounded-[5px] px-[3px] py-[1.5px]",
						)}
					>
						<PlanBadgeContents>{extra}</PlanBadgeContents>
					</p>
				);
			})}
		</section>
	);
}
