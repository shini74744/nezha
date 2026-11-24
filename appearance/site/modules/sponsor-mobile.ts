import type { FeatureScope } from "../scope";

// Measure the content footer, not scrollHeight: a transformed fixed sponsor can
// itself extend scrollHeight and make a fast bottom fling alternate show/hide.
export function anchorMobileSponsor(
	scope: FeatureScope,
	wrap: HTMLElement,
	threshold: number,
) {
	let frame = 0,
		visible = false;
	const watched = new Set<Element>();
	scope.style(`
 @media(max-width:640px) {
  .nz-footer-region { padding-bottom:calc(18px + env(safe-area-inset-bottom,0px)); }
  .nz-footer-region > footer { padding-bottom:0; }
  #bmWrap {display:block!important;visibility:hidden;pointer-events:none;will-change:transform,opacity;}
  #bmWrap.bm-mobile-visible {visibility:visible;pointer-events:auto;}
  #bmWrap .bottom-marquee {padding-bottom:env(safe-area-inset-bottom,0px);height:calc(32px + env(safe-area-inset-bottom,0px))!important;}
  #bmWrap:not(.bm-mobile-visible) .bottom-marquee {pointer-events:none;}
 }
 @media(prefers-reduced-motion:reduce) {#bmWrap{transition:none!important;}}
 `);
	scope.styleOf(wrap).display = "block";
	wrap.inert = true;
	wrap.setAttribute("aria-hidden", "true");
	const schedule = () => {
		if (!frame)
			frame = scope.requestAnimationFrame(() => {
				frame = 0;
				measure();
			});
	};
	const resize = scope.resizeObserver(schedule);
	const intersection = new IntersectionObserver(schedule, {
		rootMargin: "0px 0px " + Math.max(2, threshold) + "px 0px",
	});
	scope.own(() => intersection.disconnect());
	function measure() {
		const footer = document.querySelector<HTMLElement>("[data-footer-region]");
		const targets = [
			footer,
			document.querySelector("main"),
			document.body,
		].filter((el): el is HTMLElement => !!el);
		for (const el of watched)
			if (!targets.includes(el as HTMLElement)) {
				resize.unobserve(el);
				intersection.unobserve(el);
				watched.delete(el);
			}
		for (const el of targets)
			if (!watched.has(el)) {
				resize.observe(el);
				if (el === footer) intersection.observe(el);
				watched.add(el);
			}
		const viewport = window.visualViewport;
		const bottom =
			(viewport?.offsetTop || 0) + (viewport?.height || innerHeight);
		const edge = footer?.getBoundingClientRect().bottom;
		// Small hysteresis absorbs mobile toolbar and fractional-pixel bounce.
		const near =
			footer?.getClientRects().length && edge !== undefined
				? edge <= bottom + Math.max(2, threshold) + (visible ? 24 : 0)
				: false;
		if (near === visible) return;
		visible = near;
		wrap.classList.toggle("bm-mobile-visible", visible);
		wrap.inert = !visible;
		wrap.setAttribute("aria-hidden", String(!visible));
	}
	scope.listen(window, "scroll", schedule, { passive: true });
	scope.listen(document, "scrollend", schedule, { passive: true });
	scope.listen(window, "resize", schedule, { passive: true });
	scope.listen(window, "pageshow", schedule);
	scope.listen(document, "load", schedule, true);
	scope.listen(document.fonts, "loadingdone", schedule);
	if (window.visualViewport) {
		scope.listen(window.visualViewport, "resize", schedule, { passive: true });
		scope.listen(window.visualViewport, "scroll", schedule, { passive: true });
	}
	scope
		.mutationObserver((records) => {
			if (records.some((x) => x.target !== wrap && !wrap.contains(x.target)))
				schedule();
		})
		.observe(document.body, { childList: true, subtree: true });
	schedule();
}
