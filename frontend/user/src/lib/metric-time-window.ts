import type { XAxisProps } from "recharts";
import type { MetricPeriod } from "@/types/nezha-api";

const days: Record<MetricPeriod, number> = { "1d": 1, "7d": 7, "30d": 30 };
const clock = new Intl.DateTimeFormat("zh-CN", {
 timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
 hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function metricTimeWindow(period: string, now: number): [number, number] | undefined {
 if (!(period in days) || !Number.isFinite(now)) return undefined;
 return [now - days[period as MetricPeriod] * 86400000, now];
}
export function metricTimeAxis(period: string, now: number): Pick<XAxisProps, "type" | "domain" | "ticks" | "allowDataOverflow" | "tickFormatter"> {
 const domain = metricTimeWindow(period, now);
 return domain ? {
  type: "number", domain, ticks: domain, allowDataOverflow: true,
  tickFormatter: value => clock.format(Number(value)),
 } : {};
}
