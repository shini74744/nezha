import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchSetting } from "@/lib/nezha-api";
import { loadServerDetailChart, loadServerNetworkSection, PreloadedServerConnectivity as ServerConnectivity, PreloadedServerNetworkInsight as ServerNetworkInsight } from "@/lib/detail-modules";
import { usePrimaryDetailPreload } from "@/hooks/use-primary-detail-preload";
const ServerNetworkSection = lazy(loadServerNetworkSection);
const ServerDetailChart = lazy(loadServerDetailChart);
import ServerDetailOverview from "@/components/ServerDetailOverview";
import TabSwitch from "@/components/TabSwitch";
import DetailPanel from "@/components/DetailPanel";
import { useStableDetailViewport } from "@/hooks/use-stable-detail-viewport";
import { Separator } from "@/components/ui/separator";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { formatNezhaInfo } from "@/lib/utils";
const OfflineServerDetail = lazy(() => import("@/components/OfflineServerDetail").then(module => ({default:module.OfflineServerDetail})));
function SectionLoading() {return <div data-detail-section-loading role="status" className="rounded-xl border bg-card/70 p-5 text-sm text-muted-foreground">正在加载…</div>;}

export default function ServerDetail() {
	useEffect(() => {
		window.scrollTo({ top: 0, left: 0, behavior: "instant" });
	}, []);

	const [selectedTab, setCurrentTab] = useState("Detail");
	const { data: setting } = useQuery({queryKey: ["setting"], queryFn: fetchSetting, refetchOnWindowFocus: true, refetchInterval: 30000});
	const combinedNetwork = setting?.data?.config?.show_network_in_detail === true;
	useEffect(() => { if (combinedNetwork && selectedTab === "Network") setCurrentTab("Detail"); }, [combinedNetwork, selectedTab]);

	const { id: server_id } = useParams();
	const { lastData } = useWebSocketContext();
	const server = lastData?.servers.find(s => s.id === Number(server_id));
	const warmTab = usePrimaryDetailPreload(server?.id, {
		connectivity: !!server && !server.connectivity_disabled,
		bgp: !!server && !server.bgp_disabled,
		streaming: !!server && !server.streaming_disabled,
	});
	const tabs = useMemo(() => ["Detail", ...(!combinedNetwork ? ["Network"] : []), ...(!server?.connectivity_disabled ? ["Connectivity"] : []), ...(!server?.bgp_disabled ? ["BGP"] : []), ...(!server?.streaming_disabled ? ["Streaming"] : [])], [combinedNetwork, server?.connectivity_disabled, server?.bgp_disabled, server?.streaming_disabled]);
	const currentTab = tabs.includes(selectedTab) ? selectedTab : "Detail";
	const { viewportRef, preserveScroll } = useStableDetailViewport(server_id || "", currentTab);
	const selectTab = (next: string) => {
		if (next === currentTab) return;
		preserveScroll();
		setCurrentTab(next);
	};
	if (server && lastData && !formatNezhaInfo(lastData.now, server).online) {
		return <Suspense fallback={<div className="mx-auto w-full max-w-5xl server-info"><ServerDetailOverview server_id={server_id!}/><SectionLoading/></div>}><OfflineServerDetail key={server.id} server={server} now={lastData.now} initialTab={currentTab} onTabIntent={warmTab} /></Suspense>;
	}

	if (!server_id) {
		return <Navigate to="/404" replace />;
	}

	return (
		<div className="mx-auto w-full max-w-5xl px-0 flex flex-col gap-4 server-info">
			<ServerDetailOverview server_id={server_id} />
			<section className="flex items-center my-2 w-full">
				<Separator className="flex-1" />
				<div className="flex justify-center w-full max-w-sm">
					<TabSwitch
						tabs={tabs}
						currentTab={currentTab}
						setCurrentTab={selectTab}
						onTabIntent={warmTab}
					/>
				</div>
				<Separator className="flex-1" />
			</section>

			{/* <section>
				<ServerDetailSummary server_id={Number(server_id)} />
			</section> */}

			<div ref={viewportRef} data-detail-viewport className={`detail-viewport flex flex-col gap-4 min-w-0${currentTab === "Connectivity" ? " -mt-5" : ""}`}>
			{currentTab !== "Network" && <DetailPanel key={server_id + ":" + currentTab}>
			{currentTab === tabs[0] && <Suspense fallback={<SectionLoading/>}><ServerDetailChart server_id={server_id} /></Suspense>}
			{(currentTab === "BGP" || currentTab === "Streaming") && <Suspense fallback={<SectionLoading/>}><ServerNetworkInsight key={server_id+currentTab} serverId={Number(server_id)} kind={currentTab === "BGP" ? "bgp" : "streaming"}/></Suspense>}
			{currentTab === "Connectivity" && <Suspense fallback={<SectionLoading/>}><ServerConnectivity key={server_id} serverId={Number(server_id)} countryCode={server?.country_code} /></Suspense>}
			</DetailPanel>}
			{(currentTab === "Network" || (currentTab === "Detail" && combinedNetwork)) && <DetailPanel key={server_id + ":network"}><Suspense fallback={<SectionLoading/>}><ServerNetworkSection server_id={Number(server_id)} standalone={currentTab === "Network"} /></Suspense></DetailPanel>}
			</div>
		</div>
	);
}