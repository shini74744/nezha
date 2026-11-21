import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureScope } from "../appearance/scope";
import {
	bindSakanaMotion,
	springPose,
	SPRING_DURATION,
} from "../appearance/modules/sakana-motion";

describe("Sakana frame-batched dragging", () => {
	let scope: FeatureScope | undefined;
	afterEach(() => {
		scope?.dispose();
		vi.restoreAllMocks();
		Reflect.deleteProperty(Element.prototype, "animate");
		document.body.replaceChildren();
	});
	function setup() {
		const frames = new Map<number, FrameRequestCallback>();
		let serial = 0;
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
			frames.set(++serial, fn);
			return serial;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			frames.delete(id);
		});
		const host = document.createElement("div");
		host.innerHTML =
			'<div class="sakana-widget-app"><canvas class="sakana-widget-canvas"></canvas><div class="sakana-widget-main"><div class="sakana-widget-img"></div></div></div>';
		document.body.append(host);
		const main = host.querySelector<HTMLElement>(".sakana-widget-main")!;
		const image = host.querySelector<HTMLElement>(".sakana-widget-img")!;
		Object.defineProperty(main, "offsetWidth", { get: () => 200 });
		const animations: any[] = [];
		const animate = vi.fn(
			(_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
				const value = { currentTime: 0, cancel: vi.fn(), onfinish: null };
				animations.push(value);
				return value;
			},
		);
		Object.defineProperty(Element.prototype, "animate", {
			configurable: true,
			writable: true,
			value: animate,
		});
		scope = new FeatureScope("live2d");
		const motion = bindSakanaMotion(scope, host, false);
		const dispatch = (type: string, x: number, y: number, id = 7) => {
			const e = new Event(type, { bubbles: true, cancelable: true });
			Object.assign(e, {
				clientX: x,
				clientY: y,
				pointerId: id,
				isPrimary: true,
				button: 0,
			});
			image.dispatchEvent(e);
		};
		const flush = () => {
			const batch = [...frames.values()];
			frames.clear();
			batch.forEach((f) => f(16));
		};
		return {
			host,
			image,
			main,
			frames,
			dispatch,
			flush,
			animations,
			animate,
			motion,
		};
	}
	it("coalesces 1000 movements into one paint without layout reads", () => {
		const s = setup();
		const reads = vi.spyOn(s.main, "getBoundingClientRect");
		s.dispatch("pointerdown", 100, 100);
		const before = s.image.style.transform;
		for (let i = 1; i <= 1000; i++)
			s.dispatch("pointermove", 100 + i / 10, 130);
		expect(s.frames.size).toBe(1);
		expect(s.image.style.transform).toBe(before);
		s.flush();
		expect(s.image.style.transform).toContain("rotate(10deg)");
		expect(s.image.style.transform).toContain("6px");
		expect(reads).not.toHaveBeenCalled();
	});
	it("uses compositor keyframes after release and cleans up on disposal", () => {
		const s = setup();
		s.dispatch("pointerdown", 100, 100);
		s.dispatch("pointermove", 180, 140);
		s.flush();
		s.dispatch("pointerup", 180, 140);
		expect(s.animate).toHaveBeenCalledTimes(2);
		expect(s.animate.mock.calls[0][0]).toHaveLength(97);
		expect(s.animate.mock.calls[0][1]).toMatchObject({
			duration: SPRING_DURATION,
		});
		s.flush();
		expect(s.frames.size).toBe(0);
		scope!.dispose();
		expect(s.animations.every((a) => a.cancel.mock.calls.length === 1)).toBe(
			true,
		);
		expect(s.host.querySelector(".nz-sakana-rod")).toBeNull();
	});
	it("resumes dragging from the current rebound pose without snapping", () => {
		const s = setup();
		s.dispatch("pointerdown", 100, 100);
		s.dispatch("pointerup", 200, 150);
		s.animations[0].currentTime = 120;
		const expected = springPose({ r: 10, y: 10 }, 120);
		s.dispatch("pointerdown", 300, 300);
		s.dispatch("pointermove", 300, 300);
		s.flush();
		expect(s.image.style.transform).toContain("rotate(" + expected.r + "deg)");
	});
	it("ignores other pointers and cancels dragging on blur", () => {
		const s = setup();
		s.dispatch("pointerdown", 100, 100);
		s.dispatch("pointermove", 10000, 10000, 8);
		expect(s.frames.size).toBe(0);
		s.dispatch("pointermove", 150, 150);
		expect(s.frames.size).toBe(1);
		window.dispatchEvent(new Event("blur"));
		expect(s.frames.size).toBe(0);
		s.dispatch("pointermove", 160, 160);
		expect(s.frames.size).toBe(0);
		expect(s.image.style.transform).toBe(
			"rotate(0deg) translate3d(0px, 0px, 0)",
		);
	});
	it("settles by elapsed time independently of the screen refresh rate", () => {
		const start = { r: 40, y: 50 };
		for (const fps of [30, 60, 120, 144]) {
			const step = 1000 / fps;
			expect(
				springPose(start, Math.ceil(SPRING_DURATION / step) * step),
			).toEqual({ r: 0, y: 0 });
		}
		expect(springPose(start, 0)).toEqual(start);
	});
});
