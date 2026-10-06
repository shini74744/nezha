import { useDeferredValue, type ReactNode } from "react";

// Mount each selected pane in an interruptible render. The keyed boundary is
// discarded on the next selection, so an obsolete pane cannot appear later.
export default function DetailPanel({ children }: { children: ReactNode }) {
 const ready = useDeferredValue(true, false);
 if (!ready) return <div data-detail-section-loading role="status" className="rounded-xl border bg-card/70 p-5 text-sm text-muted-foreground">正在加载…</div>;
 return children;
}
