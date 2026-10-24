// Paint text at the actual display density and centre its visible body.
// The original DOM text owns layout, wrapping, selection and accessibility.
const elements = new Set<HTMLElement>();
const pending = new Set<HTMLElement>();
let frame = 0;
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
type Raster = {
	canvas: HTMLCanvasElement;
	top: number;
	bottom: number;
	body: number;
};
const cache = new Map<string, Raster>();
const painted = new WeakMap<HTMLElement, { image: Raster; key: string }>();

// Uniform ink quantiles reject sparse antialiasing/ornamental tails without
// language-specific character lists, label overrides, or font-specific offsets.
export function visibleBody(
	rows: readonly number[],
): [number, number] | undefined {
	const total = rows.reduce((a, b) => a + b, 0);
	if (!Number.isFinite(total) || total <= 0) return;
	const threshold = total * 0.04;
	let top = 0,
		bottom = rows.length - 1,
		sum = 0;
	while (top < bottom && sum + rows[top] <= threshold) sum += rows[top++];
	sum = 0;
	while (bottom > top && sum + rows[bottom] <= threshold) sum += rows[bottom--];
	return [top, bottom + 1];
}

function textLines(node: Text): string[] {
	const range = document.createRange(),
		lines: { top: number; text: string }[] = [];
	let offset = 0;
	for (const character of node.data) {
		range.setStart(node, offset);
		offset += character.length;
		range.setEnd(node, offset);
		const rect = range.getBoundingClientRect();
		if (!rect.height) continue;
		const line = lines.find(
			(item) => Math.abs(item.top - rect.top) < rect.height / 2,
		);
		if (line) line.text += character;
		else lines.push({ top: rect.top, text: character });
	}
	range.detach();
	return lines.sort((a, b) => a.top - b.top).map((line) => line.text);
}

function raster(
	lines: string[],
	style: CSSStyleDeclaration,
	density: number,
	width: number,
): Raster | undefined {
	const size = parseFloat(style.fontSize) * density;
	const lineHeight = parseFloat(style.lineHeight) * density;
	const font =
		style.fontStyle +
		" " +
		style.fontWeight +
		" " +
		size +
		"px " +
		style.fontFamily;
	const key = JSON.stringify([
		lines,
		font,
		lineHeight,
		width,
		style.color,
		style.letterSpacing,
		style.wordSpacing,
		style.direction,
		style.fontKerning,
	]);
	const existing = cache.get(key);
	if (existing) return existing;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = Math.ceil(size * 4 + lineHeight * (lines.length - 1) + 8);
	if (width < 1 || width > 8192 || canvas.height > 4096) return;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return;
	ctx.font = font;
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "center";
	ctx.direction = style.direction === "rtl" ? "rtl" : "ltr";
	ctx.fontKerning = style.fontKerning as CanvasFontKerning;
	ctx.letterSpacing = (parseFloat(style.letterSpacing) || 0) * density + "px";
	if ("wordSpacing" in ctx)
		ctx.wordSpacing = (parseFloat(style.wordSpacing) || 0) * density + "px";
	ctx.fillStyle = style.color;
	const baseline = Math.ceil(size * 2) + 4;
	for (let i = 0; i < lines.length; i++)
		ctx.fillText(lines[i], width / 2, baseline + i * lineHeight, width);
	let pixels: Uint8ClampedArray;
	try {
		pixels = ctx.getImageData(0, 0, width, canvas.height).data;
	} catch {
		return;
	} // Privacy modes retain ordinary readable DOM text.
	const rows = new Array<number>(canvas.height).fill(0);
	let top = canvas.height,
		bottom = 0;
	for (let y = 0; y < canvas.height; y++)
		for (let x = 0; x < width; x++) {
			const alpha = pixels[(y * width + x) * 4 + 3];
			rows[y] += alpha;
			if (alpha > 0) {
				top = Math.min(top, y);
				bottom = Math.max(bottom, y + 1);
			}
		}
	const band = visibleBody(rows);
	if (!band) return;
	const result = { canvas, top, bottom, body: (band[0] + band[1]) / 2 };
	if (cache.size >= 256) cache.delete(cache.keys().next().value!);
	cache.set(key, result);
	return result;
}

function paintElement(element: HTMLElement) {
	const badge = element.parentElement;
	const canvas = element.querySelector<HTMLCanvasElement>(
		":scope > canvas[data-badge-paint]",
	);
	const node = Array.from(element.childNodes).find(
		(n) => n.nodeType === Node.TEXT_NODE,
	) as Text | undefined;
	if (!element.isConnected || !badge || !canvas || !node?.data.trim()) return;
	const rect = element.getBoundingClientRect(),
		box = badge.getBoundingClientRect();
	if (!rect.width || !rect.height) return;
	const style = getComputedStyle(element);
	const scale = rect.height / parseFloat(style.height),
		dpr = window.devicePixelRatio || 1;
	if (!Number.isFinite(scale) || scale <= 0) return;
	const density = scale * dpr,
		width = Math.max(1, Math.round(rect.width * dpr));
	// Use whole CSS and device-pixel extents to avoid the browser's two-stage
	// bitmap rounding at fractional zoom. Transparent padding is clipped by the badge.
	const quantum =
		Array.from({ length: 64 }, (_, i) => i + 1).find(
			(n) => Math.abs(n * dpr - Math.round(n * dpr)) < 0.00001,
		) || 1;
	const left = Math.floor(rect.left / quantum) * quantum,
		top = Math.floor(box.top / quantum) * quantum;
	const displayWidth = Math.ceil((rect.right - left) / quantum) * quantum;
	const displayHeight = Math.ceil((box.bottom - top) / quantum) * quantum;
	const outputWidth = Math.round(displayWidth * dpr),
		height = Math.round(displayHeight * dpr);
	const lines =
		rect.height <= parseFloat(style.lineHeight) * scale + 0.1
			? [node.data]
			: textLines(node);
	if (!lines.length) return;
	const image = raster(lines, style, density, width);
	if (!image) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	// Align the canvas origin and dimensions to display pixels, independently
	// of the icon and of the text line box. No fractional bitmap resampling.
	const originX = left * dpr,
		originY = top * dpr;
	const center = (box.top + box.height / 2) * dpr - originY;
	let y = Math.round(center - image.body);
	y = Math.max(-image.top, Math.min(height - image.bottom, y));
	const key = JSON.stringify([
		outputWidth,
		height,
		displayWidth / scale,
		displayHeight / scale,
		(originX / dpr - box.left) / scale,
		(originY / dpr - box.top) / scale,
		Math.round(rect.left * dpr - originX),
		y,
	]);
	const previous = painted.get(element);
	if (
		element.dataset.badgePainted &&
		previous?.image === image &&
		previous.key === key
	)
		return () => {};
	return () => {
		canvas.width = outputWidth;
		canvas.height = height;
		canvas.style.width = displayWidth / scale + "px";
		canvas.style.height = displayHeight / scale + "px";
		canvas.style.left = (originX / dpr - box.left) / scale + "px";
		canvas.style.top = (originY / dpr - box.top) / scale + "px";
		ctx.drawImage(image.canvas, Math.round(rect.left * dpr - originX), y);
		element.dataset.badgePainted = "true";
		painted.set(element, { image, key });
	};
}
function flush() {
	frame = 0;
	const targets = Array.from(pending);
	pending.clear();
	// Measure all labels before mutating layout; avoid one forced reflow per badge.
	const actions = targets.map((element) => {
		try {
			return paintElement(element);
		} catch {
			return undefined;
		}
	});
	for (let i = 0; i < targets.length; i++) {
		try {
			if (actions[i]) {
				actions[i]!();
				continue;
			}
		} catch {
			/* Native-text fallback below. */
		}
		delete targets[i].dataset.badgePainted;
	}
}
function schedule(element?: HTMLElement) {
	if (element) pending.add(element);
	else for (const item of elements) pending.add(item);
	if (!frame && pending.size) frame = requestAnimationFrame(flush);
}
export const refreshBadgeText = (element: HTMLElement) => schedule(element);
const refresh = () => {
	cache.clear();
	schedule();
};
const onScroll = () => {
	for (const element of elements) {
		const r = element.getBoundingClientRect();
		if (r.bottom >= 0 && r.top <= innerHeight) schedule(element);
	}
};
function connect() {
	if (typeof ResizeObserver !== "undefined")
		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const target = entry.target as HTMLElement;
				const element = elements.has(target)
					? target
					: target.querySelector<HTMLElement>("[data-plan-badge-text]");
				if (element && elements.has(element)) schedule(element);
			}
		});
	mutationObserver = new MutationObserver(refresh);
	mutationObserver.observe(document.head, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	mutationObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class", "style"],
	});
	if (document.body)
		mutationObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class", "style"],
		});
	window.addEventListener("resize", refresh);
	window.addEventListener("scroll", onScroll, { passive: true, capture: true });
	document.fonts?.addEventListener("loadingdone", refresh);
	document.fonts?.addEventListener("loadingerror", refresh);
	void document.fonts?.ready.then(refresh);
}
export function observeBadgeText(element: HTMLElement): () => void {
	if (!elements.size) connect();
	elements.add(element);
	resizeObserver?.observe(element);
	if (element.parentElement) resizeObserver?.observe(element.parentElement);
	schedule(element);
	return () => {
		elements.delete(element);
		pending.delete(element);
		resizeObserver?.unobserve(element);
		if (element.parentElement) resizeObserver?.unobserve(element.parentElement);
		if (!elements.size) {
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
			window.removeEventListener("resize", refresh);
			window.removeEventListener("scroll", onScroll, true);
			document.fonts?.removeEventListener("loadingdone", refresh);
			document.fonts?.removeEventListener("loadingerror", refresh);
			cancelAnimationFrame(frame);
			frame = 0;
			cache.clear();
		}
	};
}
