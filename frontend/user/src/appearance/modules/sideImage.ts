// @ts-nocheck
// Migrated source for the built-in sideImage feature; resources are owned by FeatureScope.
export function sideImage(scope, config) {
const window = scope.window; const document = scope.document;
(function () {
  function _0x4baf1e() {
    return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
  }
  const _0x239d90 = scope.createElement("div");
  _0x239d90.id = "illustration";
  scope.styleOf(_0x239d90).position = "absolute";
  scope.styleOf(_0x239d90).width = "100px";
  scope.styleOf(_0x239d90).height = "100px";
  scope.styleOf(_0x239d90).backgroundImage = "url(" + config.imageUrl + ")";
  scope.styleOf(_0x239d90).backgroundSize = "contain";
  scope.styleOf(_0x239d90).backgroundRepeat = "no-repeat";
  scope.styleOf(_0x239d90).backgroundPosition = "center";
  scope.styleOf(_0x239d90).top = "50px";
  scope.styleOf(_0x239d90).left = "50px";
  scope.styleOf(_0x239d90).cursor = "grab";
  scope.styleOf(_0x239d90).userSelect = "none";
  scope.styleOf(_0x239d90).zIndex = "9999";
  if (!_0x4baf1e()) {
    scope.append(document.body, _0x239d90);
    let _0x4c36a4 = false;
    let _0x38fd9d;
    let _0x37eac7;
    const _0x198346 = 300;
    const _0x1bd03b = 500;
    const _0x1477c5 = 200;
    const _0x221dd5 = 200;
    scope.listen(_0x239d90, "mousedown", _0x36f76a => {
      _0x4c36a4 = true;
      _0x38fd9d = _0x36f76a.clientX - _0x239d90.getBoundingClientRect().left;
      _0x37eac7 = _0x36f76a.clientY - _0x239d90.getBoundingClientRect().top;
      scope.styleOf(_0x239d90).cursor = "grabbing";
    });
    scope.listen(document, "mousemove", _0x40a388 => {
      if (_0x4c36a4) {
        scope.styleOf(_0x239d90).left = _0x40a388.clientX - _0x38fd9d + "px";
        scope.styleOf(_0x239d90).top = _0x40a388.clientY - _0x37eac7 + "px";
      }
    });
    scope.listen(document, "mouseup", () => {
      if (_0x4c36a4) {
        _0x4c36a4 = false;
        scope.styleOf(_0x239d90).cursor = "grab";
        const _0x15dc4d = _0x239d90.getBoundingClientRect();
        if (_0x15dc4d.left >= _0x198346 && _0x15dc4d.top >= _0x1bd03b && _0x15dc4d.right <= _0x198346 + _0x1477c5 && _0x15dc4d.bottom <= _0x1bd03b + _0x221dd5) {
          scope.styleOf(_0x239d90).left = _0x198346 + (_0x1477c5 - _0x15dc4d.width) / 2 + "px";
          scope.styleOf(_0x239d90).top = _0x1bd03b + (_0x221dd5 - _0x15dc4d.height) / 2 + "px";
        }
      }
    });
  } else {
    scope.styleOf(_0x239d90).display = "none";
  }
})();
}
