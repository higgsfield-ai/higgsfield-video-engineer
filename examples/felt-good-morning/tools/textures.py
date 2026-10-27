"""Felt example procedural textures (our own, numpy): felt, paper, corrugated cardboard edge, cut-paper edge.
Writes assets/tex/*.png. Tileable where it matters (felt, paper)."""
import numpy as np, os, sys
from PIL import Image
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'tex')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(13)
N = 1024

def save(name, a, mode='RGB'):
    a = np.clip(a, 0, 1)
    if a.ndim == 2: a = np.stack([a] * 3, -1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8), mode).save(os.path.join(OUT, name))

def blur_wrap(h, s):
    f = np.fft.fft2(h); ky = np.fft.fftfreq(h.shape[0])[:, None]; kx = np.fft.fftfreq(h.shape[1])[None, :]
    return np.real(np.fft.ifft2(f * np.exp(-2 * (np.pi * s) ** 2 * (kx ** 2 + ky ** 2))))

def noise_wrap(n, beta):
    """tileable 1/f^beta noise, normalised 0..1"""
    w = rng.standard_normal((n, n)); f = np.fft.fft2(w)
    ky = np.fft.fftfreq(n)[:, None]; kx = np.fft.fftfreq(n)[None, :]; k = np.sqrt(kx ** 2 + ky ** 2); k[0, 0] = 1
    a = np.real(np.fft.ifft2(f / k ** beta)); a -= a.min(); return a / a.max()

def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)   # OpenGL convention (+Y up)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def fibers(n, count, length, curl, width_px=1.0, seed=0):
    """height field of random short curly fibres, drawn with wrap-around"""
    r = np.random.default_rng(seed); h = np.zeros((n, n), np.float32)
    steps = int(length)
    for _ in range(count):
        x, y = r.uniform(0, n, 2); a = r.uniform(0, 2 * np.pi); da = r.normal(0, curl)
        hgt = r.uniform(0.4, 1.0)
        xs = []; ys = []
        for s in range(steps):
            xs.append(x); ys.append(y); x += np.cos(a); y += np.sin(a); a += da + r.normal(0, curl * 0.5)
        xs = np.array(xs).astype(int) % n; ys = np.array(ys).astype(int) % n
        np.maximum.at(h, (ys, xs), hgt)
    return h

# ---------------- felt: dense random fibres + soft lumpy fbm (wool felt is matted, slightly cloudy)
fb = fibers(N, 26000, 40, 0.08, seed=1)
fb = blur_wrap(fb, 0.8)
lump = noise_wrap(N, 1.6)
h = 0.7 * fb / fb.max() + 0.6 * lump
save('felt_n.png', normal_from_height(h, 9.0))
alb = 0.86 + 0.10 * (lump - 0.5) * 2 + 0.07 * (fb / fb.max() - 0.3)
cloud = noise_wrap(N, 2.2)
alb = alb * (0.93 + 0.12 * cloud)
save('felt_a.png', np.clip(alb, 0, 1))
# rough fleece-ish felt variant for the ground (coarser)
fb2 = blur_wrap(fibers(N, 14000, 70, 0.05, seed=2), 1.2)
lump2 = noise_wrap(N, 1.4)
save('feltg_n.png', normal_from_height(0.8 * fb2 / fb2.max() + 0.8 * lump2, 8.0))
save('feltg_a.png', np.clip(0.82 + 0.22 * (lump2 - 0.5) + 0.08 * fb2 / fb2.max(), 0, 1))

# ---------------- painted paper: cold-press grain + watercolour blotches + a few fibres
grain = noise_wrap(N, 0.9); grain2 = noise_wrap(N, 1.3)
pf = blur_wrap(fibers(N, 2500, 50, 0.04, seed=3), 0.7)
ph = 0.6 * grain2 + 0.25 * grain + 0.25 * pf / pf.max()
save('paper_n.png', normal_from_height(ph, 5.0))
wc = noise_wrap(N, 2.4); wc2 = noise_wrap(N, 1.8)
pa = 0.88 + 0.16 * (wc - 0.5) + 0.06 * (wc2 - 0.5) - 0.04 * (grain - 0.5)
# watercolour pooling: darker rims along blotch edges
edge = np.abs(np.gradient(blur_wrap((wc > 0.55).astype(np.float32), 3.0))[0]) * 6
pa -= np.clip(edge, 0, 0.06)
save('paper_a.png', np.clip(pa, 0, 1))

# ---------------- corrugated cardboard cut edge (texture runs u along the edge, v across the board thickness)
# 1024 wide x 256 tall, single-wall: top liner, fluted medium, bottom liner. Tiles in u.
W, H = 1024, 256
v = np.linspace(0, 1, H)[:, None]; u = np.linspace(0, 1, W, endpoint=False)[None, :]
flutes = 18                                     # flute periods across the texture width
liner = 0.09
med = 0.5 + (0.5 - liner - 0.035) * np.cos(2 * np.pi * flutes * u)      # medium centre line (v)
d = np.abs(v - med)
inside = (v > liner) & (v < 1 - liner)
medium = d < 0.03
hh = np.where(~inside, 1.0, np.where(medium, 0.9, 0.0))
# flute cavities: dark depth falls off from the medium
cav = inside & ~medium
depth = np.clip(d / 0.3, 0, 1)
hh = np.where(cav, 0.6 * (1 - depth) * 0.3, hh)
hh = hh + 0.03 * noise_wrap(W, 1.2)[:H, :]
hb = hh.astype(np.float32)
kraft = np.array([0.62, 0.43, 0.25])
shade = np.where(cav, 0.25 + 0.45 * (1 - depth), 1.0)
fib = noise_wrap(W, 1.0)[:H, :]
ca = kraft[None, None, :] * (shade * (0.9 + 0.2 * fib))[..., None]
ca = np.where((~inside)[..., None], kraft[None, None, :] * 1.08 * (0.93 + 0.12 * fib[..., None]), ca)
Image.fromarray((np.clip(ca, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'card_a.png'))
gx = (np.roll(hb, -1, 1) - np.roll(hb, 1, 1)) * 0.5 * 18
gy = (np.vstack([hb[1:], hb[-1:]]) - np.vstack([hb[:1], hb[:-1]])) * 0.5 * 18
nn = np.stack([-gx, gy, np.ones_like(hb)], -1); nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
Image.fromarray(((nn * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, 'card_n.png'))
print('textures written to', OUT)
