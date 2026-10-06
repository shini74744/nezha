// Automatic records use their scheduled UTC+8 slot; manual records keep the real time.
export function formatDetectionTime(value?: number, scheduled = false) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: scheduled ? "Asia/Shanghai" : undefined,
    hourCycle: "h23",
  });
}
