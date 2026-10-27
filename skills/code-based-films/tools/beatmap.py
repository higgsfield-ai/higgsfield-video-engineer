#!/usr/bin/env python3
"""beatmap.py — bar map of a music track for code edits (owner: AUDIO/TOOLS).

Usage (run with the librosa venv, -I when the input is downloaded media):
  python -I tools/beatmap.py <track|video> [--start s] [--dur d] [--fps 24] --out edits/x/beatmap.json
  python -I tools/beatmap.py <track> --choose-window 15 [--fps 24]          # suggest best 15 s windows
Inputs: anything ffmpeg decodes (mp3, wav, m4a, aac, flac, aif, ogg, mp4/mov audio). Decoded by ffmpeg → mono f32 22.05 kHz.

Method (editing-method.md §1–2): find the BAR, not just the BPM.
  * Tempo: candidates from librosa + low-band (kick) autocorrelation, every candidate also tried at ×2 / ×½ / ×1.5 / ×⅔;
    each is fitted as a fixed grid (BPM ±1.5 %, phase) and scored by on-beat vs off-beat (half-beat) onset CONTRAST on the
    full band and on the kick band, plus a weak tempo prior (~115 BPM). Half/double alternatives and their scores are reported.
  * Downbeat phase: of the 4 possible bar phases, the one whose beat-1s carry the most low-band (<150 Hz) energy.
  * Beats are the fitted grid, each snapped to a local onset peak only if one lies within ±25 ms.
  * Sections from per-bar RMS/density; density targets: hook 4–9 ev/s, breath 1–1.5, drop 5–6.5, release ≈1.
  * Stops / silences, pickups (onset 2–4 frames before a downbeat), risers (rising RMS or centroid into a downbeat),
    drop (largest bar-to-bar loudness jump into a sustained loud passage), top-10 transients (spectral-flux peaks
    weighted by loudness, de-duplicated ≥ 0.15 s).
All output times are FILM seconds (t = 0 ↔ --start in the file) and frames f = round(t·fps).

beatmap.json schema (runtime reads the flat arrays; details for tools/humans):
  bpm, beat (s), bar (s), fps, start, duration, source, tempo_candidates[], downbeat_confidence,
  beats[s], downbeats[s], hits[s] (top-10, time-sorted), stops[s] (start times), drop: s|null,
  frames: {beats[], downbeats[], hits[], stops[], drop},
  bars:[{i,t,f,end,rms_db,low_db,onsets_per_s,section,flags[]}], sections:[{name,kind,from_bar,to_bar,t,end,f,rms_db,density_target}],
  hits_detail:[{rank,t,f,score,nearest_beat_off_f,on_downbeat}], stops_detail:[{t,end,f,f_end,dur,kind,depth_db,next_downbeat}],
  pickups:[{t,f,downbeat_t,downbeat_f,frames_before,strength}], risers:[{t,end,f,f_end,rms_rise_db,centroid_rise_pct,into_downbeat}],
  drop_detail:{t,f,jump_db,low_jump_db,bar}|null, onsets[s] (all detected onsets, for micro-events on 16ths).
"""
import argparse, json, math, os, subprocess, sys
import numpy as np
import librosa

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')
SR = 22050
HOP = 256          # 11.6 ms analysis hop
HOP_FINE = 128     # 5.8 ms for transient timing
AUDIO_EXT = {'.mp3', '.wav', '.m4a', '.aac', '.flac', '.aif', '.aiff', '.ogg', '.opus', '.wma',
             '.mp4', '.mov', '.m4v', '.mkv', '.webm'}


# ----------------------------------------------------------------------------- io
def decode(path, start=0.0, dur=None, sr=SR):
    cmd = [FFMPEG, '-v', 'error', '-nostdin']
    if start and start > 0: cmd += ['-ss', f'{start:.4f}']
    cmd += ['-i', path]
    if dur: cmd += ['-t', f'{dur:.4f}']
    cmd += ['-vn', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not r.stdout:
        sys.exit(f'beatmap: ffmpeg could not decode audio from {path}: {r.stderr.decode(errors="replace")[:400]}')
    return np.frombuffer(r.stdout, '<f4').astype(np.float32)


def probe_duration(path):
    r = subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except ValueError: return None


def db(x): return 20 * np.log10(np.maximum(x, 1e-9))


# ----------------------------------------------------------------------------- features
def features(y):
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    mel = librosa.feature.melspectrogram(S=S ** 2, sr=SR, n_mels=96, fmax=11025)
    mel_f = librosa.mel_frequencies(n_mels=96, fmax=11025)
    mel_db = librosa.power_to_db(mel, ref=np.max)
    lowb = mel_f < 150
    midb = (mel_f >= 150) & (mel_f < 4000)
    env = librosa.onset.onset_strength(S=mel_db, sr=SR, hop_length=HOP)
    env_low = librosa.onset.onset_strength(S=mel_db[lowb], sr=SR, hop_length=HOP)
    env_mid = librosa.onset.onset_strength(S=mel_db[midb], sr=SR, hop_length=HOP)
    rms = librosa.feature.rms(S=S, frame_length=2048, hop_length=HOP)[0]
    low_lin = np.sqrt((S[freqs < 150] ** 2).sum(0)) / 2048
    cent = librosa.feature.spectral_centroid(S=S, sr=SR)[0]
    # fine flux for transient timing (log-compressed magnitude, positive diff, max-filtered reference = superflux-ish)
    Sf = np.abs(librosa.stft(y, n_fft=1024, hop_length=HOP_FINE))
    L = np.log1p(10 * Sf)
    ref = np.maximum.reduce([np.roll(L, k, axis=0) for k in (-1, 0, 1)])
    flux = np.r_[0, np.maximum(0, L[:, 1:] - ref[:, :-1]).sum(0)]
    # attack envelope: 1 ms hop, log energy of the >60 Hz signal, 4 ms smoothing (for sample-accurate attack times)
    import scipy.signal as ss
    bb, aa = ss.butter(2, 60 / (SR / 2), 'high'); yh = ss.lfilter(bb, aa, y)
    h = SR // 1000; nn = len(yh) // h
    e1 = np.log(np.maximum((yh[:nn * h].reshape(nn, h) ** 2).mean(1), 1e-12))
    e1 = np.convolve(e1, np.ones(4) / 4, 'same')
    n = min(len(env), len(rms))
    return dict(att=e1, fps_att=SR / h, env=env[:n], env_low=env_low[:n], env_mid=env_mid[:n], rms=rms[:n], low=low_lin[:n], cent=cent[:n],
                flux=flux, fps_a=SR / HOP, fps_f=SR / HOP_FINE)


def norm(x):
    x = np.asarray(x, float); s = x.std()
    return (x - x.mean()) / (s if s > 1e-9 else 1)


def sample(env, times, fps_a, win=1):
    """max of env within ±win analysis frames around each time"""
    idx = np.round(np.asarray(times) * fps_a).astype(int)
    idx = idx[(idx >= 0) & (idx < len(env))]
    if len(idx) == 0: return np.zeros(0)
    out = np.max([env[np.clip(idx + k, 0, len(env) - 1)] for k in range(-win, win + 1)], axis=0)
    return out


def attack(F, t, back=0.05, fwd=0.025):
    """time of the steepest energy rise near t (onset-function peaks are biased by the analysis window)"""
    e = F['att']; fa = F['fps_att']
    a, b = max(1, int((t - back) * fa)), min(len(e) - 1, int((t + fwd) * fa))
    if b - a < 3: return t
    d = np.diff(e[a - 1:b + 1])
    return (a + int(np.argmax(d))) / fa


# Optional neural cross-check, off by default: needs torch + beat_this (not in requirements/) and BEATMAP_NN_CKPT set
# to a beat_this checkpoint you trust (the official CPJKU release). It loads with torch.load(weights_only=True).
NN_CKPT = os.environ.get('BEATMAP_NN_CKPT', '')


def nn_beats(y):
    """beat_this (CPJKU, MIT) beats+downbeats when BEATMAP_NN_CKPT is set; else None. Used as a seed/cross-check."""
    if not NN_CKPT: return None
    if not os.path.isfile(NN_CKPT):
        print(f'beatmap: BEATMAP_NN_CKPT={NN_CKPT} not found; DSP only', file=sys.stderr); return None
    try:
        import warnings; warnings.filterwarnings('ignore')
        import torch
        from beat_this.inference import Audio2Beats
        a2b = Audio2Beats(checkpoint_path=NN_CKPT, device='cpu', float16=False, dbn=False)
        with torch.no_grad():
            b, d = a2b(y, SR)
        return np.asarray(b, float), np.asarray(d, float)
    except Exception as e:
        print(f'beatmap: beat_this unavailable ({e!r}); DSP only', file=sys.stderr)
        return None


# ----------------------------------------------------------------------------- tempo
def autocorr_peaks(env, fps_a, lo=55, hi=210, k=3):
    e = env - env.mean()
    ac = np.correlate(e, e, 'full')[len(e) - 1:]
    ac /= ac[0] + 1e-9
    lags = np.arange(len(ac))
    lmin, lmax = int(fps_a * 60 / hi), int(fps_a * 60 / lo)
    seg = ac[lmin:lmax + 1]
    pk = [i for i in range(1, len(seg) - 1) if seg[i] > seg[i - 1] and seg[i] >= seg[i + 1]]
    pk = sorted(pk, key=lambda i: -seg[i])[:k]
    out = []
    for i in pk:  # parabolic refine
        a, b, c = seg[i - 1], seg[i], seg[i + 1]
        d = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
        lag = lmin + i + d
        out.append(60 * fps_a / lag)
    return out


def fit_grid(env, fps_a, bpm0, span=0.015, dur=None):
    """best (bpm, phase) for a fixed grid near bpm0, maximising mean onset on the grid"""
    dur = dur or len(env) / fps_a
    best = (-1e9, bpm0, 0.0)
    for bpm in np.arange(bpm0 * (1 - span), bpm0 * (1 + span), max(0.01, bpm0 * 0.0005)):
        T = 60 / bpm
        phs = np.arange(0, T, 0.004)
        grid = np.arange(0, dur - 0.05, T)
        idx = np.round((grid[None, :] + phs[:, None]) * fps_a).astype(int)
        idx = np.clip(idx, 0, len(env) - 1)
        v = env[idx].mean(1)
        j = int(np.argmax(v))
        if v[j] > best[0]: best = (v[j], bpm, phs[j])
    return best[1], best[2], best[0]


def grid_contrast(env, fps_a, bpm, ph, dur):
    T = 60 / bpm
    on = np.arange(ph, dur - 0.05, T)
    off = on + T / 2
    off = off[off < dur - 0.05]
    a, b = sample(env, on, fps_a, 1), sample(env, off, fps_a, 1)
    if len(a) < 4 or len(b) < 4: return 0.0
    return float((a.mean() - b.mean()) / (env.std() + 1e-9))


def regress_grid(F, env, bpm, ph, dur):
    """refine (bpm, phase) by least squares on the attack times of strong onsets that sit on the grid (±60 ms)"""
    T = 60 / bpm
    grid = np.arange(ph, dur - 0.05, T)
    fps_a = F['fps_a']; thr = np.percentile(env, 70)
    k_, t_ = [], []
    for k, g in enumerate(grid):
        i = int(round(g * fps_a)); w = int(0.06 * fps_a)
        a, b = max(0, i - w), min(len(env), i + w + 1)
        if b - a < 3: continue
        j = a + int(np.argmax(env[a:b]))
        if env[j] > thr and 0 < j - a < b - a - 1:
            k_.append(k); t_.append(j / fps_a)
    if len(k_) < 6: return bpm, ph, len(k_) / max(1, len(grid))
    k_, t_ = np.array(k_, float), np.array(t_)
    for _ in range(2):  # robust: drop the worst residuals once
        A = np.c_[k_, np.ones_like(k_)]; sol, *_ = np.linalg.lstsq(A, t_, rcond=None)
        res = np.abs(A @ sol - t_); keep = res <= max(0.02, np.percentile(res, 80))
        k_, t_ = k_[keep], t_[keep]
    A = np.c_[k_, np.ones_like(k_)]; sol, *_ = np.linalg.lstsq(A, t_, rcond=None)
    T2, ph2 = float(sol[0]), float(sol[1])
    if abs(T2 / T - 1) > 0.02: return bpm, ph, len(k_) / len(grid)
    return 60 / T2, ph2 % T2, len(k_) / len(grid)


def subdivision(env, fps_a, bpm, ph, dur):
    """binary vs ternary: onset at T/2 minus onset at T/3, 2T/3 (z units). A ×⅔ alias of the true tempo scores negative."""
    T = 60 / bpm; on = np.arange(ph, dur - 0.05, T)
    h = sample(env, on + T / 2, fps_a, 1)
    t3 = np.r_[sample(env, on + T / 3, fps_a, 1), sample(env, on + 2 * T / 3, fps_a, 1)]
    if len(h) < 3 or len(t3) < 3: return 0.0
    return float((h.mean() - t3.mean()) / (env.std() + 1e-9))


def hit_fraction(env, fps_a, bpm, ph, dur):
    T = 60 / bpm; on = np.arange(ph, dur - 0.05, T)
    v = sample(env, on, fps_a, 2)
    return float((v > np.percentile(env, 60)).mean()) if len(v) else 0.0


def estimate_tempo(F, dur):
    fps_a = F['fps_a']
    env, low, mid = norm(F['env']), norm(F['env_low']), norm(F['env_mid'])
    comb = env + 0.7 * low + 0.5 * mid
    seeds = []
    t_lib = None
    try:
        t_lib = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=F['env'], sr=SR, hop_length=HOP))[0])
        seeds.append(('librosa', t_lib))
    except Exception:
        pass
    if F.get('nn') is not None and len(F['nn'][0]) >= 6:
        ib = np.diff(F['nn'][0]); ib = ib[(ib > 0.25) & (ib < 1.2)]
        if len(ib) >= 4: seeds.append(('beat_this', 60 / float(np.median(ib))))
    ac = autocorr_peaks(F['env_low'], fps_a, lo=60, hi=200, k=1)
    if ac: seeds.append(('kick_autocorr', ac[0]))
    full = []
    for src, c in seeds:
        for m_ in (1, 2, 0.5):           # octave errors (half/double) are checked; 3:2 only via the subdivision report
            b = c * m_
            if 55 <= b <= 210: full.append(b)
    merged = []
    for b in sorted(full):
        if not merged or abs(b - merged[-1]) / merged[-1] > 0.025: merged.append(b)
    res = []
    for b in merged:
        bpm, ph, fit = fit_grid(comb, fps_a, b, span=0.035, dur=dur)
        bpm, ph, frac_on = regress_grid(F, comb, bpm, ph, dur)
        c_full = grid_contrast(env, fps_a, bpm, ph, dur)
        c_low = grid_contrast(low, fps_a, bpm, ph, dur)
        c_mid = grid_contrast(mid, fps_a, bpm, ph, dur)
        hf = hit_fraction(comb, fps_a, bpm, ph, dur)
        sub = subdivision(env, fps_a, bpm, ph, dur)
        prior = -2.0 * (math.log2(bpm / 120.0)) ** 2   # editors count 70–180; strong vs half-time aliases
        score = c_full + 0.5 * c_low + 0.5 * c_mid + 1.5 * hf + 0.5 * sub + prior
        res.append(dict(bpm=round(bpm, 2), phase=round(ph, 4), score=round(score, 3), fit=round(float(fit), 3),
                        hit_frac=round(hf, 2), subdiv=round(sub, 3), contrast_full=round(c_full, 3), contrast_kick=round(c_low, 3),
                        contrast_snare=round(c_mid, 3)))
    res.sort(key=lambda r: -r['score'])
    ded = []
    for r in res:
        if not any(abs(r['bpm'] - q['bpm']) / q['bpm'] < 0.004 for q in ded): ded.append(r)
    res = ded
    for r in res:
        r['seeds'] = [n for n, c in seeds if min(abs(math.log2(r['bpm'] / c) - k) for k in (0,)) < 0.03]
    return res, t_lib, comb


# ----------------------------------------------------------------------------- analysis
def onset_times(F, delta=0.25):
    env = F['env']
    pk = librosa.util.peak_pick(env / (env.max() + 1e-9), pre_max=3, post_max=3, pre_avg=10, post_avg=10,
                                delta=delta * np.std(env) / (env.max() + 1e-9) * 3, wait=4)
    ts = np.array([attack(F, p / F['fps_a'], 0.05, 0.02) for p in pk])
    return ts, env[pk] if len(pk) else np.zeros(0)


def bar_stats(F, t0, t1):
    a, b = int(t0 * F['fps_a']), max(int(t0 * F['fps_a']) + 1, int(t1 * F['fps_a']))
    r = F['rms'][a:b]; l = F['low'][a:b]; c = F['cent'][a:b]
    if len(r) == 0: return -120.0, -120.0, 0.0
    return float(db(np.sqrt((r ** 2).mean()))), float(db(np.sqrt((l ** 2).mean()))), float(np.median(c))


def detect_stops(F, bar_len, dur):
    fps_a = F['fps_a']
    r = db(np.convolve(F['rms'], np.ones(3) / 3, 'same'))
    loud = np.percentile(r, 95)
    out = []
    # absolute silence
    sil = r < max(-55.0, loud - 35)
    # relative dropout: ≥12 dB under the trailing 1-bar median
    w = max(4, int(bar_len * fps_a))
    trail = np.array([np.median(r[max(0, i - w):i]) if i > 4 else r[i] for i in range(len(r))])
    drop = (r < trail - 12) & ~sil
    for mask, kind, mind in ((sil, 'silence', 0.06), (drop, 'stop', 0.10)):
        i = 0
        while i < len(mask):
            if mask[i]:
                j = i
                while j < len(mask) and mask[j]: j += 1
                t0, t1 = i / fps_a, j / fps_a
                if t1 - t0 >= mind and t0 > 0.05 and t1 < dur - 0.05:
                    depth = float(trail[i] - r[i:j].min()) if kind == 'stop' else float(loud - r[i:j].mean())
                    out.append(dict(t=t0, end=t1, kind=kind, depth_db=round(depth, 1)))
                i = j
            else:
                i += 1
    out.sort(key=lambda s: s['t'])
    merged = []
    for s in out:
        if merged and s['t'] <= merged[-1]['end'] + 0.03:
            m = merged[-1]; m['end'] = max(m['end'], s['end'])
            if s['kind'] == 'silence': m['kind'] = 'silence'
            m['depth_db'] = max(m['depth_db'], s['depth_db'])
        else:
            merged.append(dict(s))
    return merged


def top_transients(F, n=10, min_gap=0.15):
    fl = F['flux']; fps_f = F['fps_f']
    pk = [i for i in range(2, len(fl) - 2) if fl[i] == fl[i - 2:i + 3].max() and fl[i] > 0]
    if not pk: return []
    pk = np.array(pk)
    # loudness right after the onset (60 ms) — "loudest transients"
    rms = F['rms']; fps_a = F['fps_a']
    loud = np.array([rms[min(len(rms) - 1, int(i / fps_f * fps_a)):min(len(rms), int(i / fps_f * fps_a) + 6)].max(initial=0) for i in pk])
    fz = fl[pk] / (np.percentile(fl[pk], 99) + 1e-9)
    lz = loud / (loud.max() + 1e-9)
    score = fz * np.sqrt(lz)
    order = np.argsort(-score)
    chosen = []
    for k in order:
        t = attack(F, pk[k] / fps_f, 0.04, 0.02)
        if all(abs(t - c[0]) >= min_gap for c in chosen):
            chosen.append((t, float(score[k])))
        if len(chosen) >= n: break
    return chosen


def detect_risers(F, beats, downbeats):
    if len(beats) < 6: return []
    fps_a = F['fps_a']
    per = []
    for a, b in zip(beats[:-1], beats[1:]):
        r, _, c = bar_stats(F, a, b); per.append((a, b, r, c))
    R = np.array([p[2] for p in per]); C = np.array([p[3] for p in per])
    out = []
    i = 0
    while i < len(per) - 3:
        j = i
        while j + 1 < len(per) and (R[j + 1] >= R[j] - 0.4) and (C[j + 1] >= C[j] * 0.97 or R[j + 1] > R[j] + 0.5):
            j += 1
        if j - i >= 3:
            rise_db = R[j] - R[i]; rise_c = (C[j] / max(C[i], 1)) - 1
            ups = np.mean(np.diff(R[i:j + 1]) > 0) if j > i else 0
            if (rise_db >= 3.0 or rise_c >= 0.30) and ups >= 0.55:
                end = per[j][1]
                nxt = [d for d in downbeats if d >= end - 0.06]
                into = nxt[0] if nxt and nxt[0] - end < 60 / 100 else None
                out.append(dict(t=per[i][0], end=end, rms_rise_db=round(float(rise_db), 1),
                                centroid_rise_pct=round(float(rise_c * 100), 0), into_downbeat=into))
            i = j + 1
        else:
            i += 1
    return out


def density_target(kind):
    return {'hook': '4–9 ev/s', 'breath': '1–1.5 ev/s', 'drop': '5–6.5 ev/s', 'release': '≈1 ev/s (one held bar)',
            'build': '2→5 ev/s, accelerating on the beat', 'full': '3–5 ev/s', 'mid': '2–3 ev/s',
            'stop': '0 cuts — ONE growing gesture into the next downbeat'}.get(kind, '2–4 ev/s')


def analyze(y, fps, ctx0=0.0, film_dur=None, label=''):
    """y = decoded audio; ctx0 = seconds of context before film t=0 contained in y. Returns beatmap dict in film time."""
    dur_y = len(y) / SR
    F = features(y)
    F['nn'] = nn_beats(y)
    cands, t_lib, comb = estimate_tempo(F, dur_y)
    best = cands[0]
    bpm, ph = best['bpm'], best['phase']
    T = 60 / bpm
    grid = np.arange(ph, dur_y - 0.02, T)
    # the onset envelope is late/early by part of its window: shift the grid by the median attack offset of strong beats
    E = F['env']; thr85 = np.percentile(E, 85)
    offs = [attack(F, g, 0.06, 0.03) - g for g in grid if E[min(len(E) - 1, int(g * F['fps_a']))] > thr85]
    grid_shift = float(np.median(offs)) if len(offs) >= 4 else 0.0
    grid = grid + grid_shift
    if grid[0] - T >= -0.002: grid = np.r_[grid[0] - T, grid]
    grid = grid[grid >= -0.002]
    # snap to nearby onset peaks (±25 ms) to survive slight drift; keep grid otherwise
    beats = []
    env = F['env']; fps_a = F['fps_a']
    for g in grid:
        i = int(round(g * fps_a)); w = int(0.025 * fps_a)
        a, b = max(0, i - w), min(len(env), i + w + 1)
        if b - a < 2: beats.append(g); continue
        k = a + int(np.argmax(env[a:b]))
        if env[k] > np.percentile(env, 75):
            at = attack(F, g, 0.03, 0.03)
            beats.append(at if abs(at - g) <= 0.025 else g)
        else:
            beats.append(g)
    beats = np.array(beats)
    # downbeat phase: low-band energy at beat (±35 ms)
    lowe = norm(F['low']); lowo = norm(F['env_low'])
    nn = F.get('nn'); nn_ok = False
    if nn is not None and len(nn[0]) >= 8 and len(nn[1]) >= 3:
        ib = np.median(np.diff(nn[0]))
        nn_ok = abs(ib / T - 1) < 0.04       # the network counts the same beat as we do → trust its bar phase as a vote
    scores = []
    for p in range(4):
        b1 = beats[p::4]
        s = sample(lowe, b1, fps_a, 2).mean() + 0.5 * sample(lowo, b1, fps_a, 1).mean() if len(b1) else -9
        if nn_ok and len(b1):
            s += 1.5 * float(np.mean([np.min(np.abs(nn[1] - d)) < 0.07 for d in b1]))
        scores.append(float(s))
    order = np.argsort(scores)[::-1]
    p = int(order[0])
    conf = float((scores[order[0]] - scores[order[1]]) / (abs(scores[order[0]]) + abs(scores[order[1]]) + 1e-9))
    downs = beats[p::4]
    nn_agree = None
    if F.get('nn') is not None and len(F['nn'][1]) >= 2:
        nd = F['nn'][1]
        nn_agree = round(float(np.mean([np.min(np.abs(nd - d)) < 0.07 for d in downs if nd[0] - 0.1 <= d <= nd[-1] + 0.1] or [0])), 2)
    # prepend implied downbeats before the first detected one (pickup bar)
    while downs[0] > 0.03:          # implied (partial) bar before the first full one
        downs = np.r_[downs[0] - 4 * T, downs]
    on_t, on_s = onset_times(F)
    stops = detect_stops(F, 4 * T, dur_y)
    hits = top_transients(F, 10)
    hits40 = top_transients(F, 40)
    risers = detect_risers(F, beats, downs)
    # bars
    bars = []
    bar_edges = list(downs) + [downs[-1] + 4 * T]
    for i in range(len(bar_edges) - 1):
        a, b = bar_edges[i], bar_edges[i + 1]
        if b <= 0 or a >= dur_y: continue
        r, l, c = bar_stats(F, max(a, 0), min(b, dur_y))
        nons = int(((on_t >= a) & (on_t < b)).sum())
        bars.append(dict(t=a, end=b, rms_db=round(r, 1), low_db=round(l, 1), cent=round(c, 0),
                         onsets_per_s=round(nons / max(1e-3, (min(b, dur_y) - max(a, 0))), 2)))
    # drop: biggest bar-to-bar jump (rms + low) into a sustained loud bar
    loud_ref = np.percentile([b['rms_db'] for b in bars], 90) if bars else 0
    drop = None; drops_all = []
    for i in range(1, len(bars)):
        prev = bars[i - 1]; cur = bars[i]
        # compare with min of the previous 1–2 bars (a stop/break bar before the drop)
        pv = min(prev['rms_db'], bars[i - 2]['rms_db']) if i >= 2 else prev['rms_db']
        pl = min(prev['low_db'], bars[i - 2]['low_db']) if i >= 2 else prev['low_db']
        jump = cur['rms_db'] - prev['rms_db']; jump2 = cur['rms_db'] - pv
        lj = cur['low_db'] - pl
        sustained = cur['rms_db'] >= loud_ref - 3
        sc = max(jump, 0.7 * jump2) + 0.4 * max(lj, 0)
        if sustained and sc >= 3.0:
            drops_all.append(dict(t=cur['t'], jump_db=round(max(jump, jump2), 1), low_jump_db=round(lj, 1),
                                  score=round(sc, 2), bar=i))
    if drops_all:
        drop = max(drops_all, key=lambda d: d['score'])
    # sections
    kinds = []
    for b in bars:
        rel = b['rms_db'] - loud_ref
        k = 'full' if rel >= -3 else ('mid' if rel >= -8 else 'breath')
        if any(s['t'] < b['end'] and s['end'] > b['t'] and (s['end'] - s['t']) >= T * 0.75 for s in stops): k = 'stop'
        kinds.append(k)
    for rz in risers:
        for i, b in enumerate(bars):
            if b['t'] >= rz['t'] - 0.05 and b['end'] <= rz['end'] + T and kinds[i] in ('mid', 'breath', 'full'):
                if drop is None or b['t'] < drop['t']: kinds[i] = 'build' if kinds[i] != 'full' else kinds[i]
    if drop:
        i = drop['bar']
        while i < len(bars) and bars[i]['rms_db'] >= loud_ref - 3.5 and i < drop['bar'] + 8:
            kinds[i] = 'drop'; i += 1
    # film window mapping
    t0 = ctx0
    fd = film_dur if film_dur else dur_y - ctx0
    def F_(t): return int(round((t - t0) * fps))
    def ft(t): return round(t - t0, 4)
    def inwin(t, pad=0.0): return t0 - pad <= t <= t0 + fd + pad
    film_bars = [(i, b) for i, b in enumerate(bars) if b['end'] > t0 + 0.02 and b['t'] < t0 + fd - 0.02]
    # hook = first film bar; release = last film bar if quieter than the bar before and after the drop
    if film_bars:
        i0 = film_bars[0][0]
        if kinds[i0] not in ('stop',): kinds[i0] = 'hook'
        il = film_bars[-1][0]
        if len(film_bars) > 2 and bars[il]['rms_db'] < bars[film_bars[-2][0]]['rms_db'] - 2.5: kinds[il] = 'release'
    sections = []
    for i, b in film_bars:
        k = kinds[i]
        if sections and sections[-1]['kind'] == k and k not in ('hook',):
            s = sections[-1]; s['to_bar'] = i; s['end'] = ft(b['end']); s['_r'].append(b['rms_db'])
        else:
            sections.append(dict(kind=k, from_bar=i, to_bar=i, t=ft(b['t']), end=ft(b['end']), _r=[b['rms_db']]))
    for s in sections:
        s['rms_db'] = round(float(np.mean(s.pop('_r'))), 1); s['f'] = int(round(s['t'] * fps)); s['f_end'] = int(round(s['end'] * fps))
        s['bars'] = s['to_bar'] - s['from_bar'] + 1; s['density_target'] = density_target(s['kind'])
        s['name'] = s['kind']
    # pickups: onset 2–4 frames before a downbeat
    pickups = []
    if len(on_t):
        thr = np.percentile(on_s, 40)
        for d in downs:
            if not inwin(d): continue
            for t, s in zip(on_t, on_s):
                fb = (d - t) * fps
                if 1.5 <= fb <= 4.5 and s >= thr:
                    pickups.append(dict(t=ft(t), f=F_(t), downbeat_t=ft(d), downbeat_f=F_(d), frames_before=round(fb, 1),
                                        strength=round(float(s / (on_s.max() + 1e-9)), 2)))
    beat_film = [b for b in beats if inwin(b, 0.001)]
    down_film = [d for d in downs if inwin(d, 0.001)]
    def nearest_off(t, arr):
        if not len(arr): return None
        a = np.asarray(arr); k = int(np.argmin(np.abs(a - t))); return round((t - a[k]) * fps, 1)
    hits_win = [(t, s) for t, s in hits40 if inwin(t)][:10] if (ctx0 > 0 or film_dur) else hits
    hits_detail = []
    for r, (t, s) in enumerate(sorted(hits_win, key=lambda h: -h[1])):
        hits_detail.append(dict(rank=r + 1, t=ft(t), f=F_(t), score=round(s, 3), nearest_beat_off_f=nearest_off(t, beats),
                                on_downbeat=bool(abs(nearest_off(t, downs) or 99) <= 1.0)))
    stops_detail = []
    for s in stops:
        if s['end'] < t0 or s['t'] > t0 + fd: continue
        nd = [d for d in downs if d >= s['end'] - 0.08]
        stops_detail.append(dict(t=ft(s['t']), end=ft(s['end']), f=F_(s['t']), f_end=F_(s['end']), dur=round(s['end'] - s['t'], 3),
                                 kind=s['kind'], depth_db=s['depth_db'], next_downbeat=ft(nd[0]) if nd else None,
                                 next_downbeat_f=F_(nd[0]) if nd else None))
    risers_detail = [dict(t=ft(r['t']), end=ft(r['end']), f=F_(r['t']), f_end=F_(r['end']), rms_rise_db=r['rms_rise_db'],
                          centroid_rise_pct=r['centroid_rise_pct'],
                          into_downbeat=ft(r['into_downbeat']) if r['into_downbeat'] is not None else None)
                     for r in risers if r['end'] > t0 and r['t'] < t0 + fd]
    drop_film = drop if (drop and inwin(drop['t'])) else None
    bars_out = []
    for n_, (i, b) in enumerate(film_bars):
        flags = ['partial'] if b['t'] < t0 - 0.002 else []
        if drop_film and abs(b['t'] - drop_film['t']) < 1e-6: flags.append('DROP')
        if any(s['t'] < b['end'] and s['end'] > b['t'] for s in stops): flags.append('stop')
        if any(r['t'] < b['end'] and r['end'] > b['t'] for r in risers): flags.append('riser')
        if any(abs(p['downbeat_t'] - ft(b['t'])) < 1e-4 for p in pickups): flags.append('pickup')
        bars_out.append(dict(i=n_ + 1, t=ft(b['t']), f=F_(b['t']), end=ft(b['end']), rms_db=b['rms_db'], low_db=b['low_db'],
                             onsets_per_s=b['onsets_per_s'], section=kinds[i], flags=flags))
    out = dict(
        source=label, fps=fps, start=round(t0, 4), duration=round(fd, 4),
        bpm=bpm, beat=round(T, 5), bar=round(4 * T, 5), meter='4/4 (assumed)',
        librosa_bpm=round(t_lib, 2) if t_lib else None,
        tempo_candidates=cands[:6],
        tempo_ambiguous=(not cands[0].get('forced')) and bool(any(c['score'] > cands[0]['score'] - 1.0 and abs(math.log2(c['bpm'] / cands[0]['bpm'])) > 0.4
                                 for c in cands[1:])) or dur_y < 9.0 or cands[0]['hit_frac'] < 0.75,
        tempo_alternative=next((c['bpm'] for c in cands[1:] if abs(math.log2(c['bpm'] / cands[0]['bpm'])) > 0.4), None),
        nn_downbeat_agreement=nn_agree,
        downbeat_phase=p, downbeat_confidence=round(conf, 3), downbeat_scores=[round(s, 3) for s in scores],
        beats=[ft(b) for b in beat_film], downbeats=[ft(d) for d in down_film],
        hits=sorted(h['t'] for h in hits_detail),
        stops=[s['t'] for s in stops_detail],
        drop=ft(drop_film['t']) if drop_film else None,
        frames=dict(beats=[F_(b) for b in beat_film], downbeats=[F_(d) for d in down_film],
                    hits=sorted(h['f'] for h in hits_detail), stops=[s['f'] for s in stops_detail],
                    drop=F_(drop_film['t']) if drop_film else None),
        bars=bars_out, sections=sections, hits_detail=hits_detail, stops_detail=stops_detail,
        pickups=pickups, risers=risers_detail,
        drop_candidates=[dict(t=ft(d['t']), f=F_(d['t']), jump_db=d['jump_db'], low_jump_db=d['low_jump_db'], score=d['score'])
                         for d in sorted(drops_all, key=lambda d: -d['score']) if inwin(d['t'])][:3],
        grid_shift_ms=round(grid_shift * 1000, 1),
        drop_detail=dict(t=ft(drop_film['t']), f=F_(drop_film['t']), jump_db=drop_film['jump_db'],
                         low_jump_db=drop_film['low_jump_db']) if drop_film else None,
        onsets=[ft(t) for t in on_t if inwin(t)],
    )
    return out, dict(F=F, beats=beats, downs=downs, bars=bars, stops=stops, hits40=hits40, drops_all=drops_all, T=T,
                     loud_ref=loud_ref, dur=dur_y)


# ----------------------------------------------------------------------------- report
def to_md(m):
    L = []
    L.append(f"# Beat map — {os.path.basename(m['source'])}")
    L.append(f"window: start {m['start']} s in file, {m['duration']} s, {m['fps']} fps (film t=0 ↔ file {m['start']} s)\n")
    L.append(f"**BPM {m['bpm']}** · beat {m['beat']*m['fps']:.2f} f ({m['beat']:.4f} s) · bar {m['bar']*m['fps']:.2f} f ({m['bar']:.3f} s) · "
             f"librosa alone {m['librosa_bpm']} · downbeat phase {m['downbeat_phase']} (confidence {m['downbeat_confidence']})"
             + f" · beat_this downbeat agreement {m.get('nn_downbeat_agreement')}"
             + (f" · **TEMPO LOW-CONFIDENCE — alternative {m.get('tempo_alternative')} BPM; verify half/double by ear on the kicks, then rerun with --bpm**" if m['tempo_ambiguous'] else ''))
    L.append('\nTempo candidates (score = on/off-beat contrast full+kick+snare, grid fit, prior):\n')
    L.append('| bpm | score | contrast full | kick | snare | on-beat hit frac | binary subdiv | seeds |\n|---|---|---|---|---|---|---|---|')
    for c in m['tempo_candidates']:
        L.append(f"| {c['bpm']} | {c['score']} | {c['contrast_full']} | {c['contrast_kick']} | {c['contrast_snare']} | {c.get('hit_frac')} | {c.get('subdiv')} | {' '.join(c.get('seeds', []))} |")
    L.append(f"\nDrop: " + (f"**f{m['drop_detail']['f']} ({m['drop']} s)**, +{m['drop_detail']['jump_db']} dB, low +{m['drop_detail']['low_jump_db']} dB" if m['drop'] is not None else 'none in window (flat loop)'))
    if m.get('drop_candidates'):
        L.append('Drop candidates: ' + ', '.join(f"f{d['f']} (+{d['jump_db']} dB, low +{d['low_jump_db']}, score {d['score']})" for d in m['drop_candidates']))
    L.append(f"Grid shifted {m.get('grid_shift_ms')} ms to the measured attacks of strong beats.")
    L.append('\n## Sections (bar map)\n\n| section | bars | t | frames | RMS dB | density target |\n|---|---|---|---|---|---|')
    for s in m['sections']:
        L.append(f"| {s['name']} | {s['bars']} | {s['t']:.3f}–{s['end']:.3f} | f{s['f']}–f{s['f_end']} | {s['rms_db']} | {s['density_target']} |")
    L.append('\n## Bars\n\n| bar | t | frame | RMS dB | low dB | onsets/s | section | flags |\n|---|---|---|---|---|---|---|---|')
    for b in m['bars']:
        L.append(f"| {b['i']} | {b['t']:.3f} | {b['f']} | {b['rms_db']} | {b['low_db']} | {b['onsets_per_s']} | {b['section']} | {' '.join(b['flags'])} |")
    L.append('\n## Top-10 transients (hit these ±1 f with the biggest images)\n\n| rank | t | frame | score | off nearest beat (f) | on downbeat |\n|---|---|---|---|---|---|')
    for h in sorted(m['hits_detail'], key=lambda h: h['t']):
        L.append(f"| {h['rank']} | {h['t']:.3f} | {h['f']} | {h['score']} | {h['nearest_beat_off_f']} | {'yes' if h['on_downbeat'] else ''} |")
    L.append('\n## Stops / silences (scene boundary: ONE growing gesture into the next downbeat)\n')
    if m['stops_detail']:
        L.append('| kind | t | frames | dur | depth dB | next downbeat |\n|---|---|---|---|---|---|')
        for s in m['stops_detail']:
            L.append(f"| {s['kind']} | {s['t']:.3f}–{s['end']:.3f} | f{s['f']}–f{s['f_end']} | {s['dur']} | {s['depth_db']} | {s['next_downbeat_f']} |")
    else:
        L.append('none')
    L.append('\n## Risers\n')
    L.append('\n'.join(f"- f{r['f']}–f{r['f_end']} ({r['t']:.2f}–{r['end']:.2f} s): RMS +{r['rms_rise_db']} dB, centroid {r['centroid_rise_pct']:+.0f} %"
                       + (f", into downbeat {r['into_downbeat']:.3f} s" if r['into_downbeat'] is not None else '') for r in m['risers']) or 'none')
    L.append('\n## Pickups (onset 2–4 f before a downbeat — a big change may arrive here and settle on the downbeat)\n')
    L.append('\n'.join(f"- f{p['f']} → downbeat f{p['downbeat_f']} ({p['frames_before']} f early, strength {p['strength']})" for p in m['pickups']) or 'none')
    L.append(f"\n## Grids\n\nbeats (f): {' '.join(map(str, m['frames']['beats']))}\n\ndownbeats (f): {' '.join(map(str, m['frames']['downbeats']))}\n")
    return '\n'.join(L) + '\n'


# ----------------------------------------------------------------------------- window chooser
def choose_window(path, D, fps, top=3):
    y = decode(path)
    m, X = analyze(y, fps, 0.0, None, path)
    dur = X['dur']; T = X['T']; F = X['F']; fps_a = F['fps_a']
    loud_ref = X['loud_ref']
    hit_t = np.array([h[0] for h in X['hits40']])
    beats = X['beats']; downs = X['downs']
    r_db = db(F['rms'])
    cands = []
    for s in downs:
        if s < 0 or s + D > dur - 0.05: continue
        e = s + D
        why = []
        # energy at frame 1: first beat RMS vs the track's loud level
        r0 = float(np.mean(r_db[int(s * fps_a):int((s + T) * fps_a) + 1]))
        a = float(np.clip((r0 - (loud_ref - 14)) / 14, 0, 1))
        why.append(f'frame-1 energy {r0 - loud_ref:+.1f} dB vs loud')
        # drop inside
        b = 0.0; dsel = None
        for d in X['drops_all']:
            if s + 0.8 <= d['t'] <= e - 1.0:
                pos = (d['t'] - s) / D
                w = 1.0 if 0.2 <= pos <= 0.75 else 0.6
                v = min(1.0, d['score'] / 7) * w
                if v > b: b, dsel = v, d
        why.append(f"drop at +{dsel['t'] - s:.2f} s (+{dsel['jump_db']} dB)" if dsel else 'no drop inside')
        # end: hit / downbeat / stop at the end
        c = 0.15; endwhy = 'ends mid-phrase (needs fade)'
        nh = hit_t[np.abs(hit_t - e) <= 3 / fps] if len(hit_t) else []
        nd = downs[np.abs(downs - e) <= 2 / fps]
        st = [x for x in X['stops'] if abs(x['t'] - e) <= 0.25]
        if len(nh): c, endwhy = 1.0, f'ends on a top transient ({(nh[0] - e) * fps:+.1f} f)'
        elif st: c, endwhy = 0.9, f"ends on a {st[0]['kind']} ({(st[0]['t'] - e) * fps:+.1f} f)"
        elif len(nd): c, endwhy = 0.7, 'ends on a downbeat'
        why.append(endwhy)
        # penalty: silence early, track tail
        pen = 0.0
        if any(x['kind'] == 'silence' and x['t'] < s + 0.5 and x['end'] > s for x in X['stops']): pen += 0.5; why.append('silence in first 0.5 s')
        if e > dur - 3: pen += 0.3; why.append('runs into the track tail')
        # alternative end: nearest top transient within ±1.5 s gives an end-on-hit length
        alt = None
        near = hit_t[(hit_t > s + D - 1.5) & (hit_t < s + D + 1.5)] if len(hit_t) else []
        if len(near) and not len(nh):
            k = near[np.argmin(np.abs(near - e))]; alt = round(k - s + 2 / fps, 3)
        sc = 1.0 * a + 1.2 * b + 0.8 * c - pen
        cands.append(dict(start=round(float(s), 3), end=round(float(e), 3), score=round(sc, 3), reasons=why,
                          alt_duration_end_on_hit=alt))
    cands.sort(key=lambda c: -c['score'])
    pick = []
    for c in cands:
        if all(abs(c['start'] - p['start']) >= 8 * T - 0.01 for p in pick): pick.append(c)
        if len(pick) >= top: break
    return dict(source=path, bpm=m['bpm'], duration=round(dur, 2), window=D, suggestions=pick)


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('track')
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--dur', type=float, default=None)
    ap.add_argument('--fps', type=float, default=24)
    ap.add_argument('--out', default=None, help='beatmap.json path (beatmap.md written next to it)')
    ap.add_argument('--choose-window', type=float, default=None, metavar='D')
    ap.add_argument('--bpm', type=float, default=None, help='force tempo (after checking by ear); phase still fitted')
    a = ap.parse_args()
    if not os.path.exists(a.track): sys.exit(f'no such file: {a.track}')
    ext = os.path.splitext(a.track)[1].lower()
    if ext not in AUDIO_EXT: print(f'beatmap: warning: unusual extension {ext}, trying ffmpeg anyway', file=sys.stderr)
    if a.choose_window:
        r = choose_window(a.track, a.choose_window, a.fps)
        txt = json.dumps(r, ensure_ascii=False, indent=1)
        if a.out:
            with open(a.out, 'w') as fh: fh.write(txt)
        print(f"{os.path.basename(a.track)}  {r['bpm']} BPM  {r['duration']} s — best {a.choose_window} s windows:")
        for i, c in enumerate(r['suggestions']):
            print(f"  {i+1}. --start {c['start']} --dur {a.choose_window}  (score {c['score']}): " + '; '.join(c['reasons'])
                  + (f"; end-on-hit alternative --dur {c['alt_duration_end_on_hit']}" if c['alt_duration_end_on_hit'] else ''))
        return
    ctx = min(a.start, 2.0)
    total = probe_duration(a.track)
    dur = a.dur if a.dur else ((total - a.start) if total else None)
    y = decode(a.track, a.start - ctx, (dur + ctx + 1.0) if dur else None)
    if a.bpm:
        global estimate_tempo
        _orig = estimate_tempo
        def forced(F, d):
            res, tl, comb = _orig(F, d)
            bpm, ph, fit = fit_grid(comb, F['fps_a'], a.bpm, span=0.003, dur=d)
            res.insert(0, dict(bpm=round(bpm, 2), phase=round(ph, 4), score=99.0, fit=round(float(fit), 3),
                               contrast_full=0, contrast_kick=0, contrast_snare=0, hit_frac=1.0, subdiv=0,
                               seeds=['--bpm'], forced=True))
            return res, tl, comb
        estimate_tempo = forced
    m, _ = analyze(y, a.fps, ctx, dur, a.track)
    m['start'] = round(a.start, 4)
    out = a.out or os.path.splitext(os.path.basename(a.track))[0] + '.beatmap.json'
    with open(out, 'w') as fh: json.dump(m, fh, ensure_ascii=False, indent=1)
    md = os.path.splitext(out)[0] + '.md'
    with open(md, 'w') as fh: fh.write(to_md(m))
    c2 = m['tempo_candidates'][1] if len(m['tempo_candidates']) > 1 else None
    print(f"{os.path.basename(a.track)}: BPM {m['bpm']} (librosa {m['librosa_bpm']}; next {c2['bpm'] if c2 else '-'} @ {c2['score'] if c2 else '-'})"
          f"{(' LOW-CONF alt ' + str(m['tempo_alternative'])) if m['tempo_ambiguous'] else ''} | nn-downbeat agree {m['nn_downbeat_agreement']} | downbeat conf {m['downbeat_confidence']} | drop {m['frames']['drop']} | "
          f"{len(m['bars'])} bars, {len(m['hits'])} hits, {len(m['stops'])} stops, {len(m['risers'])} risers, {len(m['pickups'])} pickups")
    print(f'wrote {out} and {md}')


if __name__ == '__main__':
    main()
