// Each built-in feature owns its DOM, events, timers, styles and requests.
export class FeatureScope {
	active = true;
	private cleanups = new Set<() => void>();
	private nodes = new Set<Element>();
	private nodeListeners = new WeakMap<EventTarget, Set<() => void>>();
	private timers = new Set<number>();
	private frames = new Set<number>();
	private abort = new AbortController();
	constructor(readonly name: string) {}
	own = (cleanup: () => void) => {
		if (this.active) this.cleanups.add(cleanup);
		else cleanup();
		return cleanup;
	};
	createElement = (tag: string) => {
		const node = document.createElement(tag);
		node.dataset.nezhaAppearance = this.name;
		if (this.active) this.nodes.add(node);
		return node;
	};
	listen = (
		target: EventTarget,
		type: string,
		callback: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (!this.active || !target) return;
		const once = typeof options === "object" && options.once;
		const wrapped: EventListener = (event) => {
			if (once) off();
			if (this.active) {
				if (typeof callback === "function") callback.call(target, event);
				else callback.handleEvent(event);
			}
		};
		const off = () => {
			target.removeEventListener(type, wrapped, options);
			this.cleanups.delete(off);
			this.nodeListeners.get(target)?.delete(off);
		};
		target.addEventListener(type, wrapped, options);
		this.own(off);
		if (!this.nodeListeners.has(target))
			this.nodeListeners.set(target, new Set());
		this.nodeListeners.get(target)!.add(off);
		return off;
	};
	setTimeout = (
		callback: (...args: any[]) => void,
		delay = 0,
		...args: any[]
	) => {
		if (!this.active) return 0;
		const id = window.setTimeout(() => {
			this.timers.delete(id);
			if (this.active) callback(...args);
		}, delay);
		this.timers.add(id);
		return id;
	};
	clearTimeout = (id: number) => {
		window.clearTimeout(id);
		this.timers.delete(id);
	};
	setInterval = (
		callback: (...args: any[]) => void,
		delay = 0,
		...args: any[]
	) => {
		if (!this.active) return 0;
		const id = window.setInterval(
			() => {
				if (this.active) callback(...args);
			},
			Math.max(16, delay),
		);
		this.timers.add(id);
		return id;
	};
	clearInterval = this.clearTimeout;
	requestAnimationFrame = (callback: FrameRequestCallback) => {
		if (!this.active) return 0;
		const id = window.requestAnimationFrame((time) => {
			this.frames.delete(id);
			if (this.active) callback(time);
		});
		this.frames.add(id);
		return id;
	};
	cancelAnimationFrame = (id: number) => {
		window.cancelAnimationFrame(id);
		this.frames.delete(id);
	};
	mutationObserver = (callback: MutationCallback) => {
		const observer = new MutationObserver((r, o) => {
			if (this.active) callback(r, o);
		});
		this.own(() => observer.disconnect());
		return observer;
	};
	resizeObserver = (callback: ResizeObserverCallback) => {
		const observer = new ResizeObserver((r, o) => {
			if (this.active) callback(r, o);
		});
		this.own(() => observer.disconnect());
		return observer;
	};
	fetch = async (url: RequestInfo | URL, options: RequestInit = {}) => {
		const controller = new AbortController(),
			cancel = () => controller.abort();
		this.abort.signal.addEventListener("abort", cancel, { once: true });
		options.signal?.addEventListener("abort", cancel, { once: true });
		const timeout = window.setTimeout(cancel, 10000);
		const release = () => {
			window.clearTimeout(timeout);
			this.abort.signal.removeEventListener("abort", cancel);
			options.signal?.removeEventListener("abort", cancel);
			this.cleanups.delete(release);
		};
		this.own(release);
		if (!this.active || options.signal?.aborted) controller.abort();
		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});
			if (!this.active)
				throw new DOMException("Feature disposed", "AbortError");
			// Keep abort ownership until the response body has finished being consumed.
			return new Proxy(response, {
				get: (target, key) => {
					const value = Reflect.get(target, key, target);
					if (
						["json", "text", "blob", "arrayBuffer", "formData"].includes(
							String(key),
						)
					)
						return async (...args: any[]) => {
							try {
								return await value.apply(target, args);
							} finally {
								release();
							}
						};
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		} catch (error) {
			release();
			throw error;
		}
	};
	style = (css: string) => {
		if (!this.active) return;
		const node = this.createElement("style");
		node.textContent = css;
		document.head.append(node);
	};
	readonly window = new Proxy(window, {
		get: (target, key) => {
			if (
				[
					"setTimeout",
					"clearTimeout",
					"setInterval",
					"clearInterval",
					"requestAnimationFrame",
					"cancelAnimationFrame",
					"fetch",
				].includes(String(key))
			)
				return (this as any)[key];
			const value = Reflect.get(target, key, target);
			return typeof value === "function" &&
				[
					"getComputedStyle",
					"matchMedia",
					"scrollTo",
					"scrollBy",
					"getSelection",
					"open",
					"alert",
					"atob",
					"btoa",
					"addEventListener",
					"removeEventListener",
					"dispatchEvent",
				].includes(String(key))
				? value.bind(target)
				: value;
		},
		set: (target, key, value) => {
			const previous = Object.getOwnPropertyDescriptor(target, key);
			Reflect.set(target, key, value, target);
			this.own(() => {
				if (Reflect.get(target, key, target) !== value) return;
				if (previous) Object.defineProperty(target, key, previous);
				else Reflect.deleteProperty(target, key);
			});
			return true;
		},
	});
	readonly document = new Proxy(document, {
		get: (target, key) => {
			if (key === "createElement") return this.createElement;
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	private styleRecords = new Map<
		HTMLElement,
		Map<string, { before: string; priority: string; last: string }>
	>();
	styleOf = (node: HTMLElement) => {
		if (!this.active) return document.createElement("div").style;
		if (this.styleRecords.size > 128)
			for (const element of this.styleRecords.keys())
				if (!element.isConnected) this.styleRecords.delete(element);
		if (this.nodes.has(node)) return node.style;
		if (!this.styleRecords.has(node)) this.styleRecords.set(node, new Map());
		const records = this.styleRecords.get(node)!;
		const set = (key: string, value: string, priority = "") => {
			if (!records.has(key))
				records.set(key, {
					before: node.style.getPropertyValue(key),
					priority: node.style.getPropertyPriority(key),
					last: value,
				});
			node.style.setProperty(key, value, priority);
			records.get(key)!.last = node.style.getPropertyValue(key);
		};
		return new Proxy(node.style, {
			get(target, key) {
				if (key === "setProperty") return set;
				const value = Reflect.get(target, key, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
			set(target, key, value) {
				if (key === "cssText") {
					if (!records.has("cssText"))
						records.set("cssText", {
							before: target.cssText,
							priority: "",
							last: "",
						});
					target.cssText = String(value);
					records.get("cssText")!.last = target.cssText;
				} else
					set(
						String(key).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
						String(value),
					);
				return true;
			},
		});
	};
	append = (parent: Node, node: Node) => {
		if (this.active) parent.appendChild(node);
		return node;
	};
	appendMany = (parent: Element, ...nodes: (Node | string)[]) => {
		if (this.active) parent.append(...nodes);
	};
	xmlHttpRequest = () => {
		const xhr = new XMLHttpRequest();
		const cancel = this.own(() => {
			xhr.onload = null;
			xhr.onerror = null;
			xhr.onreadystatechange = null;
			xhr.abort();
		});
		xhr.addEventListener("loadend", () => this.cleanups.delete(cancel), {
			once: true,
		});
		return xhr;
	};
	insertHTML = (node: Element, position: InsertPosition, html: string) => {
		if (!this.active) return;
		const parent = ["beforebegin", "afterend"].includes(position)
			? node.parentElement
			: node;
		if (!parent) return;
		const before = new Set(parent.children);
		node.insertAdjacentHTML(position, html);
		for (const child of parent.children)
			if (!before.has(child)) this.nodes.add(child);
	};
	private releaseNode = (node: Node) => {
		for (const owned of this.nodes)
			if (owned === node || node.contains(owned)) {
				for (const off of this.nodeListeners.get(owned) || []) off();
				this.nodes.delete(owned);
				this.styleRecords.delete(owned as HTMLElement);
			}
	};
	remove = (node: Element) => {
		node.remove();
		this.releaseNode(node);
	};
	detach = (parent: Node, node: Node) => {
		const result = parent.removeChild(node);
		this.releaseNode(node);
		return result;
	};
	dispose = () => {
		if (!this.active) return;
		this.active = false;
		this.abort.abort();
		for (const id of this.timers) window.clearInterval(id);
		for (const id of this.frames) window.cancelAnimationFrame(id);
		for (const cleanup of [...this.cleanups].reverse()) {
			try {
				cleanup();
			} catch (error) {
				console.error("Appearance cleanup failed:", this.name, error);
			}
		}
		for (const node of this.nodes) node.remove();
		for (const [node, records] of this.styleRecords)
			for (const [key, r] of records) {
				if (key === "cssText") {
					if (node.style.cssText === r.last) node.style.cssText = r.before;
				} else if (node.style.getPropertyValue(key) === r.last)
					node.style.setProperty(key, r.before, r.priority);
			}
		this.styleRecords.clear();
		this.nodes.clear();
		this.timers.clear();
		this.frames.clear();
		this.cleanups.clear();
	};
}
