import { describe, it, expect } from "vitest";
import {
	NetworkScene,
	type NetworkContext,
	type NetworkPoint,
	type NetworkPointer,
} from "../../../../appearance/site/modules/network-scene";
function seeded() {
	let n = 15221;
	return () => {
		n = (n * 1664525 + 1013904223) >>> 0;
		return n / 4294967296;
	};
}
function context() {
	const calls: unknown[] = [];
	const c = {
		canvas: { width: 0, height: 0 },
		lineWidth: 1,
		strokeStyle: "",
		clearRect: () => {},
		setTransform: () => {},
		fillRect: (...p: number[]) => calls.push(["point", ...p]),
		beginPath: () => {},
		moveTo: (...p: number[]) => calls.push(["from", ...p]),
		lineTo: (...p: number[]) => calls.push(["to", ...p]),
		stroke: () => calls.push(["stroke", c.lineWidth, c.strokeStyle]),
	};
	return { ctx: c as unknown as NetworkContext, calls };
}
function reference(
	points: NetworkPoint[],
	cursor: NetworkPointer,
	ctx: NetworkContext,
	width: number,
	height: number,
) {
	points.forEach((p, i) => {
		p.x += p.vx;
		p.y += p.vy;
		if (p.x > width || p.x < 0) p.vx *= -1;
		if (p.y > height || p.y < 0) p.vy *= -1;
		ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
		for (let j = i + 1; j <= points.length; j++) {
			const other = j === points.length ? cursor : points[j];
			if (!other) continue;
			const max = j === points.length ? 20000 : 12000,
				dx = p.x - other.x,
				dy = p.y - other.y,
				d = dx * dx + dy * dy;
			if (d >= max) continue;
			if (j === points.length && d >= max / 2) {
				p.x -= dx * 0.03;
				p.y -= dy * 0.03;
			}
			const strength = (max - d) / max;
			ctx.beginPath();
			ctx.lineWidth = strength / 2;
			ctx.strokeStyle = "rgba(12,34,56," + (strength + 0.2) + ")";
			ctx.moveTo(p.x, p.y);
			ctx.lineTo(other.x, other.y);
			ctx.stroke();
		}
	});
}
describe("network appearance and neighbor search", () => {
	it("matches every legacy point, line, width, alpha and cursor attraction across frames", () => {
		const a = context(),
			b = context(),
			scene = new NetworkScene(
				a.ctx,
				640,
				480,
				{ count: 200, color: "12,34,56" },
				seeded(),
			);
		const points = structuredClone(scene.points);
		for (let frame = 0; frame < 30; frame++) {
			scene.pointer =
				frame % 7 === 0 ? null : { x: 200 + frame * 8, y: 180 + frame * 3 };
			a.calls.length = 0;
			b.calls.length = 0;
			scene.frame();
			reference(points, scene.pointer, b.ctx, 640, 480);
			expect(a.calls).toEqual(b.calls);
			expect(scene.points).toEqual(points);
		}
	});
	it("reduces sparse distance comparisons without dropping nodes or valid links", () => {
		const a = context(),
			b = context(),
			scene = new NetworkScene(
				a.ctx,
				1920,
				1080,
				{ count: 200, color: "12,34,56" },
				seeded(),
			);
		const points = structuredClone(scene.points),
			stats = scene.frame();
		reference(points, null, b.ctx, 1920, 1080);
		expect(stats.points).toBe(200);
		expect(stats.checks).toBeLessThan(2000);
		expect(a.calls).toEqual(b.calls);
		console.log(
			"network-pairs",
			JSON.stringify({
				legacy: 19900,
				optimized: stats.checks,
				lines: stats.lines,
			}),
		);
	});
	it("preserves dense clusters and links across cell boundaries and outside the viewport", () => {
		const a = context(),
			b = context(),
			scene = new NetworkScene(
				a.ctx,
				320,
				240,
				{ count: 200, color: "12,34,56" },
				seeded(),
			);
		scene.points.forEach((p, i) => {
			p.x = i % 2 ? -1 : 109.55;
			p.y = i % 3 ? -1 : 109.55;
			p.vx = 0.9;
			p.vy = -0.8;
		});
		const points = structuredClone(scene.points);
		scene.pointer = { x: 0, y: 0 };
		scene.frame();
		reference(points, scene.pointer, b.ctx, 320, 240);
		expect(a.calls).toEqual(b.calls);
	});
	it("keeps the full device pixel ratio and safely redraws after resizing", () => {
		const a = context(),
			scene = new NetworkScene(
				a.ctx,
				600,
				400,
				{ count: 20, color: "12,34,56" },
				seeded(),
			);
		scene.resize(1200, 800, 3);
		expect(a.ctx.canvas.width).toBe(3600);
		expect(a.ctx.canvas.height).toBe(2400);
		expect(scene.frame().points).toBe(20);
	});
});
