import { speedEffect } from "@appearance/site/speed-effect";
import type { SpeedDirection } from "@appearance/site/speed-color";
import { useDoraFeature } from "./Appearance";
import "@appearance/site/rate.css";
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
