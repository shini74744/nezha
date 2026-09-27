import {NativeSpeed,NativeTraffic} from "@/appearance/widgets";
import {useFeature} from "@/appearance/context";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import ServerUsageBar from "@/components/ServerUsageBar";
import { formatBytes } from "@/lib/format";
import {
	GetFontLogoClass,
	GetOsName,
	MageMicrosoftWindows,
} from "@/lib/logo-class";
import { saveMainPageScrollPosition } from "@/lib/navigation";
import { cn, formatNezhaInfo, parsePublicNote } from "@/lib/utils";
import type { NezhaServer } from "@/types/nezha-api";
import BillingInfo from "./billingInfo";
import ServerIdentity from "./ServerIdentity";
import ServerLinkTags from "./ServerLinkTags";
import PlanInfo from "./PlanInfo";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

function ServerCard({
	now,
	serverInfo,
}: {
	now: number;
	serverInfo: NezhaServer;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
const brand=useFeature("branding");
	const {
		name,
		country_code,
		online,
		cpu,
		up,
		down,
		mem,
		stg,
		net_in_transfer,
		net_out_transfer,
		public_note,
		platform,
	} = formatNezhaInfo(now, serverInfo);

	const cardClick = () => {
		saveMainPageScrollPosition();
		navigate(`/server/${serverInfo.id}`);
	};


	const customBackgroundImage =
		(window.CustomBackgroundImage as string) !== ""
			? window.CustomBackgroundImage
			: undefined;

	// @ts-expect-error ShowNetTransfer is a global variable
	const showNetTransfer = brand.enabled ? brand.showNetTransfer : window.ShowNetTransfer as boolean;

	// @ts-expect-error FixedTopServerName is a global variable
	const fixedTopServerName = window.FixedTopServerName as boolean;

	const parsedData = parsePublicNote(public_note);

	return online ? (
		<Card data-server-card
			className={cn(
				"flex cursor-pointer flex-col items-center justify-start gap-3 p-3 transition-all hover:shadow-sm hover:ring-stone-300 md:px-5 dark:hover:ring-stone-700",
				{
					"flex-col": fixedTopServerName,
					"lg:flex-row": !fixedTopServerName,
				},
				{
					"bg-card/70": customBackgroundImage,
				},
			)}
			onClick={cardClick}
		>
			<ServerIdentity online={online} name={name} country={country_code} parsedData={parsedData} fixed={fixedTopServerName} />
			<div data-mobile-billing
				className={cn("flex flex-col items-center gap-1 -mt-2 lg:hidden", {
					"lg:flex": fixedTopServerName,
				})}
			>
				<div className="flex items-center gap-2">{parsedData?.billingDataMod && <BillingInfo parsedData={parsedData} />}</div>
<ServerLinkTags tags={parsedData?.planDataMod?.linkTags}/>
			</div>
			<div className="flex flex-col lg:items-start items-center gap-2">
				<section
					className={cn("grid grid-cols-5 items-center gap-3", {
						"lg:grid-cols-6 lg:gap-4": fixedTopServerName,
					})}
				>
					{fixedTopServerName && (
						<div
							className={
								"hidden col-span-1 items-center lg:flex lg:flex-row gap-2"
							}
						>
							<div className="text-xs font-semibold">
								{platform.includes("Windows") ? (
									<MageMicrosoftWindows className="size-[10px]" />
								) : (
									<p className={`fl-${GetFontLogoClass(platform)}`} />
								)}
							</div>
							<div className={"flex w-14 flex-col"}>
								<p className="text-xs text-muted-foreground">
									{t("serverCard.system")}
								</p>
								<div className="flex items-center text-[10.5px] font-semibold">
									{platform.includes("Windows")
										? "Windows"
										: GetOsName(platform)}
								</div>
							</div>
						</div>
					)}
					<div className={"flex w-14 flex-col"}>
						<p data-metric-label="cpu" className="text-xs text-muted-foreground">{"CPU"}</p>
						<div className="flex items-center text-xs font-semibold">
							{cpu.toFixed(2)}%
						</div>
						<ServerUsageBar value={cpu} />
					</div>
					<div className={"flex w-14 flex-col"}>
						<p data-metric-label="memory" className="text-xs text-muted-foreground">
							{t("serverCard.mem")}
						</p>
						<div className="flex items-center text-xs font-semibold">
							{mem.toFixed(2)}%
						</div>
						<ServerUsageBar value={mem} />
					</div>
					<div className={"flex w-14 flex-col"}>
						<p className="text-xs text-muted-foreground">
							{t("serverCard.stg")}
						</p>
						<div className="flex items-center text-xs font-semibold">
							{stg.toFixed(2)}%
						</div>
						<ServerUsageBar value={stg} />
					</div>
					<div className={"flex w-14 flex-col"}>
						<p className="text-xs text-muted-foreground">
							{t("serverCard.upload")}
						</p>
						<div className="flex items-center text-xs font-semibold">
							<NativeSpeed bytes={serverInfo.state.net_out_speed} direction="up" fallback={up >= 1024
								? `${(up / 1024).toFixed(2)}G/s`
								: up >= 1
									? `${up.toFixed(2)}M/s`
									: `${(up * 1024).toFixed(2)}K/s`}/>
						</div>
					</div>
					<div className={"flex w-14 flex-col"}>
						<p className="text-xs text-muted-foreground">
							{t("serverCard.download")}
						</p>
						<div className="flex items-center text-xs font-semibold">
							<NativeSpeed bytes={serverInfo.state.net_in_speed} direction="down" fallback={down >= 1024
								? `${(down / 1024).toFixed(2)}G/s`
								: down >= 1
									? `${down.toFixed(2)}M/s`
									: `${(down * 1024).toFixed(2)}K/s`}/>
						</div>
					</div>
				</section>
				<NativeTraffic serverId={serverInfo.id}/>
				{showNetTransfer && (
					<section className={"flex items-center w-full justify-between gap-1"}>
						<Badge
							variant="secondary"
							className="items-center flex-1 justify-center rounded-[8px] text-nowrap text-[11px] border-muted-50 shadow-md shadow-neutral-200/30 dark:shadow-none"
						>
							{t("serverCard.upload")}:{formatBytes(net_out_transfer)}
						</Badge>
						<Badge
							variant="outline"
							className="items-center flex-1 justify-center rounded-[8px] text-nowrap text-[11px] shadow-md shadow-neutral-200/30 dark:shadow-none"
						>
							{t("serverCard.download")}:{formatBytes(net_in_transfer)}
						</Badge>
					</section>
				)}
{parsedData?.planDataMod && <PlanInfo parsedData={parsedData} />}
			</div>
		</Card>
	) : (
		<Card data-server-card
			className={cn(
				"flex flex-col items-center justify-start gap-3 sm:gap-0 p-3 md:px-5 cursor-pointer hover:bg-accent/50 transition-colors",
				showNetTransfer
					? "lg:min-h-[91px] min-h-[123px]"
					: "lg:min-h-[61px] min-h-[93px]",
				{
					"flex-col": fixedTopServerName,
					"lg:flex-row": !fixedTopServerName,
				},
				{
					"bg-card/70": customBackgroundImage,
				},
			)}
			onClick={cardClick}
		>
			<ServerIdentity online={online} name={name} country={country_code} parsedData={parsedData} fixed={fixedTopServerName} />
			<div data-mobile-billing
				className={cn("flex flex-col items-center gap-1 lg:hidden", {
					"lg:flex": fixedTopServerName,
				})}
			>
				<div className="flex items-center gap-2">{parsedData?.billingDataMod && <BillingInfo parsedData={parsedData} />}</div>
<ServerLinkTags tags={parsedData?.planDataMod?.linkTags}/>
			</div>
			{/* Legacy traffic enhancement applies to online cards only. */}
			{parsedData?.planDataMod && <PlanInfo parsedData={parsedData} />}
		</Card>
	);
}

export default memo(ServerCard);
