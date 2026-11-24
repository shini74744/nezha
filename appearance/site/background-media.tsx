import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {defaultBackgroundLoad,type BackgroundLoad} from "./background-load";
import type { Media } from "./background-config";
import { useFeature } from "./context";
import { publishBackgroundSound } from "./background-sound";
type Layer = {
	id: number;
	media: Media;
	source: string;
	load: BackgroundLoad;
	phase: "loading" | "revealing" | "visible";
};
type Props = { media?: Media; source: string; load?: BackgroundLoad; onFailure: () => void };

// Reuse the decoded media node; never request a random endpoint twice.
export function BackgroundMedia({ media, source, load = defaultBackgroundLoad, onFailure }: Props) {
	const latestLoad = useRef(load);
	latestLoad.current = load;
	const [layers, setLayers] = useState<Layer[]>([]);
	const sequence = useRef(0),
		requested = useRef(0),
		visible = useRef(0);
	const failure = useRef(onFailure);
	failure.current = onFailure;
	const src = media?.src,
		type = media?.type;
	useEffect(() => {
		const id = ++sequence.current;
		requested.current = id;
		setLayers((previous) => [
			...previous.filter((layer) => layer.id === visible.current),
			...(src && type
				? [{ id, media: { src, type }, source, load: latestLoad.current, phase: "loading" as const }]
				: []),
		]);
	}, [src, type, source]);
	const ready = useCallback((id: number) => {
		if (requested.current !== id || visible.current === id) return;
		visible.current = id;
		const load = {...latestLoad.current};
		const immediate = load.effect === "none" || load.duration === 0;
		setLayers((previous) => previous
			.filter(layer => !immediate || layer.id === id)
			.map(layer => layer.id === id
				? {...layer, load, phase: immediate ? "visible" : "revealing"} : layer));

	}, []);
	const settle = useCallback((id: number) => {
		if (visible.current !== id) return;
		setLayers((previous) =>
			previous
				.filter((layer) => layer.id === id || layer.id === requested.current)
				.map((layer) =>
					layer.id === id ? { ...layer, phase: "visible" } : layer,
				),
		);
	}, []);
	const fail = useCallback((id: number) => {
		if (requested.current !== id) return;
		requested.current = 0;
		failure.current();
	}, []);
	return (
		<>
			{layers.map((layer) => (
				<MediaLayer
					key={layer.id}
					layer={layer}
					active={layer.id === visible.current}
					onReady={ready}
					onSettled={settle}
					onFailure={fail}
				/>
			))}
		</>
	);
}

function MediaLayer({
	layer,
	active,
	onReady,
	onSettled,
	onFailure,
}: {
	layer: Layer;
	active: boolean;
	onReady: (id: number) => void;
	onSettled: (id: number) => void;
	onFailure: (id: number) => void;
}) {
	const sound = useFeature("video");
	const [asVideo, setAsVideo] = useState(layer.media.type === "video");
	const [muted, setMuted] = useState(true);
	const image = useRef<HTMLImageElement>(null),
		video = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (asVideo) return;
		const target = image.current;
		if (!target) return;
		let cancelled = false,
			decoding = false;
		const failed = () => {
			if (cancelled) return;
			if (layer.media.type === "auto") setAsVideo(true);
			else onFailure(layer.id);
		};
		const loaded = async () => {
			if (cancelled || decoding || !target.naturalWidth) return;
			decoding = true;
			try {
				if (typeof target.decode === "function") await target.decode();
				if (!cancelled) onReady(layer.id);
			} catch {
				failed();
			}
		};
		target.addEventListener("load", loaded);
		target.addEventListener("error", failed);
		if (target.complete) {
			if (target.naturalWidth) void loaded();
			else failed();
		}
		return () => {
			cancelled = true;
			target.removeEventListener("load", loaded);
			target.removeEventListener("error", failed);
		};
	}, [asVideo, layer.id, layer.media.type, onReady, onFailure]);
	useEffect(() => {
		if (!asVideo) return;
		const target = video.current;
		if (!target) return;
		let cancelled = false,
			frame: number | undefined,
			timer: number | undefined;
		const show = () => {
			if (!cancelled && target.readyState >= 2) onReady(layer.id);
		};
		const ready = () => {
			if (cancelled || target.readyState < 2) return;
			if (
				typeof target.requestVideoFrameCallback === "function" &&
				!target.paused
			) {
				if (frame === undefined) {
					frame = target.requestVideoFrameCallback(show);
					// Low-power / background tabs may suspend frame callbacks; loadeddata already provides a frame.
					timer = window.setTimeout(show, 250);
				}
			} else show();
		};
		const failed = () => {
			if (!cancelled) onFailure(layer.id);
		};
		target.addEventListener("loadeddata", ready);
		target.addEventListener("canplay", ready);
		target.addEventListener("playing", ready);
		target.addEventListener("error", failed);
		// Resume after React StrictMode effect replay; muted autoplay may still be denied by low-power mode.
		void target.play()?.catch(() => {});
		ready();
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
			if (frame !== undefined) target.cancelVideoFrameCallback?.(frame);
			target.removeEventListener("loadeddata", ready);
			target.removeEventListener("canplay", ready);
			target.removeEventListener("playing", ready);
			target.removeEventListener("error", failed);
			target.pause();
		};
	}, [asVideo, layer.id, onReady, onFailure]);
	useEffect(() => {
		if (layer.phase !== "revealing") return;
		// Retire the old layer even if a hidden tab suppresses animation events.
		const timer = window.setTimeout(() => onSettled(layer.id), layer.load.duration * 1000 + 300);
		return () => window.clearTimeout(timer);
	}, [layer.id, layer.phase, layer.load.duration, onSettled]);
	const toggleSound = useCallback(async () => {
		const target = video.current;
		if (!target) return;
		const nextMuted = !target.muted;
		target.muted = nextMuted;
		setMuted(nextMuted);
		try {
			await target.play();
		} catch {
			target.muted = true;
			if (video.current === target) setMuted(true);
		}
	}, []);
	useEffect(() => {
		if (!active || !sound.enabled) {
			if (video.current) video.current.muted = true;
			setMuted(true);
		}
		if (
			!active ||
			!asVideo ||
			!sound.enabled ||
			!sound.showControl ||
			!sound.toggleMuteOnControlClick
		)
			return;
		return publishBackgroundSound({ muted, toggle: toggleSound });
	}, [
		active,
		asVideo,
		muted,
		sound.enabled,
		sound.showControl,
		sound.toggleMuteOnControlClick,
		toggleSound,
	]);
	return (
		<div
			className={(asVideo ? "video-box" : "image-box") + " nz-media"}
			data-background-source={layer.source.split("[")[0]}
			data-background-phase={layer.phase}
			data-background-effect={layer.load.effect}
			style={{"--nz-background-duration": layer.load.duration + "s"} as CSSProperties}
			aria-hidden="true"
			onAnimationEnd={(event) => {
				if (event.target === event.currentTarget) onSettled(layer.id);
			}}
		>
			{asVideo ? (
				<video
					ref={video}
					id={active ? "myVideo" : undefined}
					src={layer.media.src}
					muted={muted}
					autoPlay
					loop
					playsInline
					preload="auto"
					onClick={() => {
						if (active && sound.enabled && sound.unmuteOnVideoClick && muted)
							void toggleSound();
					}}
				/>
			) : (
				<img
					ref={image}
					src={layer.media.src}
					alt=""
					decoding="async"
					fetchPriority="high"
				/>
			)}
		</div>
	);
}
