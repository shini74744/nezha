import { useEffect, useState, type ReactNode } from "react";

// Paint the selected tab before mounting its pane. A deferred initial render
// can otherwise be restarted indefinitely by frequent live/appearance updates.
// The keyed boundary cancels obsolete work; individual plots retain their queue.
export default function DetailPanel({ children }: { children: ReactNode }) {
 const [ready, setReady] = useState(false);
 useEffect(() => {
  let task: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => { task = setTimeout(() => setReady(true), 0); });
  return () => { cancelAnimationFrame(frame); clearTimeout(task); };
 }, []);
 if (!ready) return <div data-detail-section-loading role="status" className="rounded-xl border bg-card/70 p-5 text-sm text-muted-foreground">正在加载…</div>;
 return children;
}
