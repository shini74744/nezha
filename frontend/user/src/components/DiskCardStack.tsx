import type { ReactNode } from "react";

export default function DiskCardStack({ children }: { children: ReactNode }) {
	return (
		<div className="relative isolate min-w-0" data-disk-stack>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-3 -top-1.5 h-6 rounded-t-xl border border-border/60 bg-card/60 shadow-sm"
			/>
			<div className="relative">{children}</div>
		</div>
	);
}
