export type NetworkNode = { code: string; point: number[]; online: number };
// Decorative paths between online regions, never asserted to be real network routes.
export function makeNetworkLinks(nodes: NetworkNode[]) {
	const sorted = nodes
		.filter((n) => n.online > 0 && n.point.every(Number.isFinite))
		.slice()
		.sort((a, b) => b.online - a.online || a.code.localeCompare(b.code));
	const hub = sorted[0];
	if (!hub) return [];
	return sorted.slice(1, 19).map((node) => {
		const [x1, y1] = hub.point,
			[x2, y2] = node.point;
		const bend = Math.min(100, Math.hypot(x2 - x1, y2 - y1) * 0.24);
		return {
			key: hub.code + "-" + node.code,
			d: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.max(30, (y1 + y2) / 2 - bend)} ${x2} ${y2}`,
		};
	});
}
export function DoraNetwork({ nodes }: { nodes: NetworkNode[] }) {
	const links = makeNetworkLinks(nodes);
	return (
		// biome-ignore lint/a11y/noAriaHiddenOnFocusable: Decorative SVG paths have no focus targets, handlers, or labels.
		<g className="dora-network" aria-hidden="true" pointerEvents="none">
			{links.map((link, i) => (
				<g
					key={link.key}
					style={{ "--flow-delay": `${-i * 0.7}s` } as React.CSSProperties}
				>
					<path d={link.d} className="dora-network-track" />
					<path
						d={link.d}
						pathLength={100}
						className="dora-network-flow upload"
					/>
					<path
						d={link.d}
						pathLength={100}
						className="dora-network-flow download"
					/>
				</g>
			))}
		</g>
	);
}
