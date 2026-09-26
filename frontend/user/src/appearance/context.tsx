import { createContext, useContext, useMemo, type ReactNode } from "react";
import { normalize, type AppearanceConfig, type Feature } from "./config";
const Context = createContext<AppearanceConfig>(normalize());
export function AppearanceProvider({
	raw,
	children,
}: {
	raw?: string;
	children: ReactNode;
}) {
	const config = useMemo(() => normalize(raw), [raw]);
	return <Context.Provider value={config}>{children}</Context.Provider>;
}
export function useAppearance() {
	return useContext(Context);
}
export function useFeature(key: string): Feature {
	const config = useAppearance();
	const feature = config.features[key] || { enabled: false };
	return config.enabled ? feature : { ...feature, enabled: false };
}
