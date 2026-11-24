import { NetworkScene, type NetworkWorkerMessage } from "./network-scene";
const worker = globalThis as unknown as {
	onmessage: ((event: MessageEvent<NetworkWorkerMessage>) => void) | null;
	postMessage: (message: unknown) => void;
	requestAnimationFrame: (callback: FrameRequestCallback) => number;
	cancelAnimationFrame: (id: number) => void;
};
let scene: NetworkScene | undefined,
	visible = false,
	frame = 0;
const draw = () => {
	frame = 0;
	if (!scene || !visible) return;
	scene.frame();
	frame = worker.requestAnimationFrame(draw);
};
const setVisible = (next: boolean) => {
	visible = next;
	if (!visible && frame) {
		worker.cancelAnimationFrame(frame);
		frame = 0;
	}
	if (visible && scene && !frame) frame = worker.requestAnimationFrame(draw);
};
worker.onmessage = ({ data }) => {
	try {
		if (data.type === "init") {
			const ctx = data.canvas.getContext("2d");
			if (!ctx) throw new Error("2D canvas unavailable");
			scene = new NetworkScene(ctx, data.width, data.height, data.settings);
			scene.resize(data.width, data.height, data.dpr);
			scene.pointer = data.pointer;
			setVisible(data.visible);
			worker.postMessage({ type: "initialized" });
		} else if (data.type === "resize")
			scene?.resize(data.width, data.height, data.dpr);
		else if (data.type === "pointer" && scene) scene.pointer = data.pointer;
		else if (data.type === "visibility") setVisible(data.visible);
	} catch {
		setVisible(false);
		worker.postMessage({ type: "failed" });
	}
};
worker.postMessage({
	type: "ready",
	supported:
		typeof OffscreenCanvas !== "undefined" &&
		typeof worker.requestAnimationFrame === "function",
});
