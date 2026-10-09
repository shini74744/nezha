import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackgroundMedia } from "@/appearance/background-media";
import { AppearanceProvider } from "@/appearance/context";
import { defaults } from "@/appearance/config";
import type { Media } from "@/appearance/background-config";
const img = (name: string): Media => ({
	type: "image",
	src: "https://example.test/" + name + ".png",
});
const movie: Media = { type: "video", src: "https://example.test/movie.mp4" };
const phase = (element: Element) =>
	element.parentElement!.getAttribute("data-background-phase");
function ui(media?: Media, fail = vi.fn(), settings?: import("@/appearance/background-load").BackgroundLoad) {
	const config = defaults();
	config.enabled = true;
	return (
		<AppearanceProvider raw={JSON.stringify(config)}>
			<BackgroundMedia media={media} source="desktop" load={settings} onFailure={fail} />
		</AppearanceProvider>
	);
}
async function load(element: HTMLImageElement) {
	Object.defineProperty(element, "naturalWidth", {
		value: 100,
		configurable: true,
	});
	await act(async () => {
		fireEvent.load(element);
	});
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
	vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
it("does not reveal until image decoding completes, then reuses the loaded node", async () => {
	const view = render(ui(img("first")));
	const image = view.container.querySelector("img")!;
	let decoded!: () => void;
	Object.defineProperty(image, "decode", {
		value: vi.fn(
			() =>
				new Promise<void>((resolve) => {
					decoded = resolve;
				}),
		),
	});
	await load(image);
	expect(phase(image)).toBe("loading");
	await act(async () => {
		decoded();
	});
	expect(phase(image)).toBe("revealing");
	expect(view.container.querySelector("img")).toBe(image);
	act(() => vi.advanceTimersByTime(1000));
	expect(phase(image)).toBe("revealing");
	act(() => vi.advanceTimersByTime(500));
	expect(phase(image)).toBe("visible");
});
it("keeps the previous image until the replacement is ready and finishes revealing", async () => {
	const view = render(ui(img("first")));
	const first = view.container.querySelector("img")!;
	await load(first);
	act(() => vi.advanceTimersByTime(1500));
	view.rerender(ui(img("second")));
	const second = view.container.querySelectorAll("img")[1];
	expect(first.isConnected).toBe(true);
	expect(phase(second)).toBe("loading");
	await load(second);
	expect(first.isConnected).toBe(true);
	expect(phase(second)).toBe("revealing");
	act(() => vi.advanceTimersByTime(1500));
	expect(first.isConnected).toBe(false);
	expect(phase(second)).toBe("visible");
});
it("ignores a stale decode after replacement", async () => {
	const view = render(ui(img("first")));
	const first = view.container.querySelector("img")!;
	let decoded!: () => void;
	Object.defineProperty(first, "decode", {
		value: () =>
			new Promise<void>((resolve) => {
				decoded = resolve;
			}),
	});
	await load(first);
	view.rerender(ui(img("second")));
	await act(async () => {
		decoded();
	});
	expect(view.container.querySelectorAll("img")).toHaveLength(1);
	expect(phase(view.container.querySelector("img")!)).toBe("loading");
});
it("does not replay on an unchanged source or unrelated render", async () => {
	const view = render(ui(img("first")));
	const first = view.container.querySelector("img")!;
	await load(first);
	act(() => vi.advanceTimersByTime(1500));
	view.rerender(ui(img("first")));
	expect(view.container.querySelector("img")).toBe(first);
	expect(phase(first)).toBe("visible");
});
it("advances on image decode failure without exposing the failed image", async () => {
	const fail = vi.fn(),
		view = render(ui(img("bad"), fail)),
		image = view.container.querySelector("img")!;
	Object.defineProperty(image, "decode", {
		value: () => Promise.reject(new Error("bad decode")),
	});
	await load(image);
	expect(fail).toHaveBeenCalledOnce();
	expect(phase(image)).toBe("loading");
});
it("falls back from an extensionless image to video without revealing a broken frame", () => {
	const fail = vi.fn(),
		view = render(
			ui({ type: "auto", src: "https://example.test/random" }, fail),
		);
	fireEvent.error(view.container.querySelector("img")!);
	const video = view.container.querySelector("video")!;
	expect(video).not.toBeNull();
	expect(phase(video)).toBe("loading");
	fireEvent.error(video);
	expect(fail).toHaveBeenCalledOnce();
});
it("waits for video frame data, not just metadata, and does not replay on looping", () => {
	const view = render(ui(movie)),
		video = view.container.querySelector("video")!;
	Object.defineProperty(video, "readyState", { value: 1, configurable: true });
	fireEvent.loadedMetadata(video);
	fireEvent.canPlay(video);
	expect(phase(video)).toBe("loading");
	Object.defineProperty(video, "readyState", { value: 2, configurable: true });
	fireEvent.loadedData(video);
	expect(phase(video)).toBe("revealing");
	act(() => vi.advanceTimersByTime(1500));
	fireEvent.playing(video);
	expect(phase(video)).toBe("visible");
});
it("waits for a presented video frame when the browser supports it", () => {
	let callback!: () => void;
	const request = vi.fn((cb) => {
		callback = cb;
		return 9;
	});
	Object.defineProperty(
		HTMLVideoElement.prototype,
		"requestVideoFrameCallback",
		{ value: request, configurable: true },
	);
	const view = render(ui(movie)),
		video = view.container.querySelector("video")!;
	Object.defineProperty(video, "readyState", { value: 2 });
	Object.defineProperty(video, "paused", { value: false });
	fireEvent.loadedData(video);
	expect(phase(video)).toBe("loading");
	act(() => callback());
	expect(phase(video)).toBe("revealing");
	delete (HTMLVideoElement.prototype as any).requestVideoFrameCallback;
});
it("retains the last good background when all replacement sources fail", async () => {
	const view = render(ui(img("first"))),
		first = view.container.querySelector("img")!;
	await load(first);
	act(() => vi.advanceTimersByTime(1500));
	view.rerender(ui(img("bad")));
	view.rerender(ui(undefined));
	expect(view.container.querySelectorAll("img")).toHaveLength(1);
	expect(view.container.querySelector("img")).toBe(first);
});
it("cleans up callbacks, sound and timers when disabled/unmounted", async () => {
	const view = render(ui(img("first")));
	await load(view.container.querySelector("img")!);
	view.unmount();
	expect(vi.getTimerCount()).toBe(0);
});

it("honors long duration, captures settings when ready and never restarts on config-only edits",async()=>{
 const view=render(ui(img("long"),vi.fn(),{effect:"left",duration:4}));
 const image=view.container.querySelector("img")!;
 view.rerender(ui(img("long"),vi.fn(),{effect:"right",duration:10}));
 expect(view.container.querySelector("img")).toBe(image);
 await load(image);expect(image.parentElement!.dataset.backgroundEffect).toBe("right");
 expect(image.parentElement!.style.getPropertyValue("--nz-background-duration")).toBe("10s");
 act(()=>vi.advanceTimersByTime(1500));expect(phase(image)).toBe("revealing");
 view.rerender(ui(img("long"),vi.fn(),{effect:"none",duration:0}));
 expect(phase(image)).toBe("revealing");
 act(()=>vi.advanceTimersByTime(8800));expect(phase(image)).toBe("visible");
 expect(view.container.querySelector("img")).toBe(image);
});
it.each([{effect:"none" as const,duration:5},{effect:"fade" as const,duration:0}])("waits for readiness even without animation: %s",async settings=>{
 const view=render(ui(img("old")));const old=view.container.querySelector("img")!;await load(old);
 act(()=>vi.advanceTimersByTime(1500));
 view.rerender(ui(img("instant"),vi.fn(),settings));const next=view.container.querySelectorAll("img")[1];
 expect(phase(next)).toBe("loading");expect(old.isConnected).toBe(true);
 await load(next);expect(phase(next)).toBe("visible");expect(old.isConnected).toBe(false);
});
