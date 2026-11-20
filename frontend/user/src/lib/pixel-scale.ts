import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let scale = 1;
let resolution: MediaQueryList | undefined;

function getScale() {
	const value = typeof window === "undefined" ? 1 : window.devicePixelRatio;
	return Number.isFinite(value) && value > 0 ? value : 1;
}
function watchResolution() {
	resolution?.removeEventListener?.("change", update);
	resolution =
		typeof window.matchMedia === "function"
			? window.matchMedia(`(resolution: ${scale}dppx)`)
			: undefined;
	resolution?.addEventListener?.("change", update);
}
function update() {
	const next = getScale();
	if (next === scale) return;
	scale = next;
	watchResolution();
	for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
	if (!listeners.size) {
		scale = getScale();
		window.addEventListener("resize", update, { passive: true });
		watchResolution();
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (!listeners.size) {
			window.removeEventListener("resize", update);
			resolution?.removeEventListener?.("change", update);
			resolution = undefined;
		}
	};
}

// One shared subscription for all bars; no scroll or per-frame measurements.
export function usePixelAlignedHeight(cssHeight: number) {
	const ratio = useSyncExternalStore(subscribe, getScale, () => 1);
	return Math.max(1, Math.round(cssHeight * ratio)) / ratio;
}
