import { type PointerEvent, useCallback, useEffect, useRef } from "react";
import "./glass-shine.css";

const query =
	"(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

export function useGlassShine() {
	const frame = useRef(0);
	const target = useRef<HTMLElement | null>(null);
	const position = useRef({ x: 0, y: 0 });
	const media = useRef<MediaQueryList | null>(null);
	const clear = useCallback(() => {
		cancelAnimationFrame(frame.current);
		frame.current = 0;
		target.current?.removeAttribute("data-glass-hover");
		target.current = null;
	}, []);
	useEffect(() => clear, [clear]);
	const update = (event: PointerEvent<HTMLElement>) => {
		media.current ??= window.matchMedia(query);
		if (event.pointerType !== "mouse" || !media.current.matches) {
			clear();
			return;
		}
		const node = event.currentTarget;
		target.current = node;
		position.current = { x: event.clientX, y: event.clientY };
		if (frame.current) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = 0;
			if (target.current !== node || !media.current?.matches) return;
			const rect = node.getBoundingClientRect();
			node.style.setProperty(
				"--glass-x",
				`${Math.max(0, Math.min(rect.width, position.current.x - rect.left))}px`,
			);
			node.style.setProperty(
				"--glass-y",
				`${Math.max(0, Math.min(rect.height, position.current.y - rect.top))}px`,
			);
			node.setAttribute("data-glass-hover", "true");
		});
	};
	return {
		onPointerEnter: update,
		onPointerMove: update,
		onPointerLeave: clear,
		onPointerCancel: clear,
	};
}

export function GlassShine() {
	return <span className="server-glass-sheen" aria-hidden="true" />;
}
