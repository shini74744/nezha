import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Feature } from "./config";
import { useAppearance } from "./context";
import { isTouchDevice, useMedia, useScrollPosition } from "./native-hooks";
import { FeatureScope } from "./scope";

export function NativeCanvas({
	kind,
	config,
}: {
	kind: "network" | "sakura";
	config: Feature;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const node = canvas.current;
		if (!node) return;
		const scope = new FeatureScope(kind);
		void (async () => {
			if (kind === "network") {
				const { network } = await import("./modules/network");
				if (scope.active) network(scope, config, node);
			} else {
				const { sakura } = await import("./modules/sakura");
				if (scope.active) sakura(scope, config, node);
			}
		})().catch((error) => {
			console.error("Appearance canvas failed", kind, error);
			scope.dispose();
		});
		return () => scope.dispose();
	}, [kind, config]);
	return (
		<canvas
			ref={canvas}
			id={kind === "network" ? "canvas-nest" : "canvas_sakura"}
			data-native-canvas={kind}
			aria-hidden
			className="nz-native-canvas"
			style={{
				zIndex: kind === "network" ? 10 : 0,
				opacity: kind === "network" ? config.opacity : 1,
			}}
		/>
	);
}
type Particle = {
	id: number;
	className: string;
	text?: string;
	style: CSSProperties;
	expires: number;
};
const colors = ["#D61C59", "#E7D84B", "#1B8798"];
function PointerParticles({
	heart,
	fragments,
	stars,
}: {
	heart: Feature;
	fragments: Feature;
	stars: Feature;
}) {
	const [particles, setParticles] = useState<Particle[]>([]),
		serial = useRef(0);
	useEffect(() => {
		const pending: Particle[] = [];
		let frame = 0;
		const flush = () => {
			frame = 0;
			const batch = pending.splice(0);
			setParticles((old) =>
				old
					.filter((p) => p.expires > Date.now())
					.concat(batch)
					.slice(-240),
			);
		};
		const add = (p: Omit<Particle, "id">) => {
			pending.push({ ...p, id: serial.current++ });
			if (!frame) frame = requestAnimationFrame(flush);
		};
		const click = (e: MouseEvent) => {
			const now = Date.now();
			if (heart.enabled)
				add({
					className: "heart",
					expires: now + 1400,
					style: {
						left: e.clientX - 5,
						top: e.clientY - 5,
						backgroundColor:
							"rgb(" +
							[0, 0, 0].map(() => Math.floor(Math.random() * 255)).join(",") +
							")",
					},
				});
			if (fragments.enabled)
				for (let i = 0; i < fragments.count; i++) {
					const angle = Math.random() * Math.PI * 2,
						distance = Math.random() * 200 + 50;
					add({
						className: "fragment",
						expires: now + 1600,
						style: {
							left: e.clientX,
							top: e.clientY,
							"--dx": `${Math.cos(angle) * distance}px`,
							"--dy": `${Math.sin(angle) * distance}px`,
							"--angle": `${Math.random() * 720}deg`,
						} as CSSProperties,
					});
				}
		};
		const move = (e: MouseEvent) => {
			if (
				!stars.enabled ||
				isTouchDevice()
			)
				return;
			add({
				className: "nz-cursor-star",
				text: "*",
				expires: Date.now() + 2100,
				style: {
					left: e.clientX + 10,
					top: e.clientY + 10,
					color: colors[Math.floor(Math.random() * colors.length)],
					"--dx": `${(Math.random() < 0.5 ? -1 : 1) * Math.random() * 60}px`,
				} as CSSProperties,
			});
		};
		if (heart.enabled || fragments.enabled)
			document.addEventListener("click", click);
		if (stars.enabled)
			document.addEventListener("mousemove", move, { passive: true });
		// Expiry is a fallback for cancelled/disabled CSS animations and background tabs.
		const cleanup = setInterval(
			() =>
				setParticles((old) =>
					old.some((p) => p.expires <= Date.now())
						? old.filter((p) => p.expires > Date.now())
						: old,
				),
			500,
		);
		return () => {
			document.removeEventListener("click", click);
			document.removeEventListener("mousemove", move);
			cancelAnimationFrame(frame);
			clearInterval(cleanup);
		};
	}, [heart, fragments, stars]);
	return (
		<div
			className="nz-native-particles js-cursor-container"
			data-native-particles
			aria-hidden
		>
			{particles.map((p) => (
				<span
					key={p.id}
					className={p.className}
					style={p.style}
					onAnimationEnd={() =>
						setParticles((old) => old.filter((item) => item.id !== p.id))
					}
				>
					{p.text}
				</span>
			))}
		</div>
	);
}
function Snow({ config }: { config: Feature }) {
	const mobile = useMedia("(max-width:768px)"),
		[flakes, setFlakes] = useState<Particle[]>([]);
	const count = mobile ? config.mobileCount : config.count;
	useEffect(() => {
		setFlakes([]);
		let number = 0;
		const timer = setInterval(() => {
			if (number >= count) {
				clearInterval(timer);
				return;
			}
			const flake: Particle = {
				id: number++,
				className: "snowflake",
				expires: Infinity,
				text: ["✼", "✽", "❄"][Math.floor(Math.random() * 3)],
				style: {
					left: `${Math.random() * 100}%`,
					animationDuration: `${4 + Math.random() * 4}s`,
					fontSize: 10 + Math.random() * 20,
					opacity: 0.5 + Math.random() * 0.5,
				},
			};
			setFlakes((old) => [...old, flake]);
		}, config.interval);
		return () => clearInterval(timer);
	}, [count, config.interval]);
	return (
		<div className="nz-native-particles" data-native-snow aria-hidden>
			{flakes.map((p) => (
				<span key={p.id} className={p.className} style={p.style}>
					{p.text}
				</span>
			))}
		</div>
	);
}
function BackToTop() {
	const scroll = useScrollPosition();
	return (
		<button
			type="button"
			id="backToTop"
			className="nz-native-back-top"
			aria-label="返回顶部"
			hidden={scroll <= 300}
			onClick={() =>
				window.scrollTo({
					top: 0,
					behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
						? "instant"
						: "smooth",
				})
			}
		>
			🚀
		</button>
	);
}
export function NativeParticleEffects() {
	const { features: f } = useAppearance();
	return (
		<>
			{f.network.enabled && !isTouchDevice() && (
				<NativeCanvas kind="network" config={f.network} />
			)}
			{f.sakura.enabled && <NativeCanvas kind="sakura" config={f.sakura} />}
			{f.snow.enabled && <Snow config={f.snow} />}
			{(f.heart.enabled || f.fragments.enabled || f.stars.enabled) && (
				<PointerParticles
					key={[f.heart.enabled, f.fragments.enabled, f.stars.enabled].join()}
					heart={f.heart}
					fragments={f.fragments}
					stars={f.stars}
				/>
			)}
			{f.fragments.enabled && <BackToTop />}
		</>
	);
}