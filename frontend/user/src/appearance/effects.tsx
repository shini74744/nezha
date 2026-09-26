import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAppearance } from "./context";
import { useTheme } from "@/hooks/use-theme";
import { FeatureScope } from "./scope";
import { NativeBackground } from "./background";
import { NativeFooterIP } from "./widgets";
import { visitorIP } from "./modules/visitorIP";
import { quote } from "./modules/quote";
import { network } from "./modules/network";
import { snow } from "./modules/snow";
import { fragments } from "./modules/fragments";
import { sideImage } from "./modules/sideImage";
import { counter } from "./modules/counter";
import { font } from "./modules/font";
import { clock } from "./modules/clock";
import { sponsor } from "./modules/sponsor";
import { sakura } from "./modules/sakura";
import { stars } from "./modules/stars";
import { heart } from "./modules/heart";
import { live2d } from "./modules/live2d";
import "./appearance.css";
import type { Feature } from "./config";
const modules: Record<
	string,
	(scope: FeatureScope, config: Feature) => void | Promise<void>
> = {
	visitorIP,
	quote,
	network,
	snow,
	fragments,
	sideImage,
	counter,
	font,
	clock,
	sakura,
	stars,
	live2d,
};

function protection(scope: FeatureScope, f: Feature) {
	const mobile = /Android|iPhone|iPad|iPod|Windows Phone|Mobi/i.test(
		navigator.userAgent,
	);
	const editable = (target: EventTarget | null) =>
		target instanceof Element &&
		!!target.closest("input,textarea,select,[contenteditable=true]");
	if (f.contextMenu)
		scope.listen(document, "contextmenu", ((e: Event) => {
			if (
				!editable(e.target) &&
				(!mobile || e.target instanceof HTMLImageElement)
			)
				e.preventDefault();
		}) as EventListener);
	if (!mobile && f.selection)
		scope.style(
			"body :not(input):not(textarea):not([contenteditable=true]){user-select:none}",
		);
	if (f.drag)
		scope.listen(document, "dragstart", ((e: Event) => {
			if (
				!editable(e.target) &&
				(!mobile || e.target instanceof HTMLImageElement)
			)
				e.preventDefault();
		}) as EventListener);
	if (!mobile && f.shortcuts)
		scope.listen(document, "keydown", ((e: KeyboardEvent) => {
			if (
				!editable(e.target) &&
				(e.key === "F12" ||
					(e.ctrlKey && ["u", "p"].includes(e.key.toLowerCase())) ||
					(e.ctrlKey && e.shiftKey && ["i", "c"].includes(e.key.toLowerCase())))
			)
				e.preventDefault();
		}) as EventListener);
}
function analytics(scope: FeatureScope, f: Feature) {
	if (!/^G-[A-Z0-9]+$/.test(f.measurementId)) return;
	const w = window as typeof window & {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
		[key: string]: unknown;
	};
	const disableKey = "ga-disable-" + f.measurementId;
	w[disableKey] = false;
	scope.own(() => {
		w[disableKey] = true;
	});
	w.dataLayer = w.dataLayer || [];
	w.gtag =
		w.gtag ||
		function () {
			w.dataLayer!.push(arguments);
		};
	w.gtag("js", new Date());
	w.gtag("config", f.measurementId);
	const node = scope.createElement("script") as HTMLScriptElement;
	node.id = "nz-google-analytics";
	node.async = true;
	node.src =
		"https://www.googletagmanager.com/gtag/js?id=" +
		encodeURIComponent(f.measurementId);
	document.head.append(node);
}
export function NativeEffects() {
	const config = useAppearance(),
		{ setTheme } = useTheme(),
		{ pathname } = useLocation();
	const darkApplied = useRef(false);
	useEffect(() => {
		if (config.enabled && config.features.dark.enabled) {
			if (!darkApplied.current) {
				darkApplied.current = true;
				setTheme("dark");
			}
		} else darkApplied.current = false;
	}, [config.enabled, config.features.dark.enabled, setTheme]);
	useEffect(() => {
		if (!config.enabled || !config.features.sponsor.enabled) return;
		const scope = new FeatureScope("sponsor");
		const timer = window.setTimeout(
			() => sponsor(scope, config.features.sponsor),
			0,
		);
		return () => {
			window.clearTimeout(timer);
			scope.dispose();
		};
	}, [config, pathname]);
	useEffect(() => {
		if (!config.enabled) return;
		const scopes: FeatureScope[] = [];
		const timer = window.setTimeout(() => {
			const mount = (
				name: string,
				run: (scope: FeatureScope, f: Feature) => void | Promise<void>,
			) => {
				if (!config.features[name]?.enabled) return;
				const scope = new FeatureScope(name);
				scopes.push(scope);
				try {
					Promise.resolve(run(scope, config.features[name])).catch((error) => {
						console.error("Appearance feature failed:", name, error);
						scope.dispose();
					});
				} catch (error) {
					console.error("Appearance feature failed:", name, error);
					scope.dispose();
				}
			};
			for (const [name, run] of Object.entries(modules)) mount(name, run);
			mount("heart", heart);
			mount("protection", protection);
			mount("analytics", analytics);
			mount("links", (scope) =>
				scope.style(
					'.header-handles a{text-decoration:none!important}.header-handles a[href^="https://t.me"]:hover{color:#27a7e5!important}.header-handles a[href="/dashboard"]{color:#ca8a04!important}.dark .header-handles a[href="/dashboard"]{color:#facc15!important}.header-handles a[href="/dashboard"]:hover{transform:translateY(-.5px)}',
				),
			);
		}, 0);
		return () => {
			window.clearTimeout(timer);
			for (const scope of scopes.reverse()) scope.dispose();
		};
	}, [config]);
	if (!config.enabled) return null;
	return (
		<>
			<NativeBackground />
			<NativeFooterIP />
		</>
	);
}
