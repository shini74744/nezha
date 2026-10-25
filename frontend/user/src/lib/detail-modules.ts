// Start these imports together on detail entry, instead of waiting for each
// deferred pane (and then its nested chart) to render.
import { preloadableView } from "./preloadable-view";
export const { load: loadServerConnectivity, View: PreloadedServerConnectivity } = preloadableView(() => import("@/components/ServerConnectivity"));
export const { load: loadServerNetworkInsight, View: PreloadedServerNetworkInsight } = preloadableView(() => import("@/components/ServerNetworkInsight"));
export const { load: loadBGPTopology, View: PreloadedBGPTopology } = preloadableView(() => import("@/components/BGPTopology"));
export const { load: loadServerDetailChart, View: PreloadedServerDetailChart } = preloadableView(() => import("@/components/ServerDetailChart"));
export const { load: loadServerNetworkSection, View: PreloadedServerNetworkSection } = preloadableView(() => import("@/components/ServerNetworkSection"));
export const { load: loadNetworkChart, View: PreloadedNetworkChart } = preloadableView(async () => ({ default: (await import("@/components/NetworkChart")).NetworkChart }));
