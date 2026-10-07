import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode, useEffect } from "react";
import ChartMountBoundary from "@/components/ChartMountBoundary";

afterEach(() => { cleanup(); vi.runAllTimers(); vi.useRealTimers(); });
async function frame() {
 await act(async () => { vi.advanceTimersByTime(17); });
 await act(async () => { vi.advanceTimersByTime(1); });
}
it("mounts one chart per paint and keeps all data after initialization", async () => {
 vi.useFakeTimers();
 const view = render(<><ChartMountBoundary><span>CPU</span></ChartMountBoundary><ChartMountBoundary><span>Memory</span></ChartMountBoundary></>);
 expect(screen.queryByText("CPU")).toBeNull();
 await frame();
 expect(screen.getByText("CPU")).toBeVisible();
 expect(screen.queryByText("Memory")).toBeNull();
 await frame();
 expect(screen.getByText("Memory")).toBeVisible();
 view.rerender(<><ChartMountBoundary><span>CPU 42</span></ChartMountBoundary><ChartMountBoundary><span>Memory 53</span></ChartMountBoundary></>);
 expect(screen.getByText("CPU 42")).toBeVisible();
 expect(screen.getByText("Memory 53")).toBeVisible();
});
it("cancels obsolete queued charts, including StrictMode effect restarts", async () => {
 vi.useFakeTimers();
 const mounted = vi.fn();
 function Old() {useEffect(mounted, []);return <span>old server</span>;}
 const view = render(<StrictMode><ChartMountBoundary key="old"><Old/></ChartMountBoundary></StrictMode>);
 view.rerender(<StrictMode><ChartMountBoundary key="new"><span>new server</span></ChartMountBoundary></StrictMode>);
 await frame(); await frame();
 expect(screen.getByText("new server")).toBeVisible();
 expect(screen.queryByText("old server")).toBeNull();
 expect(mounted).not.toHaveBeenCalled();
});
it("does not deadlock later mounts after leaving during initialization", async () => {
 vi.useFakeTimers();
 const view = render(<ChartMountBoundary><span>leaving</span></ChartMountBoundary>);
 view.unmount();
 await frame();
 render(<ChartMountBoundary><span>returned</span></ChartMountBoundary>);
 await frame();
 expect(screen.getByText("returned")).toBeVisible();
});
