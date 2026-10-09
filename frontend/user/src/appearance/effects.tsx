import { useEffect, useRef } from "react";
import { useTheme } from "@/hooks/use-theme";
import { NativeBackground } from "./background";
import { useAppearance } from "./context";
import { NativeFooterIP } from "./footer-ip";
import {
	NativeAnalytics,
	NativeFont,
	NativeProtection,
} from "./native-environment";
import { NativeSideImage } from "./native-layout-widgets";
import { NativeMascot } from "./native-mascot";
import { NativeParticleEffects } from "./native-particles";
import { NativeVisitorIP } from "./native-visitor-ip";
import "./appearance.css";
import "./light-readability.css";
import "./native-components.css";

export function NativeEffects({ preview = false }: { preview?: boolean } = {}) {
	const config = useAppearance(),
		{ setTheme } = useTheme(),
		mode = config.features.dark.mode;
	const applied = useRef<string | null>(null);
	useEffect(() => {
		if (config.enabled && config.features.dark.enabled) {
			if (applied.current !== mode) {
				applied.current = mode;
				setTheme(mode);
			}
		} else applied.current = null;
	}, [config.enabled, config.features.dark.enabled, mode, setTheme]);
	if (!config.enabled) return null;
	return (
		<>
			<NativeFont />
			{!preview && (
				<>
					<NativeBackground />
					<NativeFooterIP />
					<NativeVisitorIP />
					<NativeParticleEffects />
					<NativeMascot />
					{config.features.sideImage.enabled && <NativeSideImage />}
					<NativeProtection />
					<NativeAnalytics />
				</>
			)}
		</>
	);
}
