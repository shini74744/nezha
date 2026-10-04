import { speedEffect } from "@/appearance/speed-effect";
import type { SpeedDirection } from "@/appearance/speed-color";
import { useDoraFeature } from "./Appearance";
import "@/appearance/rate.css";
import "./rate-effects.css";

export function useDoraRateEffect() {
 const enabled = useDoraFeature("speedAnimation");
 return (bytes: number, direction: SpeedDirection, overview = false) => {
  const {level,className}=speedEffect(bytes,direction,overview);
  // Overview level 1 intentionally has no animation, matching the default theme.
  return enabled && level > (overview ? 1 : 0) ? {
   "data-dora-rate-effect":direction,
   "data-dora-rate-level":level,
   className,
  } : {};
 };
}
