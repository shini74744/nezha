import { createContext } from "react";
// Optional presentation-only formatter. No provider preserves existing theme units.
// Input is always raw bytes/second, including historical samples.
export const NetworkRateContext = createContext<
	((bytesPerSecond: number) => string) | null
>(null);
