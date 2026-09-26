// @ts-nocheck
// Migrated source for the built-in fragments feature; resources are owned by FeatureScope.
export function fragments(scope, config) {
const window = scope.window; const document = scope.document;
(function () {
  const _0x24e8cf = scope.createElement("style");
  _0x24e8cf.textContent = "\n    \n\n    .fragment {\n      position: fixed;\n      width: 10px;\n      height: 10px;\n      clip-path: polygon(0 0, 100% 0, 100% 100%);\n      transform-origin: center;\n      animation: shatter 1.5s ease-out forwards;\n      pointer-events: none;\n      z-index: 9988;\n      background-color: rgba(255, 255, 255, 0.8);\n    }\n\n    @keyframes shatter {\n      0% {\n        transform: translate(0, 0) scale(1);\n        opacity: 1;\n      }\n      100% {\n        transform: translate(var(--dx), var(--dy)) rotate(var(--angle)) scale(0.5);\n        opacity: 0;\n      }\n    }\n\n    #backToTop {\n      position: fixed;\n      bottom: 30px;\n      right: 30px;\n      z-index: 1000;\n      background-color: transparent;\n      color: white;\n      border: none;\n      border-radius: 50%;\n      width: 60px;\n      height: 60px;\n      font-size: 24px;\n      cursor: pointer;\n      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);\n      transition: opacity 0.3s, transform 0.3s;\n      display: none;\n    }\n\n    #backToTop:hover {\n      transform: scale(1.1);\n    }\n\n    #backToTop::before {\n      content: \"\uD83D\uDE80\";\n      font-size: 24px;\n      display: block;\n      line-height: 60px;\n      text-align: center;\n    }\n  ";
  scope.append(document.head, _0x24e8cf);
  const _0x51801b = scope.createElement("button");
  _0x51801b.id = "backToTop";
  scope.append(document.body, _0x51801b);
  scope.listen(document, "click", _0x2724db => {
    _0x17d946(_0x2724db.clientX, _0x2724db.clientY);
  });
  function _0x17d946(_0x4bee83, _0x2ba114) {
    const _0x37941d = config.count;
    for (let _0x2af445 = 0; _0x2af445 < _0x37941d; _0x2af445++) {
      const _0x3ab0e3 = scope.createElement("div");
      _0x3ab0e3.className = "fragment";
      const _0x3c3555 = Math.random() * 360;
      const _0x4f8348 = Math.random() * 200 + 50;
      const _0x16c819 = Math.cos(_0x3c3555 * Math.PI / 180) * _0x4f8348;
      const _0x676744 = Math.sin(_0x3c3555 * Math.PI / 180) * _0x4f8348;
      scope.styleOf(_0x3ab0e3).left = _0x4bee83 + "px";
      scope.styleOf(_0x3ab0e3).top = _0x2ba114 + "px";
      scope.styleOf(_0x3ab0e3).setProperty("--dx", _0x16c819 + "px");
      scope.styleOf(_0x3ab0e3).setProperty("--dy", _0x676744 + "px");
      scope.styleOf(_0x3ab0e3).setProperty("--angle", Math.random() * 720 + "deg");
      scope.append(document.body, _0x3ab0e3);
      scope.setTimeout(() => scope.remove(_0x3ab0e3), 1500);
    }
  }
  scope.listen(window, "scroll", () => {
    if (window.scrollY > 300) {
      scope.styleOf(_0x51801b).display = "block";
    } else {
      scope.styleOf(_0x51801b).display = "none";
    }
  });
  scope.listen(_0x51801b, "click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
})();
}
