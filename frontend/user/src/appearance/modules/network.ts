// @ts-nocheck
// Migrated source for the built-in network feature; resources are owned by FeatureScope.
export function network(scope, config) {
const window = scope.window; const document = scope.document;
(function () {
  var _0x58d316 = !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (!_0x58d316) {
    return;
  }
  function _0x2de556(_0x1119e1, _0x1df741, _0x11f990) {
    return _0x1119e1.getAttribute(_0x1df741) || _0x11f990;
  }
  function _0x2a7625() {
    return {
      z: 10,
      o: config.opacity,
      c: config.color,
      n: config.count
    };
  }
  function _0x168c11() {
    _0x145ce2 = _0x51a74c.width = window.innerWidth;
    _0x1a8ee4 = _0x51a74c.height = window.innerHeight;
    const _0x208ccc = window.devicePixelRatio || 1;
    _0x51a74c.width = _0x145ce2 * _0x208ccc;
    _0x51a74c.height = _0x1a8ee4 * _0x208ccc;
    _0x51a74c.getContext("2d").scale(_0x208ccc, _0x208ccc);
  }
  function _0x533f11() {
    _0x1f1a1f.clearRect(0, 0, _0x145ce2, _0x1a8ee4);
    var _0xc7811d;
    var _0x4ea916;
    var _0x493483;
    var _0x51acf8;
    _0x5efe24.forEach(function (_0x21a71c, _0x1fc94c) {
      _0x21a71c.x += _0x21a71c.vx;
      _0x21a71c.y += _0x21a71c.vy;
      if (_0x21a71c.x > _0x145ce2 || _0x21a71c.x < 0) {
        _0x21a71c.vx *= -1;
      }
      if (_0x21a71c.y > _0x1a8ee4 || _0x21a71c.y < 0) {
        _0x21a71c.vy *= -1;
      }
      _0x1f1a1f.fillRect(_0x21a71c.x - 0.5, _0x21a71c.y - 0.5, 1, 1);
      for (let _0x28506f = _0x1fc94c + 1; _0x28506f < _0x59a8c2.length; _0x28506f++) {
        const _0x182185 = _0x59a8c2[_0x28506f];
        if (_0x182185.x == null || _0x182185.y == null) {
          continue;
        }
        _0xc7811d = _0x21a71c.x - _0x182185.x;
        _0x4ea916 = _0x21a71c.y - _0x182185.y;
        _0x493483 = _0xc7811d * _0xc7811d + _0x4ea916 * _0x4ea916;
        if (_0x493483 < _0x182185.max) {
          if (_0x182185 === _0xe4b10e && _0x493483 >= _0x182185.max / 2) {
            _0x21a71c.x -= _0xc7811d * 0.03;
            _0x21a71c.y -= _0x4ea916 * 0.03;
          }
          _0x51acf8 = (_0x182185.max - _0x493483) / _0x182185.max;
          _0x1f1a1f.beginPath();
          _0x1f1a1f.lineWidth = _0x51acf8 / 2;
          _0x1f1a1f.strokeStyle = "rgba(" + _0x1df04c.c + "," + (_0x51acf8 + 0.2) + ")";
          _0x1f1a1f.moveTo(_0x21a71c.x, _0x21a71c.y);
          _0x1f1a1f.lineTo(_0x182185.x, _0x182185.y);
          _0x1f1a1f.stroke();
        }
      }
    });
    scope.requestAnimationFrame(_0x533f11);
  }
  const _0x1df04c = _0x2a7625();
  const _0x51a74c = scope.createElement("canvas");
  const _0x1f1a1f = _0x51a74c.getContext("2d");
  let _0x145ce2;
  let _0x1a8ee4;
  _0x51a74c.id = "canvas-nest";
  scope.styleOf(_0x51a74c).cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:" + _0x1df04c.z + ";opacity:" + _0x1df04c.o + ";pointer-events:none";
  document.body.insertBefore(_0x51a74c, document.body.firstChild);
  let _0x5efe24 = [];
  let _0x59a8c2;
  const _0xe4b10e = {
    x: null,
    y: null,
    max: 20000
  };
  const _0x4d75d0 = Math.random;
  _0x168c11();
  scope.listen(window, "resize", _0x168c11);
  scope.listen(window, "mousemove", function (_0x1b32ef) {
    _0xe4b10e.x = _0x1b32ef.clientX;
    _0xe4b10e.y = _0x1b32ef.clientY;
  });
  scope.listen(window, "mouseout", function () {
    _0xe4b10e.x = null;
    _0xe4b10e.y = null;
  });
  for (let _0x320c80 = 0; _0x320c80 < _0x1df04c.n; _0x320c80++) {
    const _0x26e6cf = _0x4d75d0() * window.innerWidth;
    const _0x2900ed = _0x4d75d0() * window.innerHeight;
    const _0x4820f7 = _0x4d75d0() * 2 - 1;
    const _0x48c0b5 = _0x4d75d0() * 2 - 1;
    _0x5efe24.push({
      x: _0x26e6cf,
      y: _0x2900ed,
      vx: _0x4820f7,
      vy: _0x48c0b5,
      max: 12000
    });
  }
  _0x59a8c2 = _0x5efe24.concat([_0xe4b10e]);
  scope.requestAnimationFrame(_0x533f11);
})();
}
