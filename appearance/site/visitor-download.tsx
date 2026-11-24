import { useEffect, useRef, useState } from "react";

const endpoint = "https://speed.cloudflare.com/__down";
const warmupBytes = 32 * 1024;
const maxTestBytes = 8 * 1024 * 1024;

async function download(bytes: number, signal: AbortSignal) {
	const started = performance.now();
	const response = await fetch(`${endpoint}?bytes=${bytes}`, {
		signal,
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
	});
	if (
		!response.ok ||
		!response.headers
			.get("content-type")
			?.startsWith("application/octet-stream") ||
		!response.body
	)
		throw new Error("Invalid speed test response");

	let received = 0;
	const reader = response.body.getReader();
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > bytes) throw new Error("Oversized speed test response");
		}
	} finally {
		reader.releaseLock();
	}
	const duration = performance.now() - started;
	if (received !== bytes || duration <= 0)
		throw new Error("Incomplete speed test");
	return { bytesPerMs: received / duration, duration };
}

export function VisitorDownload() {
	const request = useRef<AbortController | null>(null);
	const [label, setLabel] = useState("下载测速");
	const [busy, setBusy] = useState(false);

	useEffect(
		() => () => {
			request.current?.abort();
			request.current = null;
		},
		[],
	);

	async function measure() {
		if (request.current) return;
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		setLabel("下载测速中…");
		const timeout = setTimeout(() => controller.abort(), 12000);
		try {
			const warmup = await download(warmupBytes, controller.signal);
			// Aim for one second on the warmed connection, within the transfer budget.
			const size = Math.min(
				maxTestBytes - warmupBytes,
				Math.max(warmupBytes, Math.ceil(warmup.bytesPerMs * 1000)),
			);
			let sample = await download(size, controller.signal);
			const remaining = maxTestBytes - warmupBytes - size;
			if (sample.duration < 500 && remaining >= size * 2) {
				const largerSize = Math.min(
					remaining,
					Math.ceil(sample.bytesPerMs * 1000),
				);
				sample = await download(largerSize, controller.signal);
			}
			if (request.current === controller)
				setLabel(
					`Cloudflare ↓ ${((sample.bytesPerMs * 8) / 1000).toFixed(2)} Mbps`,
				);
		} catch {
			if (request.current === controller)
				setLabel(
					controller.signal.aborted ? "测速超时 · 重试" : "测速失败 · 重试",
				);
		} finally {
			clearTimeout(timeout);
			controller.abort();
			if (request.current === controller) {
				request.current = null;
				setBusy(false);
			}
		}
	}

	return (
		<button
			type="button"
			className="ip-net ip-download"
			disabled={busy}
			aria-busy={busy}
			title="浏览器到 Cloudflare 的实际下载速度，点击测速"
			onClick={() => void measure()}
		>
			{" · "}
			<span aria-live="polite">{label}</span>
		</button>
	);
}
