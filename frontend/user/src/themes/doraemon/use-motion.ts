import { useEffect, useRef, useState } from "react";
// Pause decoration, not telemetry, while hidden/offscreen. No continuous JS timer.
export function useDoraMotion<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [inView, setInView] = useState(true);
	const [visible, setVisible] = useState(
		() => document.visibilityState !== "hidden",
	);
	useEffect(() => {
		const onVisibility = () =>
			setVisible(document.visibilityState !== "hidden");
		onVisibility();
		document.addEventListener("visibilitychange", onVisibility);
		const observer =
			typeof IntersectionObserver === "undefined"
				? null
				: new IntersectionObserver(
						([entry]) => setInView(entry.isIntersecting),
						{ rootMargin: "0px" },
					);
		if (ref.current) observer?.observe(ref.current);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			observer?.disconnect();
		};
	}, []);
	return {
		ref,
		"data-dora-motion": visible && inView ? "running" : "paused",
	} as const;
}
