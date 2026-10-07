import { createContext } from "react";
// Optional theme-specific formatter; otherwise charts follow default-theme speed preferences.
// Input is always raw bytes/second, including historical samples.
export const NetworkRateContext = createContext<
	((bytesPerSecond: number) => string) | null
>(null);
