import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, useState } from "react";
import { expect, it, vi } from "vitest";
import { preloadableView } from "@/lib/preloadable-view";
function Counter({ label }: { label: string }) {
	const [value, setValue] = useState(0);
	return <button onClick={() => setValue(v => v + 1)}>{label}:{value}</button>;
}
it("renders preloaded code immediately without entering Suspense", async () => {
	const loader = vi.fn(async () => ({ default: Counter }));
	const { load, View } = preloadableView<{ label: string }>(loader);
	await Promise.all([load(), load()]);
	render(<Suspense fallback={<p>loading</p>}><View label="warm" /></Suspense>);
	expect(screen.getByRole("button")).toHaveTextContent("warm:0");
	expect(screen.queryByText("loading")).not.toBeInTheDocument();
	expect(loader).toHaveBeenCalledOnce();
});
it("cold loading preserves component state on subsequent rerenders after preload resolves", async () => {
	let resolve!: (module: { default: typeof Counter }) => void;
	const { View } = preloadableView<{ label: string }>(() => new Promise(r => { resolve = r; }));
	const view = render(<Suspense fallback={<p>loading</p>}><View label="cold" /></Suspense>);
	expect(screen.getByText("loading")).toBeInTheDocument();
	await act(async () => resolve({ default: Counter }));
	fireEvent.click(screen.getByRole("button"));
	view.rerender(<Suspense fallback={<p>loading</p>}><View label="changed" /></Suspense>);
	expect(screen.getByRole("button")).toHaveTextContent("changed:1");
});
it("a failed speculative import can be retried before mounting", async () => {
	const loader = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue({ default: Counter });
	const { load, View } = preloadableView<{ label: string }>(loader);
	await expect(load()).rejects.toThrow("temporary");
	await load();
	render(<Suspense fallback={<p>loading</p>}><View label="retry" /></Suspense>);
	expect(screen.getByRole("button")).toHaveTextContent("retry:0");
	expect(loader).toHaveBeenCalledTimes(2);
});
