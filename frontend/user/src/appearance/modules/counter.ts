// @ts-nocheck
// Migrated source for the built-in counter feature; resources are owned by FeatureScope.
export function counter(scope, config) {
const window = scope.window; const document = scope.document;
(function () {
  const _0xba1a53 = config.desktopRight;
  const _0x423d55 = config.desktopTop;
  const _0x28f252 = config.desktopWidth;
  const _0x2cb4ad = config.desktopHeight;
  const _0x2de323 = config.mobileTop;
  const _0x3850b3 = config.mobileWidth;
  const _0x187f12 = config.mobileHeight;
  const _0x407d4b = config.mobileOffset;
  const _0x2b52cb = config.scrollThreshold;
  const _0x124e97 = config.imageUrl;
  const _0x2db4f9 = scope.createElement("div");
  _0x2db4f9.className = "footer-background";
  const _0x16f8ff = scope.createElement("style");
  _0x16f8ff.textContent = "\n    .footer-background {\n      background-image: url('" + _0x124e97 + "');\n      background-size: contain;\n      background-repeat: no-repeat;\n      background-position: center center;\n      pointer-events: none;\n      z-index: 9988;\n    }\n\n    /* ✅ PC：右上角悬浮（顶部显示，下滑隐藏） */\n    .footer-background.is-desktop {\n      position: fixed;\n      right: " + _0xba1a53 + "px;   /* ← 改这里：PC左右位置（离右侧距离） */\n      top: " + _0x423d55 + "px;       /* ← 改这里：PC上下位置（离顶部距离） */\n      width: " + _0x28f252 + "px;       /* ← 改这里：PC宽度 */\n      height: " + _0x2cb4ad + "px;      /* ← 改这里：PC高度 */\n      opacity: 0;\n      transform: scale(0);\n      transform-origin: top right;\n      transition: all 0.5s ease-in-out;\n      display: block;\n    }\n\n    /* ✅ 手机：顶部居中固定（顶部显示，下滑隐藏） */\n    .footer-background.is-mobile {\n      position: fixed;\n      left: calc(50% + " + _0x407d4b + "px); /* ← 改这里：手机左右微调 */\n      top: " + _0x2de323 + "px;                   /* ← 改这里：手机距离顶部 */\n      width: " + _0x3850b3 + "px;                   /* ← 改这里：手机宽度 */\n      height: " + _0x187f12 + "px;                  /* ← 改这里：手机高度 */\n      transform: translateX(-50%);\n      opacity: 1;\n      transition: none;\n      display: block;\n    }\n  ";
  scope.append(document.head, _0x16f8ff);
  scope.append(document.body, _0x2db4f9);
  function _0x550212() {
    const _0x54c652 = window.innerWidth < 768;
    const _0x11ebd9 = window.scrollY <= _0x2b52cb;
    if (_0x54c652) {
      _0x2db4f9.classList.remove("is-desktop");
      _0x2db4f9.classList.add("is-mobile");
      scope.styleOf(_0x2db4f9).display = _0x11ebd9 ? "block" : "none";
      return;
    }
    _0x2db4f9.classList.remove("is-mobile");
    _0x2db4f9.classList.add("is-desktop");
    scope.styleOf(_0x2db4f9).opacity = _0x11ebd9 ? "1" : "0";
    scope.styleOf(_0x2db4f9).transform = _0x11ebd9 ? "scale(1)" : "scale(0)";
  }
  scope.listen(window, "scroll", _0x550212, {
    passive: true
  });
  scope.listen(window, "resize", _0x550212);
  scope.listen(window, "load", _0x550212);
  _0x550212();
})();
}
