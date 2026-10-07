import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// Keep the *current* document offset, not a remembered offset for each tab.
// Reserve only the visible viewport while the keyed pane briefly shows its
// loading fallback. Never retain hidden panes, polling subscriptions, or their
// full document height.
export function useStableDetailViewport(scope: string | number, tab: string) {
 const viewportRef = useRef<HTMLDivElement>(null);
 const floor = useRef(0);
 const pending = useRef<{ x: number; y: number } | null>(null);
 const previousScope = useRef(scope);
 const preserveScroll = useCallback(() => {
  const element = viewportRef.current;
  if (!element) return;
  pending.current = { x: window.scrollX, y: window.scrollY };
  floor.current = Math.max(0, Math.ceil(window.innerHeight - element.getBoundingClientRect().top));
  element.style.minHeight = floor.current ? floor.current + "px" : "";
 }, []);

// biome-ignore lint/correctness/useExhaustiveDependencies: Apply the pending scroll preservation after every tab switch, including equal-height panels.
 useLayoutEffect(() => {
  if (previousScope.current !== scope) {
   previousScope.current = scope;
   pending.current = null;
   floor.current = 0;
   if (viewportRef.current) viewportRef.current.style.minHeight = "";
   return;
  }
  const offset = pending.current;
  pending.current = null;
  if (offset && (window.scrollX !== offset.x || window.scrollY !== offset.y)) {
   window.scrollTo({ left: offset.x, top: offset.y, behavior: "instant" });
  }
 }, [scope, tab]);

 useEffect(() => {
  let frame = 0;
  const releaseUnusedSpace = () => {
   frame = 0;
   const element = viewportRef.current;
   if (!element || !floor.current) return;
   const needed = window.scrollY <= 1 ? 0
    : Math.max(0, Math.ceil(window.innerHeight - element.getBoundingClientRect().top));
   // Scrolling down must not grow a blank tail; scrolling up can release it.
   if (needed < floor.current) {
    floor.current = needed;
    element.style.minHeight = needed ? needed + "px" : "";
   }
  };
  const schedule = () => {
   if (floor.current && !frame) frame = requestAnimationFrame(releaseUnusedSpace);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  return () => {
   cancelAnimationFrame(frame);
   window.removeEventListener("scroll", schedule);
   window.removeEventListener("resize", schedule);
  };
 }, []);
 return { viewportRef, preserveScroll };
}
