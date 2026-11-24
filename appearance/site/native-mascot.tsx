import { useEffect, useRef } from "react";
import type { Feature } from "./config";
import { useFeature } from "./context";
import { useMedia } from "./native-hooks";
import { FeatureScope } from "./scope";

function MascotHost({ config }: { config: Feature }) {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!host.current) return;
		const node = host.current,
			scope = new FeatureScope("live2d");
		void (async () => {
			if (config.provider === "sakana") {
				const { sakana } = await import("./modules/sakana");
				if (scope.active) await sakana(scope, config, node);
			} else {
				const { live2d } = await import("./modules/live2d");
				if (scope.active)
					live2d(scope, { cdnPath: config.cdnPath, tools: config.tools }, node);
			}
		})().catch((error) => {
			console.error("Appearance mascot failed", error);
			scope.dispose();
		});
		return () => scope.dispose();
	}, [config]);
	return <div ref={host} data-native-mascot={config.provider} />;
}
export function NativeMascot() {
	const f = useFeature("live2d"),
		desktop = useMedia("(min-width:768px)");
	return f.enabled && desktop ? (
		<MascotHost key={JSON.stringify(f)} config={f} />
	) : null;
}
