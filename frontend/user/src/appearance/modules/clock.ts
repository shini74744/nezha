// @ts-nocheck
// Migrated source for the built-in clock feature; resources are owned by FeatureScope.
import { mixClockColor } from "../greeting-clock";
export function clock(scope, config) {
const window = scope.window; const document = scope.document;
(function () {
  // Colors are validated and merged with the legacy defaults by config.ts.
  let lastTime = {
    h: null,
    m: null,
    s: null
  };
  function applyColorToGroup(group, color) {
    if (!group) return;
    scope.styleOf(group).color = color;
    group.querySelectorAll('[data-issues-count-enter], [data-issues-count-exit]').forEach(el => {
      scope.styleOf(el).color = color;
    });
  }
  function getDirectTimeGroups(root) {
    if (!root) return [];
    const groups = [];
    for (const child of root.children) {
      if (child.matches && child.matches('[data-issues-count-animation="true"]')) {
        groups.push(child);
        continue;
      }
      const directAnimatedChild = Array.from(child.children || []).find(el => el.matches && el.matches('[data-issues-count-animation="true"]'));
      if (directAnimatedChild) {
        groups.push(directAnimatedChild);
      }
    }
    return groups;
  }
  function findTimeRoot() {
    const roots = document.querySelectorAll('div.flex.items-center.font-medium.text-sm');
    for (const root of roots) {
      const groups = getDirectTimeGroups(root);
      const colonCount = Array.from(root.children).filter(el => el.tagName === 'SPAN' && el.textContent.trim() === ':').length;
      if (groups.length === 3 && colonCount === 2) {
        return root;
      }
    }
    return null;
  }
  function colorizeTime(force = false) {
    const root = findTimeRoot();
    if (!root) return;
    const groups = getDirectTimeGroups(root);
    if (groups.length !== 3) return;
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    const hourColor = mixClockColor(config.hourStartColor, config.hourEndColor, h / 23);
    const minColor = mixClockColor(config.minuteStartColor, config.minuteEndColor, m / 59);
    const secColor = mixClockColor(config.secondStartColor, config.secondEndColor, s / 59);
    if (force || h !== lastTime.h) applyColorToGroup(groups[0], hourColor);
    if (force || m !== lastTime.m) applyColorToGroup(groups[1], minColor);
    if (force || s !== lastTime.s) applyColorToGroup(groups[2], secColor);
    root.querySelectorAll('span.opacity-50').forEach(el => {
      scope.styleOf(el).color = 'rgba(255,255,255,0.72)';
    });
    lastTime = {
      h,
      m,
      s
    };
  }
  colorizeTime(true);
  scope.setInterval(() => {
    colorizeTime(false);
  }, 250);
  const observer = scope.mutationObserver(() => {
    colorizeTime(true);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
}
