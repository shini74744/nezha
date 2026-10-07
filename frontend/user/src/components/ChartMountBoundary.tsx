import { useEffect, useRef, useState, type ReactNode } from "react";

// Recharts commits layout/store updates synchronously. Admitting one new chart
// per paint/task gives pending pointer and keyboard events a chance to run.
type MountJob = { start: () => void; cancelled: boolean };
const queue: MountJob[] = [];
let active: MountJob | undefined;
let scheduled = false;
function drain() {
 if (active || scheduled || queue.length === 0) return;
 scheduled = true;
 requestAnimationFrame(() => setTimeout(() => {
  scheduled = false;
  let job: MountJob | undefined;
  while ((job = queue.shift())) {
   if (job.cancelled) continue;
   active = job;
   job.start();
   break;
  }
 }, 0));
}
function enqueue(start: () => void) {
 const job = { start, cancelled: false };
 queue.push(job);
 drain();
 return () => {
  job.cancelled = true;
  if (active === job) active = undefined;
  drain();
 };
}

export default function ChartMountBoundary({ children }: { children: ReactNode }) {
 const [ready, setReady] = useState(false);
 const release = useRef<(() => void) | undefined>(undefined);
 useEffect(() => {
  release.current = enqueue(() => setReady(true));
  return () => release.current?.();
 }, []);
 useEffect(() => {
  if (ready) release.current?.();
 }, [ready]);
 return ready ? children : <div data-chart-mount-pending className="h-full w-full animate-pulse motion-reduce:animate-none rounded bg-muted/30" aria-hidden />;
}
