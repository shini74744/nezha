import { FeatureScope } from "../scope";

// Keep the capsule inside the actual free space between view/group and sort controls.
export function anchorSponsor(scope: FeatureScope, wrap: HTMLElement) {
  let frame = 0;
  const observed = new Set<Element>();
  const schedule = () => {
    if (!frame) frame = scope.requestAnimationFrame(() => { frame = 0; update(); });
  };
  const resize = scope.resizeObserver(schedule);
  function update() {
    const row = document.querySelector<HTMLElement>(".server-overview-controls");
    const leftGroup = row?.querySelector(":scope > section");
    const sort = row?.querySelector(":scope > div:last-child");
    const targets = [wrap, row, row?.parentElement, sort, ...(leftGroup?.children || [])]
      .filter((el): el is Element => !!el);
    for (const el of observed) if (!targets.includes(el)) { resize.unobserve(el); observed.delete(el); }
    for (const el of targets) if (!observed.has(el)) { resize.observe(el); observed.add(el); }
    if (!row || !sort || !row.getClientRects().length) { wrap.style.visibility = "hidden"; return; }
    const bounds = row.getBoundingClientRect();
    let left = bounds.left;
    for (const child of leftGroup?.children || []) {
      const rect = child.getBoundingClientRect();
      if (rect.width && rect.height) left = Math.max(left, rect.right);
    }
    const right = sort.getBoundingClientRect().left;
    const width = Math.max(0, right - left - 24);
    const height = Math.max(0, bounds.height + 32);
    const naturalWidth = wrap.offsetWidth, naturalHeight = wrap.offsetHeight;
    if (width < 80 || !naturalWidth || !naturalHeight) { wrap.style.visibility = "hidden"; return; }
    const scale = Math.min(1, width / naturalWidth, height / naturalHeight);
    wrap.style.left = (left + right) / 2 + "px";
    wrap.style.top = bounds.top + bounds.height / 2 + "px";
    wrap.style.setProperty("--bm-fit", String(scale));
    wrap.style.visibility = "visible";
  }
  scope.style(`@media (min-width:641px) {
    .bm-wrap, .bm-wrap.bm-pc-hidden {
      position:fixed; width:max-content; max-width:none;
      transform:translate(-50%,-50%) scale(var(--bm-fit,1));
      transform-origin:center; transition:opacity var(--bm-fade-duration) ease;
    }
  }`);
  wrap.style.visibility = "hidden";
  scope.listen(window, "resize", schedule, { passive: true });
  scope.listen(document, "scroll", schedule, true);
  scope.listen(document, "load", schedule, true);
  scope.listen(document.fonts, "loadingdone", schedule);
  scope.mutationObserver(records => {
    if (records.some(r => r.target !== wrap && !wrap.contains(r.target))) schedule();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  update();
}
