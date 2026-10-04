export type SpeedDirection = "up" | "down";

// Shared by the default and Doraemon themes; input is always raw bytes/second.
export function speedColor(bytes: number, direction: SpeedDirection, overview = false) {
 const n = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
 const strength = overview
  ? Math.min(Math.pow(n / 104857600, 0.4), 1)
  : Math.min(Math.log10(n + 1) / Math.log10(31457281), 1);
 const p = Math.round((1 - strength) * (overview ? 200 : 255));
 return direction === "up" ? "rgb(255," + p + "," + p + ")" : "rgb(" + p + "," + p + ",255)";
}
