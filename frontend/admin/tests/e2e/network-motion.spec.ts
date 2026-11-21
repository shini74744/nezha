import { test, expect } from "@playwright/test";
const base = process.env.MASCOT_TEST_ORIGIN || "http://127.0.0.1:18485";
async function setup(page: any, features = ["network"], count = 200) {
	await page.goto(base + "/native-test.html");
	await page.waitForFunction(() => !!(window as any).setNativeConfig);
	await page.evaluate(
		({ features, count }: any) =>
			(window as any).setNativeConfig(features, {
				network: { count, color: "0,0,0", opacity: 0.5 },
			}),
		{ features, count },
	);
	await expect(page.locator("#canvas-nest")).toBeVisible();
}
async function renderer(page: any) {
	await expect(page.locator("#canvas-nest")).toHaveAttribute(
		"data-network-renderer",
		"worker",
	);
	return page.workers().find((w: any) => w.url().includes("network.worker"))!;
}
test("worker keeps drawing during main-thread work and maintains full resolution", async ({
	browser,
}) => {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
	});
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await setup(page, ["network", "sakura", "stars"]);
	const worker = await renderer(page);
	await worker.evaluate(() => {
		(self as any).__frames = 0;
		const p = OffscreenCanvasRenderingContext2D.prototype,
			old = p.clearRect;
		p.clearRect = function (...a: any[]) {
			(self as any).__frames++;
			return old.apply(this, a as any);
		};
	});
	await page.evaluate(() => {
		const end = performance.now() + 650;
		while (performance.now() < end) {}
	});
	const frames = await worker.evaluate(() => (self as any).__frames);
	// Prove independent progress, not a frame-rate target on a shared headless host.
	expect(frames).toBeGreaterThan(1);
	expect(
		await page
			.locator("#canvas-nest")
			.evaluate((c: HTMLCanvasElement) => [c.width, c.height]),
	).toEqual([2880, 1800]);
	await expect(page.locator("#canvas-nest")).toHaveCSS("opacity", "0.5");
	expect(errors).toEqual([]);
	console.log("worker-under-main-thread-load", JSON.stringify({ frames }));
	await context.close();
});
test("internal mouse transitions keep attraction, window leave clears it, hidden tabs pause", async ({
	page,
}) => {
	await setup(page);
	const worker = await renderer(page);
	await worker.evaluate(() => {
		(self as any).__pointer = "unset";
		(self as any).__frames = 0;
		const handler = self.onmessage!;
		self.onmessage = function (e) {
			if (e.data.type === "pointer") (self as any).__pointer = e.data.pointer;
			handler.call(self, e);
		};
		const p = OffscreenCanvasRenderingContext2D.prototype,
			old = p.clearRect;
		p.clearRect = function (...a: any[]) {
			(self as any).__frames++;
			return old.apply(this, a as any);
		};
	});
	await page.mouse.move(300, 250);
	await expect
		.poll(() => worker.evaluate(() => (self as any).__pointer))
		.toEqual({ x: 300, y: 250 });
	await page.evaluate(() =>
		window.dispatchEvent(
			new MouseEvent("mouseout", { relatedTarget: document.body }),
		),
	);
	await page.waitForTimeout(100);
	expect(await worker.evaluate(() => (self as any).__pointer)).toEqual({
		x: 300,
		y: 250,
	});
	await page.evaluate(() =>
		window.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null })),
	);
	await expect
		.poll(() => worker.evaluate(() => (self as any).__pointer))
		.toBeNull();
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", {
			configurable: true,
			value: true,
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await page.waitForTimeout(100);
	const n = await worker.evaluate(() => (self as any).__frames);
	await page.waitForTimeout(200);
	expect(await worker.evaluate(() => (self as any).__frames)).toBe(n);
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", {
			configurable: true,
			value: false,
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await expect
		.poll(() => worker.evaluate(() => (self as any).__frames))
		.toBeGreaterThan(n);
});
test("config changes, resize, disable and re-enable release transferred canvases correctly", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await setup(page);
	await renderer(page);
	for (let i = 0; i < 3; i++) {
		await page.evaluate(
			(count) =>
				(window as any).setNativeConfig(["network"], {
					network: { count, color: "12,34,56", opacity: 0.7 },
				}),
			100 + i,
		);
		await renderer(page);
		await expect(page.locator("#canvas-nest")).toHaveCount(1);
		await expect(page.locator("#canvas-nest")).toHaveCSS("opacity", "0.7");
		await page.setViewportSize({ width: 1200 + i * 20, height: 800 });
		await expect
			.poll(() =>
				page
					.locator("#canvas-nest")
					.evaluate((c: HTMLCanvasElement) => c.width),
			)
			.toBe(1200 + i * 20);
	}
	await page.evaluate(() => (window as any).setNativeConfig([]));
	await expect(page.locator("#canvas-nest")).toHaveCount(0);
	await expect
		.poll(
			() =>
				page.workers().filter((w) => w.url().includes("network.worker")).length,
		)
		.toBe(0);
	await page.evaluate(() => (window as any).setNativeConfig(["network"]));
	await renderer(page);
	expect(errors).toEqual([]);
});
test("unsupported workers and worker startup errors fall back to the same canvas renderer", async ({
	page,
}) => {
	await page.addInitScript(() => {
		(window as any).Worker = class {
			constructor() {
				throw new DOMException("Blocked worker", "SecurityError");
			}
		};
	});
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await setup(page);
	await expect(page.locator("#canvas-nest")).toHaveAttribute(
		"data-network-renderer",
		"main",
	);
	await page.mouse.move(400, 300);
	await page.waitForTimeout(100);
	const visible = await page
		.locator("#canvas-nest")
		.evaluate((c: HTMLCanvasElement) =>
			c
				.getContext("2d")!
				.getImageData(0, 0, c.width, c.height)
				.data.some((n, i) => i % 4 === 3 && n > 0),
		);
	expect(visible).toBe(true);
	await page.evaluate(() => (window as any).setNativeConfig([]));
	await expect(page.locator("#canvas-nest")).toHaveCount(0);
	expect(errors).toEqual([]);
});
test("optimized canvas is pixel-identical to the legacy renderer at normal and high DPI", async ({
	page,
}) => {
	await page.goto(base + "/native-test.html");
	const result = await page.evaluate(async () => {
		const { NetworkScene } = await import(
			"/src/appearance/modules/network-scene.ts"
		);
		const results = [];
		for (const dpr of [1, 2]) {
			const first = document.createElement("canvas"),
				second = document.createElement("canvas");
			const a = first.getContext("2d", { willReadFrequently: true })!,
				b = second.getContext("2d", { willReadFrequently: true })!;
			let seed = 15221;
			const random = () => {
				seed = (seed * 1664525 + 1013904223) >>> 0;
				return seed / 4294967296;
			};
			const scene = new NetworkScene(
				a,
				640,
				480,
				{ count: 200, color: "0,0,0" },
				random,
			);
			scene.resize(640, 480, dpr);
			second.width = 640 * dpr;
			second.height = 480 * dpr;
			b.scale(dpr, dpr);
			const points = structuredClone(scene.points);
			for (let frame = 0; frame < 30; frame++) {
				const mouse =
					frame % 7 === 0 ? null : { x: 200 + frame * 8, y: 180 + frame * 3 };
				scene.pointer = mouse;
				scene.frame();
				b.clearRect(0, 0, 640, 480);
				points.forEach((p: any, i: number) => {
					p.x += p.vx;
					p.y += p.vy;
					if (p.x > 640 || p.x < 0) p.vx *= -1;
					if (p.y > 480 || p.y < 0) p.vy *= -1;
					b.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
					for (let j = i + 1; j <= points.length; j++) {
						const q = j === points.length ? mouse : points[j];
						if (!q) continue;
						const max = j === points.length ? 20000 : 12000,
							dx = p.x - q.x,
							dy = p.y - q.y,
							d = dx * dx + dy * dy;
						if (d >= max) continue;
						if (j === points.length && d >= max / 2) {
							p.x -= dx * 0.03;
							p.y -= dy * 0.03;
						}
						const k = (max - d) / max;
						b.beginPath();
						b.lineWidth = k / 2;
						b.strokeStyle = "rgba(0,0,0," + (k + 0.2) + ")";
						b.moveTo(p.x, p.y);
						b.lineTo(q.x, q.y);
						b.stroke();
					}
				});
			}
			const aa = a.getImageData(0, 0, first.width, first.height).data,
				bb = b.getImageData(0, 0, second.width, second.height).data;
			let changed = 0;
			for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) changed++;
			results.push({ dpr, changed, bytes: aa.length });
		}
		return results;
	});
	expect(result.every((r) => r.changed === 0)).toBe(true);
	console.log("network-pixel-parity", JSON.stringify(result));
});

test("worker failure after canvas transfer replaces the canvas and keeps drawing", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await setup(page);
	const worker = await renderer(page);
	const original = await page.locator("#canvas-nest").elementHandle();
	await worker.evaluate(() => self.postMessage({ type: "failed" }));
	await expect(page.locator("#canvas-nest")).toHaveAttribute(
		"data-network-renderer",
		"main",
	);
	expect(await original!.evaluate((node) => node.isConnected)).toBe(false);
	await expect(page.locator("#canvas-nest")).toHaveCount(1);
	await expect
		.poll(
			() =>
				page.workers().filter((w) => w.url().includes("network.worker")).length,
		)
		.toBe(0);
	await expect
		.poll(() =>
			page.locator("#canvas-nest").evaluate((c: HTMLCanvasElement) =>
				c
					.getContext("2d")!
					.getImageData(0, 0, c.width, c.height)
					.data.some((n, i) => i % 4 === 3 && n > 0),
			),
		)
		.toBe(true);
	await page.evaluate(() => (window as any).setNativeConfig([]));
	await expect(page.locator("#canvas-nest")).toHaveCount(0);
	expect(errors).toEqual([]);
});
test("reduced motion and touch devices retain their existing effect exclusions", async ({
	browser,
}) => {
	for (const options of [
		{ reducedMotion: "reduce" as const },
		{
			hasTouch: true,
			isMobile: true,
			userAgent:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
			viewport: { width: 390, height: 844 },
		},
	]) {
		const context = await browser.newContext(options);
		const page = await context.newPage();
		await page.goto(base + "/native-test.html");
		await page.waitForFunction(() => !!(window as any).setNativeConfig);
		await page.evaluate(() => (window as any).setNativeConfig(["network"]));
		await page.waitForTimeout(200);
		await expect(page.locator("#canvas-nest")).toHaveCount(0);
		expect(page.workers()).toHaveLength(0);
		await context.close();
	}
});
