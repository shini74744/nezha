import {afterEach, describe, expect, it, vi} from "vitest";
import {FeatureScope} from "@/appearance/scope";
import {heart} from "@/appearance/modules/heart";
let scope: FeatureScope | undefined;
afterEach(() => {scope?.dispose(); vi.useRealTimers();});
describe("decorative heart pointer safety", () => {
 it("keeps visible animated hearts click-through across animation frames", () => {
  vi.useFakeTimers();
  scope = new FeatureScope("heart");
  heart(scope, {});
  window.onclick!.call(window, new PointerEvent("click", {clientX:100, clientY:100}));
  const node = document.querySelector<HTMLElement>(".heart")!;
  expect(node).not.toBeNull();
  expect(getComputedStyle(node).pointerEvents).toBe("none");
  const css = document.querySelector('style[data-nezha-appearance="heart"]')!.textContent!;
  expect(css).toContain(".heart,.heart:before,.heart:after{pointer-events:none;}");
  vi.advanceTimersByTime(48);
  expect(getComputedStyle(node).pointerEvents).toBe("none");
  expect(Number(node.style.opacity)).toBeGreaterThan(0);
  expect(node.style.transform).toContain("rotate(45deg)");
  expect(node.style.background).not.toBe("");
  vi.advanceTimersByTime(2000);
  expect(document.querySelector(".heart")).toBeNull();
 });
});
