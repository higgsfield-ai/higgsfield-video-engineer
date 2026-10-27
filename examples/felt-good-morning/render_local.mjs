#!/usr/bin/env node
// Render the example film on THIS machine's GPU (Chrome WebGPU: Metal, D3D12 or Vulkan), frame by frame, resumable.
//
//   node examples/felt-good-morning/render_local.mjs [--quality preview|final] [--frames a-b] [--out dir]
//        [--max-seconds S] [--spp N] [--pause ms] [--dry-run] [--encode]
//
//   preview  640x480,   48 spp, at most 20 s per frame   -> out/preview   (a laptop does this comfortably)
//   final    1440x1080, 192 spp, at most 120 s per frame -> out/final     (render it in chunks with --frames)
//
// Only frames whose f_NNNN.png is missing are rendered, so stopping (Ctrl+C) and running again continues where it
// stopped. One Chrome process renders every frame. After the first frame it prints an estimate for the rest.
// --dry-run builds one scene per shot on the CPU (no GPU), checks them and lists what is missing.
// --encode adds the title (tools/title_ofl.py) and the sound (music/mix.wav if present, else an effects-only mix) and
// writes out/good-morning_<quality>.mp4.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sceneFor, SHOTS, FRAMES, FPS } from './shots/film.mjs';
import { packScene } from '../../skills/code-based-films/engine/src/pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRESETS = {
  preview: { width: 640, height: 480, spp: 48, maxSeconds: 20 },
  final: { width: 1440, height: 1080, spp: 192, maxSeconds: 120 },
};

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
if (flag('help') || flag('h')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }

const quality = opt('quality', 'preview');
if (!PRESETS[quality]) { console.error(`unknown --quality ${quality} (preview | final)`); process.exit(1); }
const P = { ...PRESETS[quality] };
if (opt('spp')) P.spp = +opt('spp');
if (opt('max-seconds')) P.maxSeconds = +opt('max-seconds');
const pauseMs = +opt('pause', 0);
const outDir = path.resolve(opt('out', path.join(HERE, 'out', quality)));
const [a, b] = opt('frames', `0-${FRAMES - 1}`).split('-').map(Number);
const first = Math.max(0, a), last = Math.min(FRAMES - 1, Number.isFinite(b) ? b : a);
if (!(first <= last)) { console.error('bad --frames range'); process.exit(1); }

const fname = (i) => path.join(outDir, `f_${String(i).padStart(4, '0')}.png`);
const all = Array.from({ length: last - first + 1 }, (_, k) => first + k);
const missing = all.filter((i) => !fs.existsSync(fname(i)));
const fmtMin = (ms) => (ms < 90e3 ? `${Math.round(ms / 1000)} s` : `${(ms / 60e3).toFixed(ms < 600e3 ? 1 : 0)} min`);

console.log(`quality ${quality}: ${P.width}x${P.height}, ${P.spp} spp, max ${P.maxSeconds} s/frame -> ${path.relative(process.cwd(), outDir) || '.'}`);
console.log(`frames ${first}-${last}: ${all.length - missing.length} done, ${missing.length} to render`);

if (flag('dry-run')) {
  // CPU only: build and pack one frame per shot (the first missing one in the shot if any), report sizes
  for (const sh of SHOTS) {
    const f0 = Math.round(sh.in * FPS), f1 = Math.min(FRAMES, Math.round(sh.out * FPS)) - 1;
    if (f1 < first || f0 > last) continue;
    const i = missing.find((x) => x >= f0 && x <= f1) ?? Math.max(f0, first);
    const t0 = Date.now();
    const { s } = sceneFor(i, P);
    const { stats } = await packScene(s);
    console.log(`  ${sh.name.padEnd(10)} frame ${String(i).padStart(3)}: ${(stats.triangles / 1e6).toFixed(2)} M tris, ${stats.instances} instances, ${stats.lights} lights, build+pack ${Date.now() - t0} ms`);
  }
  if (missing.length) console.log(`missing: ${compact(missing)}`);
  console.log('dry run: no GPU used, nothing written');
  process.exit(0);
}

if (missing.length) {
  fs.mkdirSync(outDir, { recursive: true });
  const { PathTracer } = await import('../../skills/code-based-films/engine/src/host.mjs');
  const pt = await PathTracer.launch({ log: (x) => { if (!/404|powerPreference/.test(x)) console.log(x); } });
  console.log(`GPU adapter: ${JSON.stringify(pt.adapter)}`);
  let stop = false;
  process.on('SIGINT', () => { if (stop) process.exit(130); stop = true; console.log('\nstopping after this frame (Ctrl+C again to quit now); run again to resume'); });
  const T0 = Date.now(); let done = 0;
  try {
    for (const i of missing) {
      if (stop) break;
      const tf = Date.now();
      const { s } = sceneFor(i, P);
      s.render.maxSeconds = P.maxSeconds;
      const tmp = fname(i).replace(/\.png$/, '.part.png');
      const st = await pt.render(s, { out: tmp });
      fs.renameSync(tmp, fname(i));   // a frame only counts once it is complete
      done++;
      const per = (Date.now() - T0) / done, left = missing.length - done;
      const capped = st.spp < P.spp ? ` (time cap: ${st.spp}/${P.spp} spp)` : '';
      console.log(`f_${String(i).padStart(4, '0')}  ${((Date.now() - tf) / 1000).toFixed(1)} s${capped}  [${done}/${missing.length}]` +
        (done === 1 && left ? `  ≈${fmtMin(per * left)} for the remaining ${left} frames on this GPU` : left ? `  ~${fmtMin(per * left)} left` : ''));
      if (pauseMs && left) await new Promise((r) => setTimeout(r, pauseMs));
    }
  } finally { await pt.close(); }
  console.log(`rendered ${done} frames in ${fmtMin(Date.now() - T0)}`);
}

const stillMissing = all.filter((i) => !fs.existsSync(fname(i)));
if (flag('encode')) {
  if (first !== 0 || last !== FRAMES - 1 || stillMissing.length) {
    console.error(`encode needs all ${FRAMES} frames in ${outDir}; missing: ${compact(stillMissing) || 'none in range, but the range is not the whole film'}`);
    process.exit(1);
  }
  const py = process.env.PYTHON || 'python3';
  const titleDir = path.join(path.dirname(outDir), `title_${P.width}x${P.height}`);
  if (!fs.existsSync(path.join(titleDir, 't_0479.png'))) run(py, [path.join(HERE, 'tools/title_ofl.py'), titleDir, String(P.width), String(P.height)]);
  let mix = path.join(HERE, 'music', 'mix.wav');
  if (!fs.existsSync(mix)) {
    mix = path.join(path.dirname(outDir), 'mix.wav');
    const sfx = path.join(path.dirname(outDir), 'sfx_only.wav');
    run(py, [path.join(HERE, 'tools/sfx.py'), sfx, '--no-music']);
    run('bash', [path.join(HERE, 'tools/mix.sh'), sfx, mix]);
  }
  const mp4 = path.join(path.dirname(outDir), `good-morning_${quality}.mp4`);
  run('bash', [path.join(HERE, '../../skills/code-based-films/tools/encode.sh'), outDir, titleDir, mix, mp4, quality === 'final' ? '16' : '20']);
  console.log(`film: ${mp4}`);
} else if (!stillMissing.length && first === 0 && last === FRAMES - 1) {
  console.log('all frames are here; add --encode to build the film (title + sound + H.264)');
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.map((x) => path.relative(process.cwd(), x) || x).join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${cmd} failed (exit ${r.status}); see above`); process.exit(1); }
}
function compact(list) {
  const out = []; let s = null, p = null;
  for (const i of list) { if (s === null) { s = p = i; } else if (i === p + 1) { p = i; } else { out.push(s === p ? `${s}` : `${s}-${p}`); s = p = i; } }
  if (s !== null) out.push(s === p ? `${s}` : `${s}-${p}`);
  return out.join(',');
}
