import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../src/components/ThemeProvider";
import { AppearanceProvider } from "../src/appearance/context";
import { NativeEffects } from "../src/appearance/effects";
import {
	NativeQuote,
	NativeCounter,
	NativeClockPart,
} from "../src/appearance/native-layout-widgets";
import {
	NativeDesktopSponsor,
	NativeMobileSponsor,
} from "../src/appearance/native-sponsor";
import { BackgroundSoundLogo } from "../src/appearance/background-sound";
import {
	NativeName,
	NativeSpeed,
	NativeDescription,
	NativeGreeting,
	NativeTraffic,
	NativeFooter,
} from "../src/appearance/widgets";
import { defaults } from "../src/appearance/config";
import { usePeakCutDefault } from "../src/appearance/peak-cut";
function PeakProbe() {
	return <output data-testid="peak-cut">{String(usePeakCutDefault())}</output>;
}
import "../src/index.css";
function Harness() {
	const [config, setConfig] = useState(defaults());
	Object.assign(window, {
		setNativeConfig: (keys: string[], overrides = {}) => {
			const c = defaults();
			c.enabled = keys.length > 0;
			for (const [key, f] of Object.entries(c.features)) {
				f.enabled = keys.includes(key);
				Object.assign(f, overrides[key] || {});
			}
			setConfig(c);
		},
		nativeDefaults: defaults,
	});
	return (
		<AppearanceProvider raw={JSON.stringify(config)}>
			<NativeEffects />
			<PeakProbe />
			<main style={{ position: "relative", zIndex: 20, minHeight: 1800 }}>
				<NativeQuote />
				<div className="header-top" style={{ display: "flex", gap: 8 }}>
					<BackgroundSoundLogo className="inline-flex header-logo">
						<img
							src="/apple-touch-icon.png"
							width={24}
							height={24}
							alt="Logo"
						/>
					</BackgroundSoundLogo>
					<NativeCounter />
				</div>
				<h1>Native feature verification</h1>
				<div
					className="server-overview-controls"
					style={{ margin: "40px 20px", height: 40 }}
				>
					<section style={{ display: "flex", gap: 8, width: "100%" }}>
						<button>Map</button>
						<button>List</button>
					</section>
					<NativeDesktopSponsor />
					<div style={{ flexShrink: 0 }}>Sort</div>
				</div>
				<Link to="/">home</Link> <Link to="/server/11">detail</Link>
				<p>
					<NativeGreeting fallback="original greeting" />
				</p>
				<p>
					<NativeDescription fallback="original description" />
				</p>
				<div className="flex items-center font-medium text-sm">
					<NativeClockPart unit="hour" value={12}>
						<span data-issues-count-animation="true">12</span>
					</NativeClockPart>
					<span className="opacity-50">:</span>
					<NativeClockPart unit="minute" value={34}>
						<span data-issues-count-animation="true">34</span>
					</NativeClockPart>
					<span className="opacity-50">:</span>
					<NativeClockPart unit="second" value={56}>
						<span data-issues-count-animation="true">56</span>
					</NativeClockPart>
				</div>
				<div>
					<NativeName online>Server A</NativeName>
					<NativeSpeed bytes={15728640} direction="up" />
					<NativeTraffic serverId={11} />
				</div>
				<div
					data-footer-region
					className="nz-footer-region"
					style={{ marginTop: 1800 }}
				>
					<NativeFooter />
					<NativeMobileSponsor />
				</div>
			</main>
		</AppearanceProvider>
	);
}
createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<QueryClientProvider client={new QueryClient()}>
			<BrowserRouter>
				<ThemeProvider>
					<Harness />
				</ThemeProvider>
			</BrowserRouter>
		</QueryClientProvider>
	</React.StrictMode>,
);
