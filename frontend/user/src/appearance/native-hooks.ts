import { useEffect, useState } from "react";
export function useMedia(query: string) {
	const [matches, setMatches] = useState(
		() => window.matchMedia(query).matches,
	);
	useEffect(() => {
		const m = window.matchMedia(query);
		const update = () => setMatches(m.matches);
		update();
		m.addEventListener("change", update);
		return () => m.removeEventListener("change", update);
	}, [query]);
	return matches;
}
export function isTouchDevice() {
	return (
		/Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent) ||
		(/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 0)
	);
}
export function useScrollPosition(enabled = true) {
	const [y, setY] = useState(() => window.scrollY);
	useEffect(() => {
		if (!enabled) return;
		let frame = 0;
		const update = () => {
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					setY(window.scrollY);
				});
		};
		window.addEventListener("scroll", update, { passive: true });
		update();
		return () => {
			window.removeEventListener("scroll", update);
			cancelAnimationFrame(frame);
		};
	}, [enabled]);
	return y;
}
