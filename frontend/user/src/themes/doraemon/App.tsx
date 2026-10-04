import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Settings } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Routes, useMatch } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppearanceProvider } from "@/appearance/context";
import { DashCommand } from "@/components/DashCommand";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SearchButton } from "@/components/SearchButton";
import { useTheme } from "@/hooks/use-theme";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { fetchSetting } from "@/lib/nezha-api";
import Servers, { type ServerPresentation } from "@/pages/Server";
import { art } from "./assets";
import { DoraemonCard, DoraemonInlineCard } from "./Card";
import { DoraemonTrafficProvider } from "./Traffic";
import { DoraemonMap, DoraemonOverview } from "./Overview";
import { DoraemonLoading, DoraemonScene } from "./Scene";
import "./theme.css";
import { beijingSky } from "./sky";

const loadDetail = () => import("@/pages/ServerDetail");
const Detail = lazy(loadDetail);
const NotFound = lazy(() => import("@/pages/NotFound"));
const ErrorPage = lazy(() => import("@/pages/ErrorPage"));
const presentation: ServerPresentation = {
	Card: DoraemonCard,
	InlineCard: DoraemonInlineCard,
	Overview: DoraemonOverview,
	Map: DoraemonMap,
	Loading: DoraemonLoading,
	storagePrefix: "doraemon:",
};
import { SkyControl, type SkyMode } from "./SkyControl";
import { DoraemonCompanion } from "./Companion";
import {DoraemonAppearanceProvider} from "./Appearance";
import {FriendsBanner} from "./Friends";
import {PocketGadgets,GadgetBackToTop} from "./Gadgets";
import { NetworkRateContext } from "@/context/network-rate-context";
import { formatNetworkRate } from "./format";
export default function DoraemonApp() {
	const { data, error } = useQuery({
		queryKey: ["setting"],
		queryFn: fetchSetting,
		retry: false,
	});
	const { setTheme } = useTheme();
	const { i18n } = useTranslation();
	useEffect(() => {
		if (data?.data?.config?.language && !localStorage.getItem("language")) {
			void i18n.changeLanguage(data.data.config.language);
		}
	}, [data?.data?.config?.language, i18n]);
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void loadDetail().catch(() => undefined);
		}, 800);
		return () => window.clearTimeout(timer);
	}, []);
	const { connected } = useWebSocketContext();
	const [mode, setMode] = useState<SkyMode>(() => {
		const s = localStorage.getItem("doraemon-sky");
		return s === "light" || s === "dark" ? s : "auto";
	});
	const [pocket, setPocket] = useState(false);
	const site = data?.data?.config?.site_name || "哆啦 A 梦 · 道具监控站";
    const isServerList = useMatch({path:"/",end:true});
    const pageBottom = <>
        <DoraemonCompanion/>
        <GadgetBackToTop/>
        <footer className="dora-footer">
            <span>🔔 {site} · 哪吒监控</span>
            {/* Attribution and MIT notice are preserved in the bundled LICENSE file. */}
        </footer>
    </>;
	useEffect(() => {
		const apply = () => setTheme(mode === "auto" ? beijingSky() : mode);
		apply();
		const timer = mode === "auto" ? setInterval(apply, 60000) : undefined;
		localStorage.setItem("doraemon-sky", mode);
		return () => clearInterval(timer);
	}, [mode, setTheme]);
	useEffect(() => {
		const previousTitle = document.title;
		document.documentElement.dataset.probeTheme = "doraemon";
		document.title = site;
		const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		const old = icon?.href;
		const oldType = icon?.type;
		if (icon) {
			icon.href = art.doraemon;
			icon.type = "image/svg+xml";
		}
		return () => {
			delete document.documentElement.dataset.probeTheme;
			document.title = previousTitle;
			if (icon && old) {
				icon.href = old;
				icon.type = oldType || "";
			}
		};
	}, [site]);
	return (
		<ErrorBoundary>
			<AppearanceProvider>
				<NetworkRateContext.Provider value={formatNetworkRate}>
                    <DoraemonAppearanceProvider raw={data?.data?.config?.doraemon_appearance_config} ready={!!data?.data?.config}>
					<div className="dora-theme" data-doraemon-theme>
						<DoraemonScene />
						<main className="dora-shell">
							<header className="dora-header" id="dora-page-top" tabIndex={-1}>
                                <div className="dora-header-identity">
								<button
									className="dora-avatar"
									aria-label="打开四次元口袋"
									aria-expanded={pocket}
									onClick={() => setPocket(!pocket)}
								>
									<img src={art.doraemon} alt="哆啦 A 梦" />
								</button>
								<Link
									to="/"
									className="dora-brand"
									onClick={() =>
										sessionStorage.removeItem("doraemon:selectedGroup")
									}
								>
									<strong>{site}</strong>
									<span>野比家服务器 · 22 世纪道具监控站</span>
								</Link>
                                </div>
                                <FriendsBanner/>
                                <div className="dora-header-tools">
								<span
									className={
										"dora-connection " + (connected ? "is-online" : "")
									}
									role="status"
								>
									{connected ? "传送已连接" : "正在连接"}
								</span>
								<div className="dora-header-actions">
									<SearchButton />
									<SkyControl mode={mode} onChange={setMode} />
									<a
										className="dora-icon-button"
										href="/dashboard"
										aria-label="进入管理后台"
									>
										<Settings size={18} />
									</a>
								</div>
                                </div>
								<button
									className="dora-header-bell"
									aria-label="摇响铃铛，打开口袋"
									aria-expanded={pocket}
									onClick={() => setPocket(!pocket)}
								>
									<img src={art.bell} alt="" />
								</button>
							</header>
							{pocket && (
								<section className="dora-pocket" aria-label="四次元口袋">
									<img src={art.pocket} alt="" />
									<div>
										<strong>今天也要元气满满！</strong>
										<p>每一台服务器，都是一件可靠的神奇道具。</p>
									</div>
									<button
										onClick={() => setPocket(false)}
										aria-label="收起四次元口袋"
									>
										×
									</button>
									<PocketGadgets/>
								</section>
							)}
							<DashCommand showThemeShortcuts={false} />
							<Routes>
								<Route
									path="/"
									element={
										<DoraemonTrafficProvider
											appearance={data?.data?.config?.doraemon_appearance_config}
											ready={!!data?.data?.config}
										>
											<Servers
												presentation={presentation}
                                                afterContent={pageBottom}
												backendError={
													!data && error ? new Error(String(error)) : null
												}
											/>
										</DoraemonTrafficProvider>
									}
								/>
								<Route
									path="/server/:id"
									element={
										<>
											<Link className="dora-back" to="/">
												<ArrowLeft size={16} />
												返回道具列表
											</Link>
											<Suspense fallback={<DoraemonLoading />}>
												<Detail />
											</Suspense>
										</>
									}
								/>
								<Route
									path="/error"
									element={
										<Suspense fallback={<DoraemonLoading />}>
											<ErrorPage />
										</Suspense>
									}
								/>
								<Route
									path="*"
									element={
										<Suspense fallback={<DoraemonLoading />}>
											<NotFound />
										</Suspense>
									}
								/>
							</Routes>
                            {!isServerList && pageBottom}
						</main>
					</div>
				</DoraemonAppearanceProvider>
                </NetworkRateContext.Provider>
			</AppearanceProvider>
		</ErrorBoundary>
	);
}
