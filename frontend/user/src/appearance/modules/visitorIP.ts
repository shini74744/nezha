// @ts-nocheck
import manifest from "../manifest.json";
// Migrated source for the built-in visitorIP feature; resources are owned by FeatureScope.
export function visitorIP(scope, config) {
config = {...manifest.find(d=>d.key==="visitorIP").defaults,...config};
const cacheSource = JSON.stringify([config.ipApiUrls,config.fallbackUrl]);
const window = scope.window; const document = scope.document;
(() => {
  'use strict';

  const _0x230cf0 = "nezha-ip-bar-style";
  const _0x23f6f7 = "ip-bar";
  const _0x21d03f = "nezha_ip_bar_cache_v6";
  const _0x40e490 = config.cacheDuration;
  const _0x4a8876 = config.bottomThreshold;
  const _0x26bcbe = (() => {
    const _0x25458b = navigator.userAgent || "";
    const _0x1d01e3 = (navigator.maxTouchPoints || 0) > 0;
    const _0x393f4f = /Mobi|Android|iPhone|iPad|iPod/i.test(_0x25458b);
    const _0x54a609 = /Macintosh/i.test(_0x25458b) && _0x1d01e3;
    return !_0x393f4f && !_0x54a609;
  })();
  const _0x36b931 = _0x26b7fd => {
    const _0x4a428 = document.getElementById(_0x230cf0);
    if (_0x4a428) {
      scope.remove(_0x4a428);
    }
    const _0x51694e = scope.createElement("style");
    _0x51694e.id = _0x230cf0;
    _0x51694e.textContent = _0x26b7fd;
    scope.append(document.head, _0x51694e);
  };
  const _0x165d60 = _0x92d8bd => new Promise(_0x4951eb => scope.setTimeout(_0x4951eb, _0x92d8bd));
  const _0x3f7906 = async (_0x49f137, _0x136bea = 4000, _0x1ddb8e = {}) => {
    const _0x26a709 = new AbortController();
    const _0x2b7a95 = scope.setTimeout(() => _0x26a709.abort(), _0x136bea);
    try {
      const _0x567c23 = await scope.fetch(_0x49f137, {
        signal: _0x26a709.signal,
        credentials: "omit",
        cache: "no-store",
        ..._0x1ddb8e
      });
      if (!_0x567c23.ok) {
        throw new Error("Response not OK");
      }
      return _0x567c23;
    } finally {
      scope.clearTimeout(_0x2b7a95);
    }
  };
  const _0xf75bc = _0x1edcbb => {
    if (Promise.any) {
      return Promise.any(_0x1edcbb);
    }
    return new Promise((_0x497c11, _0xed2890) => {
      let _0x39b48a = 0;
      const _0x3f9aa1 = [];
      _0x1edcbb.forEach((_0xfc763d, _0x51ba5c) => {
        Promise.resolve(_0xfc763d).then(_0x497c11).catch(_0x2f98bc => {
          _0x3f9aa1[_0x51ba5c] = _0x2f98bc;
          _0x39b48a += 1;
          if (_0x39b48a === _0x1edcbb.length) {
            _0xed2890(new AggregateError(_0x3f9aa1, "All promises were rejected"));
          }
        });
      });
    });
  };
  const _0x1f5356 = async (_0x2c51e6, _0xe3aa9c = 4000) => {
    const _0x1af448 = _0x2c51e6.map(() => new AbortController());
    const _0x2003ca = _0x1af448.map(_0x471f01 => scope.setTimeout(() => _0x471f01.abort(), _0xe3aa9c));
    const _0x539fc1 = _0x2c51e6.map((_0x1b6ed2, _0x4460f8) => scope.fetch(_0x1b6ed2, {
      signal: _0x1af448[_0x4460f8].signal,
      credentials: "omit",
      cache: "no-store"
    }).then(async _0xccf719 => {
      if (!_0xccf719.ok) {
        throw new Error("Response not OK");
      }
      const _0x31dab2 = await _0xccf719.json();
      const _0x3e66a4 = _0x31dab2?.ip || _0x31dab2?.query;
      if (!_0x3e66a4) {
        throw new Error("No IP in response");
      }
      return _0x31dab2;
    }));
    try {
      const _0x350a2e = await _0xf75bc(_0x539fc1);
      _0x1af448.forEach(_0x10e0bf => {
        try {
          _0x10e0bf.abort();
        } catch {}
      });
      return _0x350a2e;
    } finally {
      _0x2003ca.forEach(_0x243d2e => scope.clearTimeout(_0x243d2e));
    }
  };
  const _0x299555 = async (_0x5942e7, _0x5142fb = 1500) => {
    const _0x39c1ee = new AbortController();
    const _0x1740a5 = scope.setTimeout(() => _0x39c1ee.abort(), _0x5142fb);
    const _0x3915b6 = performance.now();
    try {
      await scope.fetch(_0x5942e7.url, {
        signal: _0x39c1ee.signal,
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit"
      });
      return {
        name: _0x5942e7.name,
        ms: Math.round(performance.now() - _0x3915b6)
      };
    } catch {
      return null;
    } finally {
      scope.clearTimeout(_0x1740a5);
    }
  };
  const _0x206431 = async (nodes, _0x476a19) => {
    if (!nodes.length) return null;
    const _0x33a3de = nodes.map(() => new AbortController());
    const _0x55a32c = _0x33a3de.map(_0x46b6dc => scope.setTimeout(() => _0x46b6dc.abort(), _0x476a19));
    const _0x646747 = nodes.map((_0x26bd53, _0x7424dc) => {
      const _0x379981 = performance.now();
      return scope.fetch(_0x26bd53.url, {
        signal: _0x33a3de[_0x7424dc].signal,
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit"
      }).then(() => ({
        name: _0x26bd53.name,
        ms: Math.round(performance.now() - _0x379981)
      }));
    });
    try {
      const _0x5c78eb = await _0xf75bc(_0x646747);
      _0x33a3de.forEach(_0x274814 => {
        try {
          _0x274814.abort();
        } catch {}
      });
      return _0x5c78eb;
    } catch {
      return null;
    } finally {
      _0x55a32c.forEach(_0xf37c08 => scope.clearTimeout(_0xf37c08));
    }
  };
  const _0x5b6e5e = _0x561ab2 => {
    const _0x3c3b29 = _0x561ab2?.ip || _0x561ab2?.query;
    const _0x4d600d = _0x561ab2?.country_name || _0x561ab2?.country || "";
    const _0x4ff423 = _0x561ab2?.city || "";
    const _0x270f5c = _0x561ab2?.region || _0x561ab2?.regionName || "";
    const _0x389bf4 = _0x4ff423 || _0x270f5c || "";
    const _0x31642a = _0x4d600d && _0x389bf4 && _0x4d600d !== _0x389bf4 ? _0x4d600d + " · " + _0x389bf4 : _0x4d600d || _0x389bf4;
    const _0x2c85c2 = _0x561ab2?.asn || (typeof _0x561ab2?.org === "string" && /^AS\d+\b/i.test(_0x561ab2.org) ? _0x561ab2.org.match(/^AS\d+\b/i)?.[0] || "" : "") || (typeof _0x561ab2?.as === "string" ? _0x561ab2.as.match(/^AS\d+\b/i)?.[0] || "" : "") || "";
    const _0x44f707 = _0x561ab2?.org || _0x561ab2?.organization || _0x561ab2?.isp || (typeof _0x561ab2?.as === "string" ? _0x561ab2.as.replace(/^AS\d+\s*/i, "") : "") || "";
    return {
      ip: _0x3c3b29,
      loc: _0x31642a,
      asn: _0x2c85c2,
      org: _0x44f707
    };
  };
  const _0x2e39b6 = _0x2665f6 => {
    if (!Number.isFinite(_0x2665f6)) {
      return "";
    }
    if (_0x2665f6 < 80) {
      return "lat-excellent";
    }
    if (_0x2665f6 < 150) {
      return "lat-good";
    }
    if (_0x2665f6 < 300) {
      return "lat-mid";
    }
    return "lat-bad";
  };
  const _0x295ee7 = () => {
    if (!config.showDownlink) return "";
    const _0x1ab347 = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!_0x1ab347 || typeof _0x1ab347.downlink !== "number" || !isFinite(_0x1ab347.downlink)) {
      return "";
    }
    const _0x3e43b0 = _0x1ab347.downlink >= 10 ? Math.round(_0x1ab347.downlink) : Math.round(_0x1ab347.downlink * 10) / 10;
    return "↓" + _0x3e43b0 + "Mbps";
  };
  const _0x348bac = ({
    ip: _0x1d10ff,
    loc: _0x3ddcac,
    asn: _0x156bcb,
    org: _0x4ba621
  }) => {
    if (!_0x1d10ff) {
      return "无法解析IP信息";
    }
    const _0x5f1975 = _0x1d10ff.includes(".") && !_0x1d10ff.includes(":");
    const _0x216835 = _0x5f1975 ? _0x1d10ff : "IPv6 network";
    if (!_0x26bcbe) {
      if (config.showRegion && _0x3ddcac) {
        return _0x216835 + " ｜ " + _0x3ddcac;
      } else {
        return _0x216835;
      }
    }
    const _0x6173cb = [];
    if (config.showRegion && _0x3ddcac) {
      _0x6173cb.push(_0x3ddcac);
    }
    const org = String(_0x4ba621 || "").replace(/^AS\d+\s*/i, "");
    const _0xd682b = [config.showASN ? _0x156bcb : "", config.showOrganization ? org : ""].filter(Boolean).join(" ");
    if (_0xd682b) {
      _0x6173cb.push(_0xd682b);
    }
    if (_0x6173cb.length) {
      return _0x216835 + " ｜ " + _0x6173cb.join(" ｜ ");
    } else {
      return _0x216835;
    }
  };
  const _0x2a74ae = () => {
    try {
      const _0x17c585 = localStorage.getItem(_0x21d03f);
      if (!_0x17c585) {
        return null;
      }
      const _0x364811 = JSON.parse(_0x17c585);
      if (!_0x364811 || !_0x364811.ts || !_0x364811.base || _0x40e490 <= 0 || _0x364811.source !== cacheSource) {
        return null;
      }
      if (Date.now() - _0x364811.ts > _0x40e490) {
        return null;
      }
      return _0x364811.base;
    } catch {
      return null;
    }
  };
  const _0x3216e7 = _0x24b6cb => {
    if (_0x40e490 <= 0) return;
    try {
      localStorage.setItem(_0x21d03f, JSON.stringify({
        ts: Date.now(),
        source: cacheSource,
        base: _0x24b6cb
      }));
    } catch {}
  };
  let _0x3ab389 = "";
  let _0x6fa005 = false;
  const _0x26ea6d = () => {
    _0x36b931("\n      #" + _0x23f6f7 + " {\n        position: fixed;\n        left: 50%;\n        bottom: 12px;\n        transform: translateX(-50%);\n        z-index: 9999;\n        transition: opacity .25s ease, transform .25s ease;\n      }\n      #" + _0x23f6f7 + ".ip-hidden {\n        opacity: 0;\n        transform: translateX(-50%) translateY(18px);\n        pointer-events: none;\n      }\n      #" + _0x23f6f7 + " .ip-inner {\n        display: inline-flex;\n        align-items: center;\n        gap: 10px;\n        padding: 8px 16px;\n        border-radius: 999px;\n        background: rgba(255,255,255,.96);\n        box-shadow: 0 8px 30px rgba(0,0,0,0.15);\n        backdrop-filter: blur(16px);\n        border: 1px solid rgba(220,220,220,.9);\n        max-width: calc(100vw - 24px);\n      }\n      #" + _0x23f6f7 + " .ip-icon {\n        width: 20px;\n        height: 20px;\n        border-radius: 999px;\n        border: 2px solid #1a73e8;\n        position: relative;\n        flex: 0 0 auto;\n      }\n      #" + _0x23f6f7 + " .ip-icon::before {\n        content: \"\";\n        position: absolute;\n        inset: 4px;\n        border-radius: inherit;\n        background: #1a73e8;\n      }\n      #" + _0x23f6f7 + " .ip-text {\n        font-size: 14px;\n        color: #333;\n        white-space: nowrap;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        max-width: calc(100vw - 90px);\n      }\n      #" + _0x23f6f7 + " .ip-l { color: #1a73e8; font-weight: 600; margin-right: 4px; }\n\n      /* 延迟区域：可点击 + 渐变切换动画 */\n      #" + _0x23f6f7 + " .ip-net {\n        font-weight: 700;\n        cursor: pointer;\n        user-select: none;\n        transition: opacity .22s ease, transform .22s ease, filter .22s ease;\n        will-change: opacity, transform;\n      }\n      #" + _0x23f6f7 + " .ip-net.switching {\n        opacity: 0;\n        transform: translateY(6px);\n        filter: blur(1px);\n      }\n\n      /* 延迟颜色 */\n      #" + _0x23f6f7 + " .lat-excellent { color: #16a34a; }\n      #" + _0x23f6f7 + " .lat-good      { color: #2563eb; }\n      #" + _0x23f6f7 + " .lat-mid       { color: #f59e0b; }\n      #" + _0x23f6f7 + " .lat-bad       { color: #ef4444; }\n\n      @media (max-width: 600px) {\n        #" + _0x23f6f7 + " .ip-inner { padding: 6px 12px; }\n        #" + _0x23f6f7 + " .ip-text { font-size: 13px; max-width: calc(100vw - 80px); }\n      }\n    ");
    if (document.getElementById(_0x23f6f7)) {
      return;
    }
    const _0x4b831f = scope.createElement("div");
    _0x4b831f.id = _0x23f6f7;
    _0x4b831f.innerHTML = "\n      <div class=\"ip-inner\">\n        <div class=\"ip-icon\"></div>\n        <div class=\"ip-text\">\n          <span class=\"ip-l\">Your IP:</span>\n          <span id=\"ip-val\" title=\"\">\n            <span id=\"ip-base\"></span>\n            <span id=\"ip-net\" class=\"ip-net\" aria-label=\"点击切换测速点\"></span>\n          </span>\n        </div>\n      </div>\n    ";
    scope.append(document.body, _0x4b831f);
  };
  const _0x20e2c5 = (_0x398de3, _0x53c95f = "", _0x1e6fa4 = "", _0x206a5c = "") => {
    const _0x358cd0 = document.getElementById("ip-base");
    const _0x4e6776 = document.getElementById("ip-net");
    const _0x54c555 = document.getElementById("ip-val");
    if (!_0x358cd0 || !_0x4e6776 || !_0x54c555) {
      return;
    }
    _0x358cd0.textContent = _0x398de3 || "";
    _0x4e6776.className = "ip-net";
    if (_0x1e6fa4) {
      _0x4e6776.classList.add(_0x1e6fa4);
    }
    _0x4e6776.textContent = _0x53c95f ? " ｜ " + _0x53c95f : "";
    if (_0x206a5c) {
      _0x3ab389 = _0x206a5c;
    }
    const _0x15cef7 = ("" + (_0x398de3 || "") + (_0x53c95f ? " ｜ " + _0x53c95f : "")).trim();
    _0x54c555.setAttribute("title", _0x15cef7);
  };
  const _0x53dc85 = async () => {
    const _0x9eea98 = document.getElementById("ip-net");
    if (!_0x9eea98) {
      return;
    }
    _0x6fa005 = true;
    _0x9eea98.classList.add("switching");
    await _0x165d60(140);
  };
  const _0x1cd167 = async () => {
    const _0x4f60c9 = document.getElementById("ip-net");
    if (!_0x4f60c9) {
      return;
    }
    scope.requestAnimationFrame(() => {
      _0x4f60c9.classList.remove("switching");
      _0x6fa005 = false;
    });
  };
  const _0x4094fb = () => {
    const _0xec6a48 = document.documentElement;
    const _0x19e73f = _0xec6a48.scrollTop || document.body.scrollTop || 0;
    const _0x251b61 = window.innerHeight || _0xec6a48.clientHeight || 0;
    const _0x2a1767 = _0xec6a48.scrollHeight || document.body.scrollHeight || 0;
    return _0x2a1767 - (_0x19e73f + _0x251b61) <= _0x4a8876;
  };
  let _0x397dca = false;
  const _0x174fd4 = () => {
    const _0x89e6ac = document.getElementById(_0x23f6f7);
    if (!_0x89e6ac) {
      return;
    }
    _0x89e6ac.classList.toggle("ip-hidden", _0x4094fb());
  };
  const _0x368660 = () => {
    if (_0x397dca) {
      return;
    }
    _0x397dca = true;
    scope.requestAnimationFrame(() => {
      _0x397dca = false;
      _0x174fd4();
    });
  };
  const _0x50a926 = () => {
    scope.listen(window, "scroll", _0x368660, {
      passive: true
    });
    scope.listen(window, "resize", _0x368660, {
      passive: true
    });
    const _0x3f5dfd = scope.resizeObserver(_0x368660);
    _0x3f5dfd.observe(document.documentElement);
    _0x174fd4();
  };
  const _0xf9315 = async () => {
    _0x26ea6d();
    _0x50a926();
    const nodes = config.checkNodes;
    const networkActive = _0x26bcbe && config.networkEnabled && nodes.length > 0;
    const _0x111b04 = document.getElementById("ip-net");
    if (_0x111b04) {
      scope.listen(_0x111b04, "click", async () => {
        if (!networkActive) {
          return;
        }
        if (_0x6fa005) {
          return;
        }
        const index = nodes.findIndex(n=>n.name === _0x3ab389);
        const _0x585971 = nodes[(index + 1) % nodes.length];
        await _0x53dc85();
        const _0x39e82f = document.getElementById("ip-base")?.textContent || "";
        _0x20e2c5(_0x39e82f, "测速中…", "lat-good", _0x3ab389);
        const _0xae39f1 = await _0x299555(_0x585971, config.switchTimeout);
        if (_0xae39f1 && Number.isFinite(_0xae39f1.ms)) {
          const _0x172d86 = _0x295ee7();
          const _0x5c241b = _0x172d86 ? " · " + _0x172d86 : "";
          const _0x37024d = _0xae39f1.name + " 延迟 " + _0xae39f1.ms + "ms" + _0x5c241b;
          _0x20e2c5(_0x39e82f, _0x37024d, _0x2e39b6(_0xae39f1.ms), _0xae39f1.name);
        } else {
          _0x20e2c5(_0x39e82f, _0x585971.name + " 检测失败", "lat-mid", _0x585971.name);
        }
        await _0x165d60(30);
        await _0x1cd167();
      }, {
        passive: true
      });
    }
    const _0x4ed724 = _0x2a74ae();
    if (_0x4ed724) {
      const _0x5d2d21 = _0x348bac(_0x4ed724);
      _0x20e2c5(_0x5d2d21, networkActive ? "检测中…" : "", "", "");
    }
    await _0x165d60(50);
    const _0x29b349 = config.fallbackUrl;
    let _0x1caf45 = null;
    try {
      _0x1caf45 = await _0x1f5356(config.ipApiUrls, config.queryTimeout);
    } catch {}
    if (!_0x1caf45) {
      if (!_0x4ed724) {
        _0x20e2c5("无法获取IP信息", "", "");
      }
      return;
    }
    let _0x2d2955 = _0x5b6e5e(_0x1caf45);
    if (_0x26bcbe && _0x29b349 && ((config.showASN && !_0x2d2955.asn) || (config.showOrganization && !_0x2d2955.org) || (config.showRegion && !_0x2d2955.loc))) {
      try {
        const _0x5b80b4 = await _0x3f7906(_0x29b349, config.fallbackTimeout);
        const _0x4de948 = await _0x5b80b4.json();
        const _0x35e523 = _0x5b6e5e(_0x4de948);
        if (!_0x2d2955.asn) {
          _0x2d2955.asn = _0x35e523.asn;
        }
        if (!_0x2d2955.org) {
          _0x2d2955.org = _0x35e523.org;
        }
        if (!_0x2d2955.loc) {
          _0x2d2955.loc = _0x35e523.loc;
        }
        if (!_0x2d2955.ip) {
          _0x2d2955.ip = _0x35e523.ip;
        }
      } catch {}
    }
    const _0x4509b5 = _0x348bac(_0x2d2955);
    _0x20e2c5(_0x4509b5, networkActive ? "检测中…" : "", "", "");
    _0x3216e7({
      ip: _0x2d2955.ip,
      loc: _0x2d2955.loc,
      asn: _0x2d2955.asn,
      org: _0x2d2955.org
    });
    _0x174fd4();
    if (networkActive) {
      const _0x243d13 = await _0x206431(nodes, config.checkTimeout);
      if (_0x243d13 && Number.isFinite(_0x243d13.ms)) {
        const _0x9482d2 = _0x295ee7();
        const _0x26d03c = _0x9482d2 ? " · " + _0x9482d2 : "";
        const _0x4c883b = _0x243d13.name + " 延迟 " + _0x243d13.ms + "ms" + _0x26d03c;
        _0x20e2c5(_0x4509b5, _0x4c883b, _0x2e39b6(_0x243d13.ms), _0x243d13.name);
      } else {
        _0x20e2c5(_0x4509b5, "测速失败", "lat-mid", "");
      }
    }
  };
  if (document.readyState === "loading") {
    scope.listen(document, "DOMContentLoaded", _0xf9315, {
      once: true
    });
  } else {
    _0xf9315();
  }
})();
}
