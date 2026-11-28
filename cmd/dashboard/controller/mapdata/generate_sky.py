"""Separate measured stellar peaks from the diffuse Milky Way. Requires Pillow and NumPy."""

from pathlib import Path
import struct
import hashlib
import numpy as np
from PIL import Image, ImageFilter

assets = Path(__file__).resolve().parent
im = Image.open(assets / "galactic-sky.webp").convert("RGB")
rgb = np.array(im, dtype=np.float32)
lum = np.asarray(im.convert("L"), dtype=np.float32)
background = np.asarray(im.filter(ImageFilter.MedianFilter(9)), dtype=np.float32)
baseline = background @ np.array([.299, .587, .114], dtype=np.float32)
excess = lum - baseline
local = np.asarray(im.convert("L").filter(ImageFilter.MaxFilter(5)))
ys, xs = np.where((lum == local) & (excess > 9))
order = np.argsort(-excess[ys, xs], kind="stable")
h, w = lum.shape
used = np.zeros((h, w), dtype=bool)
mask = np.zeros((h, w), dtype=np.float32)
catalog = bytearray()
for i in order:
    x, y = int(xs[i]), int(ys[i])
    if x < 6 or x >= w-6 or y < 6 or y >= h-6 or used[y, x]:
        continue
    window = np.s_[y-5:y+6, x-5:x+6]
    residual = np.maximum(rgb[window] - background[window], 0)
    dy, dx = np.mgrid[-5:6, -5:6]
    kernel = np.exp(-.32 * (dx*dx + dy*dy))
    weights = residual.mean(axis=2) * kernel
    flux = weights.sum()
    if flux < 16:
        continue
    cx, cy = x + (dx*weights).sum()/flux, y + (dy*weights).sum()/flux
    color = (residual * kernel[:,:,None]).sum(axis=(0,1))
    warmth = np.clip(.5 + 1.7*(color[0]-color[2]) / max(20,float(color.max())), 0, 1)
    strength = np.clip(np.log1p(flux / 17) / np.log(45), 0, 1)
    catalog += struct.pack(">HHBB", round(cx/w*65535), round(cy/h*65535), round(strength*255), round(warmth*255))
    used[y-3:y+4, x-3:x+4] = True
    mask[window] = np.maximum(mask[window], np.exp(-.17 * ((dx+x-cx)**2 + (dy+y-cy)**2)))
    if len(catalog) >= 6*2300:
        break
clean = rgb - np.maximum(rgb-background, 0) * mask[:,:,None]
Image.fromarray(np.uint8(np.clip(clean*1.08,0,255))).save(assets / "galactic-dust.webp", quality=86, method=6)
(assets / "sky-stars.bin").write_bytes(catalog)
for name in ("galactic-dust.webp", "sky-stars.bin"):
    data=(assets/name).read_bytes()
    print(name, len(data), hashlib.sha256(data).hexdigest())
