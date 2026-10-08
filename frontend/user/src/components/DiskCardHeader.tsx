import { ArrowLeftRight } from "lucide-react";

export function DiskModeToggle({
	io,
	onToggle,
	capacityLabel = "磁盘",
}: {
	io: boolean;
	onToggle: () => void;
	capacityLabel?: string;
}) {
	return (
		<button
			type="button"
			aria-label={`点击切换到${io ? "磁盘占用" : "磁盘读写"}`}
			aria-pressed={io}
			onClick={onToggle}
			className="inline-flex shrink-0 cursor-pointer touch-manipulation items-center gap-1.5 rounded-sm text-left text-md font-medium outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
		>
			{io ? "磁盘读写" : capacityLabel}
			<ArrowLeftRight
				aria-hidden="true"
				className="size-3 shrink-0 text-muted-foreground"
			/>
		</button>
	);
}

export function DiskIORates({ read, write }: { read: string; write: string }) {
	return (
		<div
			data-disk-rates
			className="grid shrink-0 grid-cols-[2em_13ch] items-center gap-x-1 gap-y-0.5 whitespace-nowrap text-[11px] font-medium tabular-nums"
		>
			<span data-disk-rate-label="read" className="text-blue-500">
				读取
			</span>
			<span data-disk-rate-value="read" className="text-right">
				{read}
			</span>
			<span data-disk-rate-label="write" className="text-purple-500">
				写入
			</span>
			<span data-disk-rate-value="write" className="text-right">
				{write}
			</span>
		</div>
	);
}
