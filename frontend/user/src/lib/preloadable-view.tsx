import { lazy, useState, type ComponentType } from "react";

// Preloading a native import alone does not initialize React.lazy. A warm view
// can otherwise still suspend (and pay the fallback reveal delay) on first use.
export function preloadableView<Props extends object>(loader: () => Promise<{ default: ComponentType<Props> }>) {
	let loaded: { default: ComponentType<Props> } | undefined;
	let pending: Promise<{ default: ComponentType<Props> }> | undefined;
	const load = () => {
		if (!pending) pending = loader().then(module => {
			loaded = module;
			return module;
		}, error => {
			pending = undefined;
			throw error;
		});
		return pending;
	};
	const Deferred = lazy(load);
	function View(props: Props) {
		// Keep the chosen type for this mount. Switching from lazy to concrete
		// after a cold load would remount it and discard history/form state.
		const [Component] = useState(() => loaded?.default ?? Deferred);
		return <Component {...props} />;
	}
	return { load, View };
}
