import { Text, usePlotArea } from "recharts";

type Props = {
 x?: number; y?: number; index?: number; visibleTicksCount?: number;
 payload?: { value: string | number };
 tickFormatter?: (value: string | number, index: number) => string;
 fill?: string; verticalAnchor?: "start" | "middle" | "end";
};
// Keep endpoint labels at the edges, leaving the center of the time axis
// available for the detail control, including a chart with only one sample.
export default function MetricTimeTick({
 y, index = 0, visibleTicksCount = 1, payload, tickFormatter,
 fill = "#666", verticalAnchor = "start",
}: Props) {
 const plot = usePlotArea();
 if (!plot || !payload || y === undefined) return null;
 if (index !== 0 && index !== visibleTicksCount - 1) return null;
 const first = index === 0;
 return <Text className="recharts-cartesian-axis-tick-value" data-metric-time-tick
  x={first ? plot.x : plot.x + plot.width} y={y}
  textAnchor={first ? "start" : "end"} verticalAnchor={verticalAnchor} fill={fill}>
  {tickFormatter ? tickFormatter(payload.value, index) : payload.value}
 </Text>;
}
