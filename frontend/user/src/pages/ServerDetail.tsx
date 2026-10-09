import ServerReturnRoute from "@/components/ServerReturnRoute";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
	const { data: setting, isPending: settingPending, isError: settingError, refetch: refetchSetting } = useQuery({queryKey: ["setting"], queryFn: fetchSetting, refetchOnWindowFocus: true, refetchInterval: 30000});
	const combinedNetwork = setting?.data?.config?.show_network_in_detail === true;
	useEffect(() => { if (combinedNetwork && selectedTab === "Network") setCurrentTab("Detail"); }, [combinedNetwork, selectedTab]);

	const { id: server_id } = useParams();
	const { lastData, reconnect } = useWebSocketContext();
	const validServerId = !!server_id && /^[1-9]\d*$/.test(server_id) && Number.isSafeInteger(Number(server_id));
	const server = validServerId ? lastData?.servers.find(s => s.id === Number(server_id)) : undefined;
	const [initialLoadTimedOut, setInitialLoadTimedOut] = useState(false);
	const [retryAttempt, setRetryAttempt] = useState(0);
	const waitingForInitialData = !lastData || settingPending;
// biome-ignore lint/correctness/useExhaustiveDependencies: Each node or explicit retry starts a fresh initial-data timeout.
	useEffect(() => {
		setInitialLoadTimedOut(false);
		if (!validServerId || !waitingForInitialData) return;
		const timer = window.setTimeout(() => setInitialLoadTimedOut(true), 15000);
		return () => window.clearTimeout(timer);
	}, [server_id, validServerId, waitingForInitialData, retryAttempt]);
	const retryInitialLoad = () => {
		setInitialLoadTimedOut(false);
		setRetryAttempt(attempt => attempt + 1);
		reconnect();
		void refetchSetting();
	};
	const warmTab = usePrimaryDetailPreload(server?.id, {
		connectivity: !!server && (!server.connectivity_disabled || !!server.connectivity_local_only),
		bgp: !!server && !server.bgp_disabled,
		streaming: !!server && !server.streaming_disabled,
	});
	const tabs = useMemo(() => ["Detail", ...(!combinedNetwork ? ["Network"] : []), ...((!server?.connectivity_disabled || !!server?.connectivity_local_only) ? ["Connectivity"] : []), ...(!server?.bgp_disabled ? ["BGP"] : []), ...(!server?.return_route_disabled ? ["ReturnRoute"] : []), ...(!server?.streaming_disabled ? ["Streaming"] : [])], [combinedNetwork, server?.connectivity_disabled, server?.connectivity_local_only, server?.bgp_disabled, server?.return_route_disabled, server?.streaming_disabled]);
	const currentTab = tabs.includes(selectedTab) ? selectedTab : "Detail";
	const { viewportRef, preserveScroll } = useStableDetailViewport(server_id || "", currentTab);
	const selectTab = (next: string) => {
		if (next === currentTab) return;
		preserveScroll();
		setCurrentTab(next);
	};
	if (!server_id) return <Navigate to="/404" replace />;
	const nodeUnavailable = !validServerId || (!!lastData && !server);
	const initialLoadFailed = (waitingForInitialData && initialLoadTimedOut) || (!setting && settingError) || setting?.success === false;
	if (nodeUnavailable || initialLoadFailed) {
		return <div data-detail-unavailable className="mx-auto w-full max-w-5xl server-info">
			<section role="status" className="rounded-xl border bg-card/70 p-5 text-sm">
				<p>{nodeUnavailable ? "节点不存在或无权查看" : "暂时无法加载节点信息，请稍后重试"}</p>
				<div className="mt-4 flex flex-wrap gap-2">
					<Button asChild variant="outline" size="sm"><Link to="/">返回列表</Link></Button>
					{validServerId && <Button type="button" variant="outline" size="sm" onClick={retryInitialLoad}>重新加载</Button>}
				</div>
			</section>
		</div>;
	}
	// The overview depends on the first node frame. Do not place interactive tabs
	// below a shorter skeleton and then move them when the real summary arrives.
	if (server_id && (!server || settingPending)) {
		return <div data-detail-initializing className="mx-auto w-full max-w-5xl px-0 server-info">
			<ServerDetailOverview server_id={server_id} />
		</div>;
	}
	if (server && lastData && !formatNezhaInfo(lastData.now, server).online) {
		return <Suspense fallback={<div className="mx-auto w-full max-w-5xl server-info"><ServerDetailOverview server_id={server_id!}/><SectionLoading/></div>}><OfflineServerDetail key={server.id} server={server} now={lastData.now} initialTab={currentTab} onTabIntent={warmTab} /></Suspense>;
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

			<div ref={viewportRef} data-detail-viewport className={`detail-viewport flex flex-col gap-4 min-w-0${currentTab === "Connectivity" ? " -mt-6" : ""}`}>
			{currentTab !== "Network" && <DetailPanel key={server_id + ":" + currentTab}>
			{currentTab === tabs[0] && <Suspense fallback={<SectionLoading/>}><ServerDetailChart server_id={server_id} /></Suspense>}
			{(currentTab === "BGP" || currentTab === "Streaming") && <Suspense fallback={<SectionLoading/>}><ServerNetworkInsight key={server_id+currentTab} serverId={Number(server_id)} kind={currentTab === "BGP" ? "bgp" : "streaming"}/></Suspense>}
			{currentTab === "ReturnRoute" && <ServerReturnRoute key={server_id} serverId={Number(server_id)}/>}
			{currentTab === "Connectivity" && <Suspense fallback={<SectionLoading/>}><ServerConnectivity key={server_id} serverId={Number(server_id)} countryCode={server?.country_code} localOnly={!!server?.connectivity_disabled && !!server?.connectivity_local_only} /></Suspense>}
			</DetailPanel>}
			{(currentTab === "Network" || (currentTab === "Detail" && combinedNetwork)) && <DetailPanel key={server_id + ":network"}><Suspense fallback={<SectionLoading/>}><ServerNetworkSection server_id={Number(server_id)} standalone={currentTab === "Network"} /></Suspense></DetailPanel>}
			</div>
		</div>
	);
}