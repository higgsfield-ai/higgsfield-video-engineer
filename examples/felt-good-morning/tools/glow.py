"""Glow pass (our own, numpy): soft bloom around bright paper (moon, stars, sun) and the felt fuzz highlights, plus a gentle
vignette. Reads 16-bit PNG frames, writes 16-bit PNG frames.  python -I tools/glow.py <in_dir> <out_dir> [first last]"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
src, dst = sys.argv[1], sys.argv[2]
a = int(sys.argv[3]) if len(sys.argv) > 3 else 0
b = int(sys.argv[4]) if len(sys.argv) > 4 else 479
os.makedirs(dst, exist_ok=True)
def load(p):
    im = Image.open(p); arr = np.asarray(im)
    return arr.astype(np.float32) / (65535.0 if arr.dtype == np.uint16 else 255.0)
vig = None
for f in range(a, b + 1):
    p = os.path.join(src, f'f_{f:04d}.png')
    x = load(p)[..., :3]
    lin = x ** 2.2
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    w = np.clip((lum - 0.72) / 0.4, 0, 1)[..., None] * lin
    small = w[::2, ::2]
    bloom = sum(k * ndimage.gaussian_filter(small, sigma=(s, s, 0)) for s, k in [(4, 0.5), (14, 0.35), (40, 0.25)])
    bloom = np.repeat(np.repeat(bloom, 2, 0), 2, 1)[: x.shape[0], : x.shape[1]]
    out = lin + 0.45 * bloom * np.array([1.0, 0.9, 0.75], np.float32)
    if vig is None:
        H, W = lum.shape; yy, xx = np.mgrid[0:H, 0:W]
        r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
        vig = (1 - 0.18 * np.clip(r - 0.55, 0, 1) ** 1.5)[..., None].astype(np.float32)
    out = np.clip(out * vig, 0, 1) ** (1 / 2.2)
    Image.fromarray((out * 65535 + 0.5).astype(np.uint16).reshape(out.shape[0], -1), 'I;16').save if False else None
    # write 8-bit RGB (encode is 8-bit anyway)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(os.path.join(dst, f'f_{f:04d}.png'))
print('glow done', a, b)
