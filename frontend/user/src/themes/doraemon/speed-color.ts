import type { CSSProperties } from "react";
import { speedColor, type SpeedDirection } from "@/appearance/speed-color";
import { useDoraFeature } from "./Appearance";

export function useDoraRateColor() {
 const enabled = useDoraFeature("speedColor");
 return (bytes: number, direction: SpeedDirection, overview = false) => enabled ? {
  "data-dora-rate-color": direction,
  style: { "--dora-rate-color": speedColor(bytes, direction, overview) } as CSSProperties,
 } : {};
}
