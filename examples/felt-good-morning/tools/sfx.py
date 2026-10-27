"""Felt example sound: every effect is synthesised here in numpy (a toy world of felt, paper, wire and wool), placed on the film's
events, and mixed under the music window (MUSIC from MUSIC_START -> film 0; default music/good-morning-track.m4a, not included:
without it the output is effects only).
  Environment: MUSIC=<audio file>, MUSIC_START=<seconds into the file>, FFMPEG=<ffmpeg binary>.
  python -I tools/sfx.py <out.wav> [--no-music] [--stems dir]
"""
import sys, os, subprocess, json, tempfile
import numpy as np
from scipy import signal
import soundfile as sf

SR = 48000
DUR = 20.0
N = int(SR * DUR)
rng = np.random.default_rng(13)
HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.environ.get('MUSIC', os.path.join(HERE, '..', 'music', 'good-morning-track.m4a'))
# window of the generated track whose drop lands on the sunrise (11.125 s in the film)
MUSIC_START = float(os.environ.get('MUSIC_START', '3.69'))

def t_(d): return np.arange(int(SR * d)) / SR
def env_ad(n, a, d):
    e = np.ones(n); na = max(1, int(SR * a)); nd = max(1, int(SR * d))
    e[:na] = np.linspace(0, 1, na); e[-nd:] *= np.linspace(1, 0, nd); return e
def bp(x, lo, hi, order=2): b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band'); return signal.lfilter(b, a, x)
def lp(x, f, order=2): b, a = signal.butter(order, f / (SR / 2), 'low'); return signal.lfilter(b, a, x)
def hp(x, f, order=2): b, a = signal.butter(order, f / (SR / 2), 'high'); return signal.lfilter(b, a, x)
def osc(freq, kind='sine'):
    ph = 2 * np.pi * np.cumsum(freq) / SR
    if kind == 'saw': return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if kind == 'square': return np.sign(np.sin(ph))
    return np.sin(ph)
def norm(x, peak=1.0): m = np.max(np.abs(x)) or 1; return x / m * peak

# ------------------------------------------------------------------ voices of the toy world
def boing(d=0.75):
    t = t_(d); f = 170 + 260 * (1 - np.exp(-t * 9)) + 40 * np.sin(2 * np.pi * 13 * t) * np.exp(-t * 3)
    x = osc(f) + 0.25 * osc(f * 2.01) + 0.08 * osc(f * 3.0)
    return norm(x * np.exp(-t * 4.2) * env_ad(len(t), 0.004, 0.05), 0.8)

def kazoo(notes, buzz=0.5, gain=0.8):
    """notes: [(dur, f0_start, f0_end)] - a kazoo crow: saw source with buzz, two formants"""
    out = []
    for d, f0, f1 in notes:
        t = t_(d); f = np.geomspace(f0, f1, len(t)) * (1 + 0.012 * np.sin(2 * np.pi * 6.5 * t))
        src = osc(f, 'saw') + buzz * rng.standard_normal(len(t)) * (0.5 + 0.5 * osc(f, 'square'))
        y = 0.7 * bp(src, 900, 1500) + 0.5 * bp(src, 2200, 3200) + 0.25 * lp(src, 700)
        out.append(y * env_ad(len(t), 0.012, min(0.06, d * 0.4)))
        out.append(np.zeros(int(SR * 0.015)))
    return norm(np.concatenate(out), gain)

def crow(big=1.0):
    k = 1.0 + 0.12 * (big - 1)
    return kazoo([(0.11, 520 * k, 560 * k), (0.11, 600 * k, 640 * k), (0.12, 560 * k, 600 * k), (0.42 * big, 700 * k, 610 * k)], gain=0.75)

def pop(bright=1.0):
    t = t_(0.09); n = rng.standard_normal(len(t))
    x = hp(n, 1500 * bright) * np.exp(-t * 90) * 0.7 + osc(np.full(len(t), 140 * bright)) * np.exp(-t * 60) * 0.6
    return norm(x, 0.7)

def paper_flick():
    t = t_(0.18); n = rng.standard_normal(len(t))
    return norm(bp(n, 2500, 7000) * np.exp(-t * 28) * (0.6 + 0.4 * np.sin(2 * np.pi * 60 * t)), 0.4)

def whoosh(d=0.5, up=False):
    t = t_(d); n = rng.standard_normal(len(t)); out = np.zeros(len(t)); step = int(SR * 0.01)
    for i in range(0, len(t), step):
        u = i / len(t); fc = (300 + 2500 * u) if up else (2600 - 2200 * u)
        seg = n[i:i + step]; out[i:i + len(seg)] = bp(seg, fc * 0.7, fc * 1.3, 1)
    return norm(out * np.sin(np.pi * t / d) ** 1.5, 0.6)

def thud():
    t = t_(0.35); x = osc(70 * np.exp(-t * 2)) * np.exp(-t * 14) + lp(rng.standard_normal(len(t)), 400) * np.exp(-t * 30) * 0.4
    return norm(x, 0.8)

def clap():
    t = t_(0.12); return norm(lp(rng.standard_normal(len(t)), 2200) * np.exp(-t * 55), 0.55)

def step():
    t = t_(0.07); return norm(lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 70), 0.35)

def creak(d=0.4, rate=11, f0=950):
    t = t_(d); out = np.zeros(len(t)); k = 0
    while k < len(t):
        n = int(SR * 0.035); tt = np.arange(n) / SR
        ch = osc(np.linspace(f0, f0 * 1.25, n)) * np.sin(np.pi * tt / tt[-1]) ** 2
        end = min(len(t), k + n); out[k:end] += ch[:end - k] * (0.6 + 0.4 * rng.random())
        k += int(SR / (rate * (0.8 + 0.4 * rng.random())))
    return norm(out, 0.35)

def ding(f=1320, d=1.4):
    t = t_(d); x = sum(a * osc(np.full(len(t), f * r)) * np.exp(-t * dk) for r, a, dk in [(1, 1, 3), (2.76, 0.4, 5), (5.4, 0.2, 8), (0.5, 0.25, 2.5)])
    return norm(x * env_ad(len(t), 0.002, 0.1), 0.45)

def zip_(d=0.3):
    t = t_(d); n = rng.standard_normal(len(t)); out = np.zeros(len(t)); s = int(SR * 0.006)
    for i in range(0, len(t), s):
        fc = 1500 + 4000 * i / len(t); seg = n[i:i + s]; out[i:i + len(seg)] = bp(seg, fc * 0.8, fc * 1.2, 1)
    return norm(out * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 45 * t))) * np.sin(np.pi * t / d), 0.4)

def crickets(d):
    t = t_(d); carrier = osc(np.full(len(t), 4300))
    chirp = (np.sin(2 * np.pi * 32 * t) > 0.2).astype(float) * (np.sin(2 * np.pi * 1.6 * t + 1.0) > 0.35)
    c2 = osc(np.full(len(t), 5100)) * (np.sin(2 * np.pi * 27 * t) > 0.3) * (np.sin(2 * np.pi * 1.1 * t + 2.7) > 0.5)
    return norm(lp(carrier * chirp + 0.6 * c2, 7000) * env_ad(len(t), 0.4, 0.4), 0.12)

def snore(d, period=2.4):
    t = t_(d); n = rng.standard_normal(len(t))
    ph = (t % period) / period
    inhale = np.clip(np.sin(np.pi * ph / 0.55), 0, None) * (ph < 0.55)
    exhale = np.clip(np.sin(np.pi * (ph - 0.55) / 0.45), 0, None) * (ph >= 0.55)
    buzz = osc(np.full(len(t), 55), 'saw') * 0.5
    x = bp(n + buzz, 120, 700) * inhale * 0.9 + bp(n, 300, 1800) * exhale * 0.35
    return norm(x * env_ad(len(t), 0.3, 0.3), 0.22)

def tada():
    # bright little paper-toy fanfare: three plucks up a major arpeggio
    out = np.zeros(int(SR * 0.9))
    for k, f in enumerate([784, 988, 1175, 1568]):
        t = t_(0.6); x = (osc(np.full(len(t), f)) + 0.3 * osc(np.full(len(t), 2 * f))) * np.exp(-t * 6)
        i = int(SR * 0.07 * k); out[i:i + len(x)] += x[:len(out) - i]
    return norm(out, 0.5)

# ------------------------------------------------------------------ cue sheet (film seconds)
F = lambda f: f / 24
CUES = [
    (0.47, boing(), -9), (0.64, crow(1.0), -11), (2.47, crow(0.85), -15),
    (5.42, crow(1.35), -9), (6.2, paper_flick(), -16),
    (7.0, pop(0.6), -16), (7.56, pop(0.7), -16), (8.12, pop(0.8), -15), (8.3, ding(1760, 0.6), -22),
    (9.2, step(), -20), (9.35, creak(0.18, 14), -18), (9.6, creak(0.18, 14), -18), (9.84, whoosh(0.18, up=True), -18),
    (9.98, creak(1.0, 9, 820), -17), (10.95, creak(1.3, 13, 900), -16),
    (11.7, ding(1320), -16),
    (F(285) - 0.05, pop(1.0), -5), (F(289) - 0.05, pop(1.1), -5), (F(296) - 0.05, pop(0.9), -6), (F(303) - 0.05, pop(1.2), -5), (F(310) - 0.05, pop(1.0), -6),
    (12.3, paper_flick(), -15),
    (13.55, clap(), -12), (13.72, clap(), -12), (13.6, whoosh(0.34), -10), (13.93, thud(), -9),
    (14.25, crickets(1.3), 2),
    (14.9, kazoo([(0.08, 900, 1100)], buzz=0.2, gain=0.4), -20),
    (SNATCH := 15.0, whoosh(0.16, up=True), -15), (15.62, whoosh(0.12, up=True), -15), (15.66, tada(), -12),
    (15.66, paper_flick(), -14),
    (17.3, zip_(), -14), (17.6, ding(2093, 0.8), -20), (17.75, pop(0.7), -16), (18.07, step(), -16),
    (18.2, crow(1.5), -8),
] + [(15.95 + k * 0.17, step(), -24) for k in range(8)] + [(F(448) + k * 0.06, pop(1.3 + 0.1 * k), -17) for k in range(6)]
BEDS = [(2.06, crickets(9.0), 4), (2.06, snore(2.25), -13), (13.95, snore(1.7), -10), (15.66, snore(4.34), -12)]

def place(bus, t0, x, db):
    i = int(t0 * SR); g = 10 ** (db / 20); end = min(len(bus), i + len(x))
    if end > i: bus[i:end] += x[:end - i] * g

def music_bus():
    tmp = os.path.join(tempfile.gettempdir(), 'sfx_music_window.wav')
    subprocess.run([os.environ.get('FFMPEG', 'ffmpeg'), '-v', 'error', '-y', '-ss', str(MUSIC_START), '-t', str(DUR + 0.5), '-i', MUSIC, '-ac', '2', '-ar', str(SR), tmp], check=True)
    m, _ = sf.read(tmp); m = m[:N]
    if len(m) < N: m = np.pad(m, ((0, N - len(m)), (0, 0)))
    t = np.arange(N) / SR
    # the gag: the music stops dead as the sun drops (13.62) and returns on the downbeat f376 (15.657)
    g = np.ones(N)
    g[(t >= 13.62) & (t < 15.657)] = 0.0
    fo = (t >= 13.56) & (t < 13.62); g[fo] = 1 - (t[fo] - 13.56) / 0.06
    # the quiet build bar (8.86..11.12) stays as the track has it; final fade 19.6..20
    fe = t >= 19.55; g[fe] *= np.clip(1 - (t[fe] - 19.55) / 0.45, 0, 1)
    # make room for the crows (anticipating by 60 ms, -3 dB)
    for a, b in [(0.64, 1.45), (2.47, 3.2), (5.42, 6.3), (18.2, 19.25)]:
        w = np.clip(np.minimum((t - (a - 0.06)) / 0.06, ((b + 0.15) - t) / 0.15), 0, 1)
        g *= 1 - (1 - 10 ** (-3.0 / 20)) * w
    return m * g[:, None]

def main():
    out = sys.argv[1]
    sfx = np.zeros(N)
    for t0, x, db in CUES: place(sfx, t0, x, db)
    for t0, x, db in BEDS: place(sfx, t0, x, db)
    # night crickets only before the sunrise and in the gag; duck them under crows
    st = np.stack([sfx, sfx], 1)
    # tiny stereo spread for life
    st[:, 0] = sfx; st[:, 1] = np.concatenate([np.zeros(24), sfx[:-24]])
    mix = st * 3.2
    if '--no-music' not in sys.argv and not os.path.isfile(MUSIC):
        print(f'sfx: no music at {MUSIC}; effects only', file=sys.stderr)
    elif '--no-music' not in sys.argv:
        mix = mix + music_bus() * 0.62
    peak = np.max(np.abs(mix)); mix = mix / max(1.0, peak / 0.95)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sf.write(out, mix.astype(np.float32), SR, subtype='FLOAT')
    if '--stems' in sys.argv:
        d = sys.argv[sys.argv.index('--stems') + 1]; os.makedirs(d, exist_ok=True)
        sf.write(os.path.join(d, 'sfx.wav'), st.astype(np.float32), SR, subtype='FLOAT')
    print('wrote', out, 'peak', round(float(np.max(np.abs(mix))), 3))

if __name__ == '__main__':
    main()
