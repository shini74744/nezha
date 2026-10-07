// Start these imports together on detail entry, instead of waiting for each
// deferred pane (and then its nested chart) to render.
export const loadServerDetailChart = () => import("@/components/ServerDetailChart");
export const loadServerNetworkSection = () => import("@/components/ServerNetworkSection");
export const loadNetworkChart = () =>
	import("@/components/NetworkChart").then((module) => ({ default: module.NetworkChart }));
