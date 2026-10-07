// Start these imports together on detail entry, instead of waiting for each
// deferred pane (and then its nested chart) to render.
import { preloadableView } from "./preloadable-view";
export const { load: loadServerConnectivity, View: PreloadedServerConnectivity } = preloadableView(() => import("@/components/ServerConnectivity"));
export const { load: loadServerNetworkInsight, View: PreloadedServerNetworkInsight } = preloadableView(() => import("@/components/ServerNetworkInsight"));
export const { load: loadBGPTopology, View: PreloadedBGPTopology } = preloadableView(() => import("@/components/BGPTopology"));
export const loadServerDetailChart = () => import("@/components/ServerDetailChart");
export const loadServerNetworkSection = () => import("@/components/ServerNetworkSection");
export const loadNetworkChart = () =>
	import("@/components/NetworkChart").then((module) => ({ default: module.NetworkChart }));
