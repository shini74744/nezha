// @ts-nocheck
// Migrated source for the built-in snow feature; resources are owned by FeatureScope.
export function snow(scope, config) {
const window = scope.window; const document = scope.document;
(function () {
  const _0x49d801 = scope.createElement("style");
  _0x49d801.textContent = "\n      \n\n      .snowflake {\n          position: fixed;\n          top: -10px;\n          color: white;\n          font-size: 10px;\n          animation: fall linear infinite;\n          opacity: 0.8;\n          z-index: 9988;\n          pointer-events: none;\n      }\n\n      @keyframes fall {\n          0% {\n              transform: translateX(0px) translateY(0px);\n              opacity: 0.8;\n          }\n          50% {\n              transform: translateX(20px) translateY(50vh);\n          }\n          100% {\n              transform: translateX(-20px) translateY(100vh);\n              opacity: 0;\n          }\n      }\n  ";
  scope.append(document.head, _0x49d801);
  function _0x3866e2() {
    const _0x11bdae = scope.createElement("div");
    const _0x290ba0 = ["✼", "✽", "❄"];
    _0x11bdae.className = "snowflake";
    _0x11bdae.textContent = _0x290ba0[Math.floor(Math.random() * _0x290ba0.length)];
    scope.styleOf(_0x11bdae).left = Math.random() * 100 + "vw";
    scope.styleOf(_0x11bdae).animationDuration = 4 + Math.random() * 4 + "s";
    scope.styleOf(_0x11bdae).fontSize = 10 + Math.random() * 20 + "px";
    scope.styleOf(_0x11bdae).opacity = 0.5 + Math.random() * 0.5;
    scope.append(document.body, _0x11bdae);
    scope.listen(_0x11bdae, "animationend", () => scope.remove(_0x11bdae));
  }
  function _0x145d7c(_0x3e0543) {
    const _0x4098ee = config.interval;
    let _0x589b44 = 0;
    const _0x18dd6b = () => {
      if (_0x589b44 < _0x3e0543) {
        _0x3866e2();
        _0x589b44++;
      }
    };
    scope.setInterval(_0x18dd6b, _0x4098ee);
  }
  const _0xfe286b = window.innerWidth <= 768;
  const _0x4e5f8f = _0xfe286b ? config.mobileCount : config.count;
  _0x145d7c(_0x4e5f8f);
})();
}
