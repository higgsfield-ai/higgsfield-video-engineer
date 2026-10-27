"""Title GOOD MORNING! as cut-paper letters (our own 2-D code): each letter a different paper colour with a white paper
border, a soft drop shadow and paper grain; letters pop in one by one with an overshoot from frame F0.
  python -I tools/title.py <outdir> <W> <H> [F0=448] [F1=479] [cy=0.2]
Writes t_%04d.png (RGBA) for F0..F1."""
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
F0 = int(sys.argv[4]) if len(sys.argv) > 4 else 448
F1 = int(sys.argv[5]) if len(sys.argv) > 5 else 479
CY = float(sys.argv[6]) if len(sys.argv) > 6 else 0.2
os.makedirs(out, exist_ok=True)
FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts', 'Fredoka.ttf')
TEXT = 'GOOD MORNING!'
COLS = [(246, 190, 30), (232, 62, 48), (40, 110, 210), (240, 120, 160), (255, 150, 30), (90, 170, 60)]
size = int(H * 0.085)
font = ImageFont.truetype(FONT, size)
try: font.set_variation_by_name('Bold')
except Exception: pass
rng = np.random.default_rng(3)
grain = (rng.standard_normal((size * 2, size * 2)) * 10).astype(np.int16)

def letter_sprite(ch, col, rot):
    pad = size // 3
    w = int(font.getlength(ch)) + pad * 2; h = size + pad * 2
    base = Image.new('L', (w, h), 0)
    ImageDraw.Draw(base).text((pad, pad - size * 0.08), ch, font=font, fill=255)
    border = base.filter(ImageFilter.MaxFilter(size // 9 * 2 + 1))
    border = border.filter(ImageFilter.GaussianBlur(0.8))
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    paper = np.zeros((h, w, 3), np.int16); paper[:] = (250, 246, 236)
    paper += grain[:h, :w, None] // 2
    img.paste(Image.fromarray(np.clip(paper, 0, 255).astype(np.uint8)), (0, 0), border)
    face = np.zeros((h, w, 3), np.int16); face[:] = col
    face += grain[:h, :w, None]
    # a little shading: lighter top, darker bottom (paper curl)
    face = face * (1.08 - 0.18 * np.linspace(0, 1, h)[:, None, None])
    img.paste(Image.fromarray(np.clip(face, 0, 255).astype(np.uint8)), (0, 0), base)
    return img.rotate(rot, resample=Image.BICUBIC, expand=True)

sprites = []
ci = 0
for k, ch in enumerate(TEXT):
    if ch == ' ': sprites.append(None); continue
    sprites.append(letter_sprite(ch, COLS[ci % len(COLS)], float(rng.uniform(-7, 7)))); ci += 1
adv = [font.getlength(ch) * 1.04 if ch != ' ' else size * 0.35 for ch in TEXT]
total = sum(adv); x0 = W * 0.42 - total / 2

def back_out(x, k=2.2):
    x = min(1, max(0, x)); c = k + 1; return 1 + c * (x - 1) ** 3 + k * (x - 1) ** 2

for f in range(F0, F1 + 1):
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x = x0
    for k, (ch, sp) in enumerate(zip(TEXT, sprites)):
        if sp is not None:
            u = (f - F0 - k * 1.2) / 5.0
            if u > 0:
                sc = back_out(u)
                bob = math.sin((f - F0) * 0.25 + k) * size * 0.015
                drop = (1 - min(1, u)) ** 2 * H * 0.12            # letters drop in on their threads from above
                sc = 0.6 + 0.4 * sc
                s2 = sp.resize((max(1, int(sp.width * sc)), max(1, int(sp.height * sc))), Image.BICUBIC)
                cx = x + adv[k] / 2; cy = H * CY + bob - drop
                ImageDraw.Draw(canvas).line([(cx, 0), (cx, cy - s2.height * 0.3)], fill=(240, 236, 226, 230), width=max(2, H // 400))
                px, py = int(cx - s2.width / 2), int(cy - s2.height / 2)
                a = s2.split()[3].point(lambda v: v * 0.45)
                sh = Image.new('RGBA', s2.size, (40, 20, 0, 255)); sh.putalpha(a)
                shadow.alpha_composite(sh, (px + int(size * 0.05), py + int(size * 0.08)))
                canvas.alpha_composite(s2, (px, py))
        x += adv[k]
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.06))
    shadow.alpha_composite(canvas)
    shadow.save(os.path.join(out, f't_{f:04d}.png'))
print('title frames', F0, F1)
