import type { SpeedDirection } from "./speed-color";

// Keep the default theme's thresholds in raw bytes/second, independent of display units.
export function speedEffect(bytes: number, direction: SpeedDirection, overview = false) {
 const n = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
 const level = overview
  ? n > 104857600 ? 5 : n > 62914560 ? 4 : n > 41943040 ? 3 : n > 20971520 ? 2 : n > 0 ? 1 : 0
  : n > 31457280 ? 3 : n > 20971520 ? 2 : n > 10485760 ? 1 : 0;
 const className = overview
  ? "nz-overview-speed-" + level + (direction === "down" ? "-dl" : "")
  : "nz-" + (direction === "up" ? "upload" : "download") + "-boost-" + level;
 return {level,className};
}
