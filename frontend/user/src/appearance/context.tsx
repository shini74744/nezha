import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useMemo,
	useRef,
} from "react";

const LayoutContext = createContext<{
	footer: RefObject<HTMLDivElement | null>;
}>({ footer: { current: null } });
export const useAppearanceLayout = () => useContext(LayoutContext);

import { type AppearanceConfig, type Feature, normalize } from "./config";

const Context = createContext<AppearanceConfig>(normalize());
export function AppearanceProvider({
	raw,
	children,
}: {
	raw?: string;
	children: ReactNode;
}) {
	const config = useMemo(() => normalize(raw), [raw]);
	const footer = useRef<HTMLDivElement>(null);
	const layout = useMemo(() => ({ footer }), []);
	return (
		<Context.Provider value={config}>
			<LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>
		</Context.Provider>
	);
}
export function useAppearance() {
	return useContext(Context);
}
export function useFeature(key: string): Feature {
	const config = useAppearance();
	const feature = config.features[key] || { enabled: false };
	return config.enabled ? feature : { ...feature, enabled: false };
}
