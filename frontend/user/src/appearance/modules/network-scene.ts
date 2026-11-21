export type NetworkPoint = { x: number; y: number; vx: number; vy: number };
export type NetworkPointer = { x: number; y: number } | null;
export type NetworkContext =
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D;
export type NetworkSettings = { count: number; color: string };
const distanceLimit = 12000,
	pointerLimit = 20000,
	cellSize = Math.sqrt(distanceLimit);
const sortIndices = (a: number, b: number) => a - b;
const cellKey = (x: number, y: number) => x * 65536 + y;

// Preserve the original positions, line order, widths, alpha and attraction.
// Only neighboring cells can contain a connected point, so distant pairs do
// not need a distance calculation. Buckets and candidates are reused per frame.
export class NetworkScene {
	readonly points: NetworkPoint[] = [];
	pointer: NetworkPointer = null;
	private grid = new Map<number, number[]>();
	private buckets: number[][] = [];
	private candidates: number[] = [];
	constructor(
		private ctx: NetworkContext,
		private width: number,
		private height: number,
		private settings: NetworkSettings,
		random = Math.random,
	) {
		for (let i = 0; i < settings.count; i++)
			this.points.push({
				x: random() * width,
				y: random() * height,
				vx: random() * 2 - 1,
				vy: random() * 2 - 1,
			});
	}
	resize(width: number, height: number, dpr: number) {
		this.width = width;
		this.height = height;
		this.ctx.canvas.width = width * dpr;
		this.ctx.canvas.height = height * dpr;
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}
	frame() {
		const { ctx, points, width, height, candidates, grid } = this;
		ctx.clearRect(0, 0, width, height);
		grid.clear();
		let bucketCount = 0,
			checks = 0,
			lines = 0;
		for (let i = 0; i < points.length; i++) {
			const p = points[i],
				key = cellKey(Math.floor(p.x / cellSize), Math.floor(p.y / cellSize));
			let bucket = grid.get(key);
			if (!bucket) {
				bucket = this.buckets[bucketCount] || (this.buckets[bucketCount] = []);
				bucketCount++;
				bucket.length = 0;
				grid.set(key, bucket);
			}
			bucket.push(i);
		}
		const draw = (
			p: NetworkPoint,
			x: number,
			y: number,
			squared: number,
			max: number,
		) => {
			const strength = (max - squared) / max;
			ctx.beginPath();
			ctx.lineWidth = strength / 2;
			ctx.strokeStyle =
				"rgba(" + this.settings.color + "," + (strength + 0.2) + ")";
			ctx.moveTo(p.x, p.y);
			ctx.lineTo(x, y);
			ctx.stroke();
			lines++;
		};
		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			p.x += p.vx;
			p.y += p.vy;
			if (p.x > width || p.x < 0) p.vx *= -1;
			if (p.y > height || p.y < 0) p.vy *= -1;
			ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
			const cx = Math.floor(p.x / cellSize),
				cy = Math.floor(p.y / cellSize);
			candidates.length = 0;
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++) {
					const bucket = grid.get(cellKey(cx + dx, cy + dy));
					if (bucket) for (const j of bucket) if (j > i) candidates.push(j);
				}
			candidates.sort(sortIndices);
			for (const j of candidates) {
				const other = points[j],
					dx = p.x - other.x,
					dy = p.y - other.y;
				const squared = dx * dx + dy * dy;
				checks++;
				if (squared < distanceLimit)
					draw(p, other.x, other.y, squared, distanceLimit);
			}
			if (this.pointer) {
				const { x, y } = this.pointer,
					dx = p.x - x,
					dy = p.y - y;
				const squared = dx * dx + dy * dy;
				checks++;
				if (squared < pointerLimit) {
					if (squared >= pointerLimit / 2) {
						p.x -= dx * 0.03;
						p.y -= dy * 0.03;
					}
					draw(p, x, y, squared, pointerLimit);
				}
			}
		}
		return { checks, lines, points: points.length };
	}
}

export type NetworkWorkerMessage =
	| {
			type: "init";
			canvas: OffscreenCanvas;
			width: number;
			height: number;
			dpr: number;
			settings: NetworkSettings;
			visible: boolean;
			pointer: NetworkPointer;
	  }
	| { type: "resize"; width: number; height: number; dpr: number }
	| { type: "pointer"; pointer: NetworkPointer }
	| { type: "visibility"; visible: boolean };
