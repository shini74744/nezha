// @ts-nocheck
// Migrated source for the built-in quote feature; resources are owned by FeatureScope.
export function quote(scope, config) {
const window = scope.window; const document = scope.document;
(function () {
  function _0xe79106(_0x95675b) {
    let _0x40425f = document.getElementById("message");
    if (!_0x40425f) {
      _0x40425f = scope.createElement("div");
      _0x40425f.id = "message";
      scope.styleOf(_0x40425f).position = "absolute";
      scope.styleOf(_0x40425f).top = "0";
      scope.styleOf(_0x40425f).left = "0";
      scope.styleOf(_0x40425f).width = "100%";
      scope.styleOf(_0x40425f).backgroundColor = "transparent";
      scope.styleOf(_0x40425f).color = "white";
      scope.styleOf(_0x40425f).fontFamily = "\"楷体\", \"KaiTi\", serif";
      scope.styleOf(_0x40425f).fontSize = "20px";
      scope.styleOf(_0x40425f).padding = "10px";
      scope.styleOf(_0x40425f).textAlign = "center";
      scope.styleOf(_0x40425f).display = "none";
      scope.styleOf(_0x40425f).zIndex = "9999";
      scope.append(document.body, _0x40425f);
    }
    _0x95675b(_0x40425f);
  }
  _0xe79106(function (_0x490a30) {
    function _0x56b709() {
      const _0x23fab3 = navigator.userAgent;
      const _0x465f74 = ["Android", "iPhone", "iPad", "iPod", "Windows Phone", "Mobi", "Mobile"];
      return !_0x465f74.some(_0x4f4666 => _0x23fab3.includes(_0x4f4666));
    }
    function _0x470e5d() {
      return "#" + Math.floor(Math.random() * 16777215).toString(16);
    }
    function _0x25d75f() {
      return new Date().getHours() >= 21;
    }
    function _0x38661c() {
      const _0x10f302 = config.dayUrls;
      return _0x10f302[Math.floor(Math.random() * _0x10f302.length)];
    }
    function _0x26e827() {
      if (_0x25d75f()) {
        return config.nightUrl;
      } else {
        return _0x38661c();
      }
    }
    function _0x1d12c0() {
      if (!_0x56b709()) {
        console.log("移动端不显示顶部文字");
        return;
      }
      const _0x2a8568 = _0x26e827();
      scope.fetch(_0x2a8568).then(_0x206646 => _0x206646.text()).then(_0x495f7a => {
        _0x490a30.textContent = _0x495f7a;
        scope.styleOf(_0x490a30).display = "block";
      }).catch(_0x5c46e3 => {
        console.error("请求错误:", _0x5c46e3);
        _0x490a30.textContent = "加载失败，请稍后再试";
        scope.styleOf(_0x490a30).display = "block";
      });
      scope.setInterval(() => {
        scope.styleOf(_0x490a30).color = _0x470e5d();
      }, 2000);
    }
    _0x1d12c0();
  });
})();
}
