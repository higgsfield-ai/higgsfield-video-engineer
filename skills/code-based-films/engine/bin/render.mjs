#!/usr/bin/env node
// CLI:  node bin/render.mjs scene.json --spp 512 --out frame.png [--linear frame.pfm] [--width W --height H]
//                           [--depth depth.pfm] [--max-seconds S] [--no-denoise] [--exposure EV] [--tonemap agx|aces|linear] [--json stats.json]
//       node bin/render.mjs 'shots/f_%04d.json' --frames 1-48 --out 'out/f_%04d.png'      (sequence mode)
import path from 'node:path';
import fs from 'node:fs';
import { PathTracer } from '../src/host.mjs';

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 5).join('\n'));
  process.exit(argv.length ? 0 : 1);
}
const scenePath = argv[0];
const opt = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  switch (a) {
    case '--spp': opt.spp = +next(); break;
    case '--out': opt.out = next(); break;
    case '--linear': opt.linear = next(); break;
    case '--depth': opt.depth = next(); break;
    case '--width': opt.width = +next(); break;
    case '--height': opt.height = +next(); break;
    case '--max-seconds': opt.maxSeconds = +next(); break;
    case '--frames': opt.frames = next(); break;
    case '--no-denoise': (opt.post ??= {}).enabled = false; break;
    case '--exposure': (opt.post ??= {}).exposure = +next(); break;
    case '--tonemap': (opt.post ??= {}).tonemap = next(); break;
    case '--json': opt.json = next(); break;
    default: console.error(`unknown option ${a}`); process.exit(1);
  }
}
const fmt = (pat, i) => pat.replace(/%0(\d)d/, (_, n) => String(i).padStart(+n, '0')).replace('%d', String(i));

const pt = await PathTracer.launch();
console.log(`adapter: ${JSON.stringify(pt.adapter)}`);
const results = [];
try {
  if (opt.frames) {
    const [a, b] = opt.frames.split('-').map(Number);
    const frames = []; for (let i = a; i <= (b ?? a); i++) frames.push(i);
    const st = await pt.renderSequence(frames, (i) => fmt(scenePath, i), (i) => fmt(opt.out || 'frame_%04d.png', i),
      { ...opt, linearFor: opt.linear ? (i) => fmt(opt.linear, i) : undefined, depthFor: opt.depth ? (i) => fmt(opt.depth, i) : undefined });
    results.push(...st);
  } else {
    const st = await pt.render(scenePath, { ...opt, out: opt.out || path.basename(scenePath, '.json') + '.png' });
    console.log(`${st.out}: ${st.spp} spp ${st.width}x${st.height} in ${(st.renderMs / 1000).toFixed(2)} s render + ${(st.postMs / 1000).toFixed(2)} s denoise/tonemap` +
      ` = ${st.sppPerSec.toFixed(2)} spp/s, ${(st.sppPerSec * st.width * st.height / 1e6).toFixed(1)} Mpaths/s; ${st.triangles} tris, ${st.instances} instances`);
    results.push(st);
  }
} finally {
  await pt.close();
}
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(results, null, 1));
