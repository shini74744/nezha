// Measure visible glyph bounds instead of centring a font's asymmetric line box.
// One shared observer/frame for all badges; never poll with the server refresh.
const elements = new Set<HTMLElement>();
let context: CanvasRenderingContext2D | null | undefined;
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let frame = 0;
const pending = new Set<HTMLElement>();

export function inkCenterOffset(badgeCenter: number, firstBaseline: number,
 lastBaseline: number, ascent: number, descent: number): number {
 return badgeCenter - (firstBaseline - ascent + lastBaseline + descent) / 2;
}

function edgeLines(node: Text, wrapped: boolean): [string,string] {
 const value = node.data;
 if (!wrapped) return [value,value];
 const range = document.createRange();
 const lines: {top:number;text:string}[] = [];
 let offset = 0;
 for (const character of value) {
  range.setStart(node, offset);
  offset += character.length;
  range.setEnd(node, offset);
  const rect = range.getBoundingClientRect();
  if (!rect.width || !rect.height) continue;
  const line = lines.find(item => Math.abs(item.top - rect.top) < rect.height / 2);
  if (line) line.text += character;
  else lines.push({top:rect.top,text:character});
 }
 range.detach();
 lines.sort((a,b) => a.top-b.top);
 return [lines[0]?.text ?? value,lines[lines.length-1]?.text ?? value];
}

function measure(element: HTMLElement): [HTMLElement,number] | undefined {
 if (!element.isConnected || !element.getClientRects().length) return;
 const badge = element.parentElement;
 const start = element.querySelector<HTMLElement>('[data-badge-baseline="start"]');
 const end = element.querySelector<HTMLElement>('[data-badge-baseline="end"]');
 const node = Array.from(element.childNodes).find(n => n.nodeType === Node.TEXT_NODE) as Text | undefined;
 if (!badge || !start || !end || !node?.data.trim()) return;
 if (context === undefined) context = document.createElement("canvas").getContext("2d");
 if (!context) return; // Plain flex alignment remains usable without Canvas.
 const style = getComputedStyle(element);
 const size = Number.parseFloat(style.fontSize);
 context.textBaseline = "alphabetic";
 context.direction = style.direction === "rtl" ? "rtl" : "ltr";
 context.fontKerning = style.fontKerning as CanvasFontKerning;
 context.letterSpacing = style.letterSpacing;
 const box = element.getBoundingClientRect();
 // CSS zoom and browser zoom must not turn CSS pixels into a fixed physical offset.
 const scale = box.height / Number.parseFloat(style.height);
 if (!Number.isFinite(scale) || scale <= 0) return;
 const first = start.getBoundingClientRect().top;
 const last = end.getBoundingClientRect().top;
 const [firstLine,lastLine] = edgeLines(node, Math.abs(last-first) > size*scale/2);
 // Measure outlines at high precision: 9px metrics are integer-rounded in
 // some engines and otherwise drift at fractional zoom/Windows scaling.
 const metricScale = 100;
 context.font = `${style.fontStyle} ${style.fontWeight} ${size * metricScale}px ${style.fontFamily}`;
 const a = context.measureText(firstLine).actualBoundingBoxAscent / metricScale;
 const d = context.measureText(lastLine).actualBoundingBoxDescent / metricScale;
 if (!Number.isFinite(a) || !Number.isFinite(d)) return;
 const parent = badge.getBoundingClientRect();
 const current = Number.parseFloat(style.getPropertyValue("--badge-ink-offset")) || 0;
 const offset = current + inkCenterOffset(parent.top + parent.height/2,first,last,a*scale,d*scale)/scale;
 // Guard unsupported/custom layout metrics; don't displace text outside its badge.
 if (!Number.isFinite(offset) || Math.abs(offset) > size) return;
 return [element,Math.round(offset*1000)/1000];
}

function flush() {
 frame = 0;
 // Batch all reads before writes to avoid forced layout per badge.
 const updates = Array.from(pending, measure).filter(Boolean) as [HTMLElement,number][];
 pending.clear();
 for (const [element,offset] of updates) {
  const value = offset+"px";
  if (element.style.getPropertyValue("--badge-ink-offset") !== value)
   element.style.setProperty("--badge-ink-offset",value);
 }
}
function schedule(element?: HTMLElement) {
 if (element) pending.add(element);
 else for (const item of elements) pending.add(item);
 if (!frame && pending.size) frame = requestAnimationFrame(flush);
}
const refresh = () => schedule();

function connect() {
 if (typeof ResizeObserver !== "undefined")
  resizeObserver = new ResizeObserver(entries => {
   for (const entry of entries) schedule(entry.target as HTMLElement);
  });
 // Appearance font switching inserts/removes a style in head. Do not observe
 // changing server cards/animations, which would create a measurement loop.
 mutationObserver = new MutationObserver(refresh);
 mutationObserver.observe(document.head,{childList:true,subtree:true,characterData:true});
 mutationObserver.observe(document.documentElement,{attributes:true,attributeFilter:["class","style"]});
 if (document.body) mutationObserver.observe(document.body,{attributes:true,attributeFilter:["class","style"]});
 window.addEventListener("resize",refresh);
 document.fonts?.addEventListener("loadingdone",refresh);
 document.fonts?.addEventListener("loadingerror",refresh);
 void document.fonts?.ready.then(refresh);
}
export function observeBadgeText(element: HTMLElement): () => void {
 if (!elements.size) connect();
 elements.add(element);
 resizeObserver?.observe(element);
 schedule(element);
 return () => {
  elements.delete(element);
  pending.delete(element);
  resizeObserver?.unobserve(element);
  if (!elements.size) {
   resizeObserver?.disconnect();
   mutationObserver?.disconnect();
   window.removeEventListener("resize",refresh);
   document.fonts?.removeEventListener("loadingdone",refresh);
   document.fonts?.removeEventListener("loadingerror",refresh);
   cancelAnimationFrame(frame);
   frame = 0;
  }
 };
}