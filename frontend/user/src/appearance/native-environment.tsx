import { useEffect, useState } from "react";
import { useFeature } from "./context";
import fonts from "./font-styles.json";
import { isTouchDevice } from "./native-hooks";
export function NativeFont() {
	const f = useFeature("font"),
		[random] = useState(() => Math.floor(Math.random() * fonts.length));
	return f.enabled ? (
		<style data-native-font>
			{fonts[f.selection < 0 ? random : f.selection] || ""}
		</style>
	) : null;
}
export function NativeProtection() {
	const f = useFeature("protection"),
		mobile = isTouchDevice();
	useEffect(() => {
		if (!f.enabled) return;
		const editable = (target: EventTarget | null) =>
			target instanceof Element &&
			!!target.closest("input,textarea,select,[contenteditable=true]");
		const block = (e: Event) => {
			if (
				!editable(e.target) &&
				(!mobile || e.target instanceof HTMLImageElement)
			)
				e.preventDefault();
		};
		const key = (e: KeyboardEvent) => {
			if (
				!editable(e.target) &&
				(e.key === "F12" ||
					(e.ctrlKey && ["u", "p"].includes(e.key.toLowerCase())) ||
					(e.ctrlKey && e.shiftKey && ["i", "c"].includes(e.key.toLowerCase())))
			)
				e.preventDefault();
		};
		if (f.contextMenu) document.addEventListener("contextmenu", block);
		if (f.drag) document.addEventListener("dragstart", block);
		if (!mobile && f.shortcuts) document.addEventListener("keydown", key);
		return () => {
			document.removeEventListener("contextmenu", block);
			document.removeEventListener("dragstart", block);
			document.removeEventListener("keydown", key);
		};
	}, [f, mobile]);
	return f.enabled && !mobile && f.selection ? (
		<style data-native-protection>
			{
				"body :not(input):not(textarea):not([contenteditable=true]){user-select:none}"
			}
		</style>
	) : null;
}
export function NativeAnalytics() {
	const f = useFeature("analytics");
	useEffect(() => {
		if (!f.enabled || !/^G-[A-Z0-9]+$/.test(f.measurementId)) return;
		const w = window as typeof window & {
			dataLayer?: unknown[];
			gtag?: (...args: unknown[]) => void;
			[key: string]: unknown;
		};
		const key = `ga-disable-${f.measurementId}`;
		w[key] = false;
		w.dataLayer = w.dataLayer || [];
		w.gtag =
			w.gtag ||
			function () {
				w.dataLayer?.push(arguments);
			};
		w.gtag("js", new Date());
		w.gtag("config", f.measurementId);
		// External SDK executes when inserted; React owns the component lifetime.
		const script = document.createElement("script");
		script.id = "nz-google-analytics";
		script.async = true;
		script.src =
			"https://www.googletagmanager.com/gtag/js?id=" +
			encodeURIComponent(f.measurementId);
		document.head.append(script);
		return () => {
			w[key] = true;
			script.remove();
		};
	}, [f]);
	return null;
}
