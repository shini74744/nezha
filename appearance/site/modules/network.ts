import NetworkWorker from "./network.worker.ts?worker&inline";
import type { Feature } from "../config";
import type { FeatureScope } from "../scope";
import {
	NetworkScene,
	type NetworkPointer,
	type NetworkWorkerMessage,
} from "./network-scene";

export function network(
	scope: FeatureScope,
	config: Feature,
	host: HTMLElement,
) {
	if (
		/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
			navigator.userAgent,
		)
	)
		return;
	let worker: Worker | undefined, scene: NetworkScene | undefined;
	let transferred = false,
		disposed = false,
		frame = 0,
		pointerFrame = 0,
		timeout = 0;
	let pointer: NetworkPointer = null;
	const settings = { count: config.count, color: config.color };
	const dimensions = () => ({
		width: window.innerWidth,
		height: window.innerHeight,
		dpr: window.devicePixelRatio || 1,
	});
	const createCanvas = () => {
		const c = scope.createElement("canvas") as HTMLCanvasElement;
		c.id = "canvas-nest";
		c.className = "nz-native-canvas";
		c.dataset.nativeCanvas = "network";
		c.setAttribute("aria-hidden", "true");
		Object.assign(c.style, {
			position: "fixed",
			top: "0",
			left: "0",
			width: "100%",
			height: "100%",
			zIndex: "10",
			opacity: String(config.opacity),
			pointerEvents: "none",
		});
		host.append(c);
		return c;
	};
	let canvas = createCanvas();
	const stopWorker = () => {
		if (worker) {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
			worker.terminate();
			worker = undefined;
		}
		scope.clearTimeout(timeout);
		timeout = 0;
	};
	const draw = () => {
		frame = 0;
		if (disposed || document.hidden || !scene) return;
		scene.frame();
		frame = scope.requestAnimationFrame(draw);
	};
	const fallback = () => {
		if (disposed || !scope.active || scene) return;
		stopWorker();
		// A transferred canvas cannot regain a main-thread context. The host is
		// owned by React; each rendering canvas is owned and replaced by this scope.
		if (transferred) {
			scope.remove(canvas);
			canvas = createCanvas();
			transferred = false;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const { width, height, dpr } = dimensions();
		scene = new NetworkScene(ctx, width, height, settings);
		scene.resize(width, height, dpr);
		scene.pointer = pointer;
		canvas.dataset.networkRenderer = "main";
		if (!document.hidden) frame = scope.requestAnimationFrame(draw);
	};
	const post = (message: NetworkWorkerMessage) => {
		if (!worker || !transferred) return;
		try {
			worker.postMessage(message);
		} catch {
			fallback();
		}
	};
	const sendPointer = () => {
		pointerFrame = 0;
		if (scene) scene.pointer = pointer;
		else post({ type: "pointer", pointer });
	};
	const move = (event: MouseEvent) => {
		pointer = { x: event.clientX, y: event.clientY };
		if (scene) scene.pointer = pointer;
		else if (!pointerFrame)
			pointerFrame = scope.requestAnimationFrame(sendPointer);
	};
	const leave = () => {
		pointer = null;
		scope.cancelAnimationFrame(pointerFrame);
		pointerFrame = 0;
		sendPointer();
	};
	scope.listen(window, "mousemove", move as EventListener, { passive: true });
	scope.listen(window, "mouseout", ((event: MouseEvent) => {
		if (event.relatedTarget === null) leave();
	}) as EventListener);
	scope.listen(window, "blur", leave);
	scope.listen(window, "resize", () => {
		const d = dimensions();
		if (scene) scene.resize(d.width, d.height, d.dpr);
		else post({ type: "resize", ...d });
	});
	scope.listen(document, "visibilitychange", () => {
		if (document.hidden) leave();
		if (scene) {
			scope.cancelAnimationFrame(frame);
			frame = 0;
			if (!document.hidden) frame = scope.requestAnimationFrame(draw);
		} else post({ type: "visibility", visible: !document.hidden });
	});
	scope.own(() => {
		disposed = true;
		stopWorker();
		scope.cancelAnimationFrame(frame);
		scope.cancelAnimationFrame(pointerFrame);
		scene = undefined;
	});
	if (
		typeof Worker === "undefined" ||
		typeof canvas.transferControlToOffscreen !== "function"
	) {
		fallback();
		return;
	}
	try {
		worker = new NetworkWorker({
			name: "ddnezha-network-effect",
		});
		worker.onerror = (event) => {
			event.preventDefault();
			fallback();
		};
		worker.onmessageerror = () => fallback();
		worker.onmessage = ({ data }) => {
			if (disposed || !scope.active) return;
			if (data.type === "ready") {
				// Loading and context creation are separate progress stages. A slow
				// first paint must not consume the entire worker initialization budget.
				scope.clearTimeout(timeout);
				timeout = scope.setTimeout(fallback, 10000);
				if (!data.supported) {
					fallback();
					return;
				}
				try {
					const offscreen = canvas.transferControlToOffscreen();
					transferred = true;
					const message: NetworkWorkerMessage = {
						type: "init",
						canvas: offscreen,
						...dimensions(),
						settings,
						visible: !document.hidden,
						pointer,
					};
					worker!.postMessage(message, [offscreen]);
				} catch {
					fallback();
				}
			} else if (data.type === "initialized") {
				scope.clearTimeout(timeout);
				timeout = 0;
				canvas.dataset.networkRenderer = "worker";
			} else if (data.type === "failed") fallback();
		};
		timeout = scope.setTimeout(fallback, 10000);
	} catch {
		fallback();
	}
}
