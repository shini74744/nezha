// @ts-nocheck
// Migrated source for the built-in sponsor feature; resources are owned by FeatureScope.
import { FeatureScope } from "../scope";
import { anchorSponsor } from "./sponsor-anchor";

export function sponsor(scope, config) {
  let mobile = window.innerWidth <= 640;
  let child = new FeatureScope("sponsor");
  mountSponsor(child, config);
  scope.own(() => child.dispose());
  scope.listen(window, "resize", () => {
    const nextMobile = window.innerWidth <= 640;
    if (mobile === nextMobile) return;
    mobile = nextMobile;
    child.dispose();
    child = new FeatureScope("sponsor");
    mountSponsor(child, config);
  }, { passive: true });
}
function mountSponsor(scope, config) {
const window = scope.window; const document = scope.document;
scope.style("\n:root {\n  --bm-bg: rgba(255,255,255,.75);\n  --bm-bg-dark: rgba(20,20,20,.65);\n  --bm-desktop-top: 310px;\n  --bm-shrink-duration: 15000ms;\n  --bm-fade-duration: 500ms;\n}\n\n.bm-wrap {\n  position: absolute;\n  top: var(--bm-desktop-top);\n  left: 50%;\n  transform: translateX(-50%);\n  z-index: 9999;\n  display: none;\n  opacity: 1;\n  transition:\n    opacity var(--bm-fade-duration) ease,\n    transform var(--bm-fade-duration) ease;\n}\n\n.bm-wrap .bottom-marquee {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  height: 62px;\n  padding: 0 16px;\n  border: 2px solid transparent;\n  border-radius: 999px;\n  overflow: hidden;\n  pointer-events: auto;\n\n  box-shadow: 0 10px 24px rgba(0,0,0,.18);\n\n  backdrop-filter: blur(10px);\n  -webkit-backdrop-filter: blur(10px);\n\n  background:\n    var(--bm-bg) padding-box,\n    linear-gradient(\n      90deg,\n      #ff3b30,\n      #ffcc00,\n      #34c759,\n      #007aff,\n      #ff3b30\n    ) border-box;\n\n  background-repeat: no-repeat;\n  background-size: auto, 200% 100%;\n\n  animation: bm-border 6s linear infinite;\n\n  transition:\n    height var(--bm-shrink-duration) ease;\n}\n\n.dark .bm-wrap .bottom-marquee {\n  background:\n    var(--bm-bg-dark) padding-box,\n    linear-gradient(\n      90deg,\n      #ff3b30,\n      #ffcc00,\n      #34c759,\n      #007aff,\n      #ff3b30\n    ) border-box;\n}\n\n@keyframes bm-border {\n  0% {\n    background-position: 0 0, 0% 0;\n  }\n\n  100% {\n    background-position: 0 0, 200% 0;\n  }\n}\n\n.bm-wrap .bm-track {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n\n  overflow-x: auto;\n  -webkit-overflow-scrolling: touch;\n\n  -ms-overflow-style: none;\n  scrollbar-width: none;\n}\n\n.bm-wrap .bm-track::-webkit-scrollbar {\n  display: none;\n}\n\n.bm-wrap .bm-item {\n  display: flex;\n  align-items: center;\n  white-space: nowrap;\n\n  opacity: .95;\n\n  font-size: 25px;\n  font-weight: 600;\n  line-height: 62px;\n\n  transition:\n    font-size var(--bm-shrink-duration) ease,\n    line-height var(--bm-shrink-duration) ease;\n}\n\n.bm-wrap .bm-item a {\n  flex-shrink: 0;\n}\n\n.bm-wrap .bm-logo {\n  height: 48px;\n  width: auto;\n  object-fit: contain;\n  margin: 0 5px;\n\n  transition:\n    height var(--bm-shrink-duration) ease;\n}\n\n\n/* PC 缩小后的状态 */\n.bm-wrap.bm-compact .bottom-marquee {\n  height: 42px;\n}\n\n.bm-wrap.bm-compact .bm-item {\n  font-size: 14px;\n  line-height: 42px;\n}\n\n.bm-wrap.bm-compact .bm-logo {\n  height: 28px;\n}\n\n\n/* PC 消失状态 */\n.bm-wrap.bm-pc-hidden {\n  opacity: 0;\n  transform:\n    translateX(-50%)\n    translateY(-20px);\n}\n\n\n/* ==================== 移动端 ==================== */\n@media (max-width: 640px) {\n  .bm-wrap {\n    position: fixed !important;\n\n    top: auto !important;\n    bottom: 0 !important;\n    left: 0 !important;\n    right: 0 !important;\n\n    width: 100vw !important;\n    margin: 0 !important;\n\n    z-index: 9999 !important;\n\n    opacity: 0;\n\n    transform:\n      translateY(100%) !important;\n\n    transition:\n      transform var(--bm-fade-duration) ease,\n      opacity var(--bm-fade-duration) ease;\n  }\n\n  .bm-wrap.bm-mobile-visible {\n    opacity: 1;\n\n    transform:\n      translateY(0) !important;\n  }\n\n  .bm-wrap .bottom-marquee {\n    height: 32px !important;\n    border-radius: 0;\n  }\n\n  .bm-wrap .bm-item {\n    font-size: 13px !important;\n    line-height: 32px !important;\n  }\n\n  .bm-wrap .bm-logo {\n    height: 20px !important;\n  }\n}\n");
function setupSponsor(config) {
  if (!config.enabled) {
    return;
  }
  if (document.getElementById("bmWrap")) {
    return;
  }
  scope.styleOf(document.documentElement).setProperty("--bm-desktop-top", config.desktopTop || "310px");
  scope.styleOf(document.documentElement).setProperty("--bm-shrink-duration", Math.max(0, Number(config.shrinkDuration) || 0) + "ms");
  scope.styleOf(document.documentElement).setProperty("--bm-fade-duration", Math.max(0, Number(config.fadeDuration) || 0) + "ms");
  const wrap = scope.createElement("div");
  wrap.className = "bm-wrap";
  wrap.id = "bmWrap";
  const marquee = scope.createElement("div");
  marquee.className = "bottom-marquee";
  marquee.setAttribute("role", "region");
  marquee.setAttribute("aria-label", "赞助商");
  const track = scope.createElement("div");
  track.className = "bm-track";
  const startText = scope.createElement("span");
  startText.className = "bm-item";
  startText.textContent = config.startText || "感谢";
  scope.append(track, startText);
  (config.sponsors || []).forEach(item => {
    const span = scope.createElement("span");
    span.className = "bm-item";
    const link = scope.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const img = scope.createElement("img");
    img.src = item.logo;
    img.alt = (item.name || "赞助商") + " Logo";
    img.className = "bm-logo";
    scope.append(link, img);
    scope.append(span, link);
    scope.append(track, span);
  });
  const endText = scope.createElement("span");
  endText.className = "bm-item";
  endText.textContent = config.endText || "的赞助支持！";
  scope.append(track, endText);
  scope.append(marquee, track);
  scope.append(wrap, marquee);
  scope.append(document.body, wrap);
  if (window.innerWidth > 640 && config.desktop) {
    const isTargetPage = !config.homeOnly || location.pathname === "/" || location.pathname === "";
    if (!isTargetPage) {
      scope.styleOf(wrap).display = "none";
    } else {
      let shrinkTimer = null;
      let hideTimer = null;
      let removeTimer = null;
      let phase = "shrinking";
      let hovered = false;
      let deadline = 0;
      const shrinkDuration = Math.max(0, Number(config.shrinkDuration) || 0);
      const stayDuration = Math.max(0, Number(config.stayDuration) || 0);
      const fadeDuration = Math.max(0, Number(config.fadeDuration) || 0);
      let remainingStay = stayDuration;
      function hideDesktop() {
        if (phase === "hidden") {
          return;
        }
        phase = "hidden";
        scope.clearTimeout(shrinkTimer);
        scope.clearTimeout(hideTimer);
        scope.clearTimeout(removeTimer);
        shrinkTimer = null;
        hideTimer = null;
        wrap.classList.add("bm-pc-hidden");
        removeTimer = scope.setTimeout(() => {
          scope.styleOf(wrap).display = "none";
        }, fadeDuration);
      }
      function startStayTimer() {
        if (phase !== "staying") {
          return;
        }
        if (hideTimer) {
          return;
        }
        if (config.pauseOnHover && hovered) {
          return;
        }
        if (remainingStay <= 0) {
          hideDesktop();
          return;
        }
        deadline = performance.now() + remainingStay;
        hideTimer = scope.setTimeout(() => {
          hideTimer = null;
          remainingStay = 0;
          hideDesktop();
        }, remainingStay);
      }
      function pauseStayTimer() {
        if (phase !== "staying" || !hideTimer) {
          return;
        }
        scope.clearTimeout(hideTimer);
        hideTimer = null;
        remainingStay = Math.max(0, deadline - performance.now());
      }
      function beginStay() {
        if (phase !== "shrinking") {
          return;
        }
        phase = "staying";
        remainingStay = stayDuration;
        startStayTimer();
      }
      if (config.pauseOnHover) {
        scope.listen(wrap, "mouseenter", () => {
          hovered = true;
          pauseStayTimer();
        });
        scope.listen(wrap, "mouseleave", () => {
          hovered = false;
          startStayTimer();
        });
      }
      scope.styleOf(wrap).display = "block";
      anchorSponsor(scope, wrap);
      scope.requestAnimationFrame(() => {
        scope.requestAnimationFrame(() => {
          wrap.classList.add("bm-compact");
        });
      });
      shrinkTimer = scope.setTimeout(beginStay, shrinkDuration);
    }
  }
  if (window.innerWidth <= 640 && config.mobile) {
    let hideDisplayTimer = null;
    let scrollFrame = null;
    const fadeDuration = Math.max(0, Number(config.fadeDuration) || 0);
    const threshold = Math.max(0, Number(config.mobileBottomThreshold) || 0);
    function showMobile() {
      scope.clearTimeout(hideDisplayTimer);
      if (scope.styleOf(wrap).display !== "block") {
        scope.styleOf(wrap).display = "block";
      }
      scope.requestAnimationFrame(() => {
        wrap.classList.add("bm-mobile-visible");
      });
    }
    function hideMobile() {
      if (scope.styleOf(wrap).display === "none") {
        return;
      }
      wrap.classList.remove("bm-mobile-visible");
      scope.clearTimeout(hideDisplayTimer);
      hideDisplayTimer = scope.setTimeout(() => {
        if (!wrap.classList.contains("bm-mobile-visible")) {
          scope.styleOf(wrap).display = "none";
        }
      }, fadeDuration);
    }
    function checkBottom() {
      scrollFrame = null;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const windowHeight = window.innerHeight;
      const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      if (scrollTop + windowHeight >= docHeight - threshold) {
        showMobile();
      } else {
        hideMobile();
      }
    }
    function scheduleCheck() {
      if (scrollFrame) {
        return;
      }
      scrollFrame = scope.requestAnimationFrame(checkBottom);
    }
    scope.styleOf(wrap).display = "none";
    scope.listen(window, "scroll", scheduleCheck, {
      passive: true
    });
    scope.listen(document, "scroll", scheduleCheck, true);
    scheduleCheck();
  }
}
setupSponsor(config);
}
