import { useSyncExternalStore } from "react";
// Resolved background branch also determines the original desktop peak-cut default.
let peakCut = false;
const listeners = new Set<() => void>();
export function setBackgroundPeakCut(value: boolean) {
	if (peakCut !== value) {
		peakCut = value;
		for (const listener of listeners) listener();
	}
}
export function useBackgroundPeakCut() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => peakCut,
		() => false,
	);
}
