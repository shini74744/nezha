import type { FeatureScope } from "../scope";

export type Pose = { r: number; y: number };
export const SPRING_DURATION = 1600;
const rest: Pose = { r: 0, y: 0 };
export function springPose(start: Pose, elapsed: number): Pose {
	const t = Math.max(0, elapsed) / 1000;
	if (elapsed >= SPRING_DURATION) return { ...rest };
	const decay = Math.exp(-4.8 * t);
	return {
		r: start.r * decay * Math.cos(14 * t),
		y: start.y * decay * Math.cos(17 * t),
	};
}
export const artworkTransform = ({ r, y }: Pose) =>
	"rotate(" + r + "deg) translate3d(" + r + "px, " + y + "px, 0)";
export function rodTransform({ r, y }: Pose, size: number, controls: boolean) {
	const angle = (r * Math.PI) / 180,
		radius = size * 0.6;
	const x =
		Math.sin(angle) * radius + Math.cos(angle) * r - Math.sin(angle) * y;
	const endY =
		-Math.cos(angle) * radius + Math.cos(angle) * y + Math.sin(angle) * r;
	const startY = controls ? -10 : 10;
	const dy = endY - startY;
	return (
		"translateX(-50%) rotate(" +
		Math.atan2(x, -dy) +
		"rad) scaleY(" +
		Math.hypot(x, dy) / size +
		")"
	);
}

// Keep Sakana's artwork and controls, but own motion through public DOM/events.
// Dragging reads geometry once and batches writes; the spring runs on the
// compositor instead of competing with live monitoring renders on every frame.
export function bindSakanaMotion(
	scope: FeatureScope,
	host: HTMLElement,
	controls: boolean,
) {
	const image = host.querySelector<HTMLElement>(".sakana-widget-img")!;
	const app = host.querySelector<HTMLElement>(".sakana-widget-app")!;
	const main = host.querySelector<HTMLElement>(".sakana-widget-main")!;
	const nativeCanvas = host.querySelector<HTMLElement>(".sakana-widget-canvas");
	if (nativeCanvas) nativeCanvas.style.display = "none";
	const rod = document.createElement("span");
	rod.className = "nz-sakana-rod";
	rod.setAttribute("aria-hidden", "true");
	Object.assign(rod.style, {
		position: "absolute",
		left: "50%",
		width: "10px",
		borderRadius: "999px",
		backgroundColor: "#b4b4b4",
		transformOrigin: "50% 100%",
		pointerEvents: "none",
	});
	app.append(rod);
	Object.assign(image.style, {
		willChange: "transform",
		transition: "none",
		touchAction: "none",
		userSelect: "none",
	});
	rod.style.willChange = "transform";
	const reduce = matchMedia("(prefers-reduced-motion: reduce)");
	let size = main.offsetWidth || 200,
		pose = { ...rest },
		origin = { ...rest };
	let pointer: number | null = null,
		downX = 0,
		downY = 0,
		frame = 0;
	let pending: Pose | null = null,
		auto = false,
		timer = 0,
		disposed = false;
	let spring: { start: Pose; image: Animation; rod: Animation } | undefined;

	const paint = (next: Pose) => {
		pose = next;
		image.style.transform = artworkTransform(next);
		rod.style.transform = rodTransform(next, size, controls);
	};
	const stopSpring = () => {
		if (!spring) return;
		const next = springPose(
			spring.start,
			Number(spring.image.currentTime) || 0,
		);
		spring.image.onfinish = null;
		spring.image.cancel();
		spring.rod.cancel();
		spring = undefined;
		paint(next);
	};
	const stopFrame = () => {
		scope.cancelAnimationFrame(frame);
		frame = 0;
		pending = null;
	};
	const flush = () => {
		frame = 0;
		if (pending && !disposed) {
			paint(pending);
			pending = null;
		}
	};
	const scheduleAuto = () => {
		scope.clearTimeout(timer);
		timer = 0;
		if (!auto || disposed || document.hidden || reduce.matches) return;
		timer = scope.setTimeout(
			() => {
				timer = 0;
				if (pointer === null)
					rebound({
						r: (Math.random() - 0.5) * 45,
						y: (Math.random() - 0.5) * 55,
					});
				scheduleAuto();
			},
			2000 + Math.random() * 3000,
		);
	};
	const rebound = (start = pose) => {
		stopSpring();
		stopFrame();
		paint(start);
		if (
			reduce.matches ||
			document.hidden ||
			Math.max(Math.abs(start.r), Math.abs(start.y)) < 0.05
		) {
			paint({ ...rest });
			return;
		}
		if (!image.animate || !rod.animate) {
			paint({ ...rest });
			return;
		}
		const samples = Array.from({ length: 97 }, (_, i) =>
			springPose(start, (i * SPRING_DURATION) / 96),
		);
		const options: KeyframeAnimationOptions = {
			duration: SPRING_DURATION,
			easing: "linear",
			fill: "none",
		};
		const imageAnimation = image.animate(
			samples.map((p) => ({ transform: artworkTransform(p) })),
			options,
		);
		const rodAnimation = rod.animate(
			samples.map((p) => ({ transform: rodTransform(p, size, controls) })),
			options,
		);
		spring = { start, image: imageAnimation, rod: rodAnimation };
		// The resting inline pose also covers throttled finish events in background tabs.
		paint({ ...rest });
		imageAnimation.onfinish = () => {
			if (spring?.image === imageAnimation) {
				imageAnimation.onfinish = null;
				imageAnimation.cancel();
				rodAnimation.cancel();
				spring = undefined;
			}
		};
	};
	const clearPointer = () => {
		const id = pointer;
		pointer = null;
		if (id !== null && image.hasPointerCapture(id))
			image.releasePointerCapture(id);
	};
	const down = (event: PointerEvent) => {
		if (event.button !== 0 || !event.isPrimary || pointer !== null || disposed)
			return;
		event.preventDefault();
		stopSpring();
		stopFrame();
		// No geometry reads while pointermove events are arriving.
		size = main.offsetWidth || size;
		origin = { ...pose };
		downX = event.clientX;
		downY = event.clientY;
		pointer = event.pointerId;
		image.setPointerCapture(event.pointerId);
		scope.clearTimeout(timer);
		timer = 0;
	};
	const move = (event: PointerEvent) => {
		if (event.pointerId !== pointer || disposed) return;
		const maxR = Math.min(60, Math.max(30, size / 5));
		pending = {
			r: Math.max(
				-maxR,
				Math.min(maxR, origin.r + (event.clientX - downX) * 0.1),
			),
			y: Math.max(
				-size / 4,
				Math.min(size / 4, origin.y + (event.clientY - downY) * 0.2),
			),
		};
		if (!frame) frame = scope.requestAnimationFrame(flush);
	};
	const up = (event: PointerEvent) => {
		if (event.pointerId !== pointer) return;
		move(event);
		scope.cancelAnimationFrame(frame);
		flush();
		stopFrame();
		clearPointer();
		rebound();
		scheduleAuto();
	};
	const cancel = () => {
		clearPointer();
		stopFrame();
		stopSpring();
		paint({ ...rest });
		scheduleAuto();
	};
	const resize = () => {
		const next = main.offsetWidth || size;
		if (next !== size) {
			cancel();
			size = next;
		}
		rod.style.height = size + "px";
		rod.style.top = (controls ? -10 : 10) + "px";
		if (!spring) paint(pose);
	};
	const observer = new ResizeObserver(resize);
	observer.observe(main);
	resize();
	scope.listen(image, "pointerdown", down as EventListener);
	scope.listen(image, "pointermove", move as EventListener);
	scope.listen(image, "pointerup", up as EventListener);
	scope.listen(image, "pointercancel", cancel);
	scope.listen(image, "lostpointercapture", () => {
		if (pointer !== null) cancel();
	});
	scope.listen(window, "blur", cancel);
	scope.listen(window, "resize", cancel);
	scope.listen(document, "visibilitychange", () => {
		cancel();
		scheduleAuto();
	});
	scope.listen(reduce, "change", () => {
		cancel();
		scheduleAuto();
	});

	const setAuto = (enabled: boolean) => {
		auto = enabled;
		const button = host.querySelector<HTMLElement>('[title="Auto Mode"]');
		button?.setAttribute("aria-pressed", String(auto));
		host
			.querySelector(".sakana-widget-ctrl-item:nth-child(2) svg")
			?.classList.toggle("sakana-widget-icon--rotate", auto && !reduce.matches);
		scheduleAuto();
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		auto = false;
		clearPointer();
		stopFrame();
		stopSpring();
		scope.clearTimeout(timer);
		observer.disconnect();
		rod.remove();
	};
	scope.own(dispose);
	return {
		rebound,
		cancel,
		setAuto,
		toggleAuto: () => setAuto(!auto),
		dispose,
	};
}
