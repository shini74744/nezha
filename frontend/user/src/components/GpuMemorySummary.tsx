import { useTranslation } from "react-i18next";
import { formatBytes } from "@/lib/format";
import type { NezhaGPUStat } from "@/types/nezha-api";

// Adapted from nezha-dash-v2#92. Keep the official per-card MiB contract;
// the parent chooses live state or the recorded snapshot, never a mixture.
export default function GpuMemorySummary({
	memory,
	recorded = false,
}: {
	memory?: NezhaGPUStat;
	recorded?: boolean;
}) {
	const { t } = useTranslation();
	const total = memory?.memory_total;
	// The dashboard's uint64 JSON field uses omitempty: absent used + valid
	// total means idle (zero), while absent/zero total means unsupported.
	const used = memory?.memory_used === undefined ? 0 : memory.memory_used;
	if (
		typeof total !== "number" ||
		!Number.isSafeInteger(total) ||
		total <= 0 ||
		total > Number.MAX_SAFE_INTEGER / 1024 ** 2 ||
		typeof used !== "number" ||
		!Number.isSafeInteger(used) ||
		used < 0 ||
		used > total
	) {
		return null;
	}

	return (
		<div
			data-gpu-memory={recorded ? "recorded" : "live"}
			className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
		>
			<span>
				{t(
					recorded
						? "serverDetailChart.gpuMemoryRecorded"
						: "serverDetailChart.gpuMemory",
				)}
			</span>
			<span className="min-w-0 break-words tabular-nums">
				{formatBytes(used * 1024 ** 2)} / {formatBytes(total * 1024 ** 2)}
				{" · "}
				{((used / total) * 100).toFixed(1)}%
			</span>
		</div>
	);
}
