// One render job (Runpod pod or a remote GPU host): node shots/render_job.mjs <outDir> <frames a-b | i,j,k> [spp] [w] [h]
import fs from 'node:fs';
import path from 'node:path';
import { PathTracer } from '../../../skills/code-based-films/engine/src/host.mjs';
import { sceneFor, shotFor } from './film.mjs';
const [outDir, spec, sppA = '48', wA = '720', hA = '540'] = process.argv.slice(2);
const frames = spec.includes('-') && !spec.includes(',') ? (() => { const [a, b] = spec.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, k) => a + k); })() : spec.split(',').map(Number);
fs.mkdirSync(outDir, { recursive: true });
const T0 = Date.now(); const rec = [];
const pt = await PathTracer.launch({ log: (x) => { if (!/404|powerPreference/.test(x)) console.log(x); } });
try {
  const st = await pt.renderSequence(frames, async (i) => { const tb = Date.now(); const { s } = sceneFor(i, { width: +wA, height: +hA, spp: +sppA }); rec.push({ i, shot: shotFor(i).name, buildMs: Date.now() - tb }); return s; },
    (i) => path.join(outDir, `f_${String(i).padStart(4, '0')}.png`), {});
  st.forEach((x, k) => Object.assign(rec[k], { renderMs: Math.round(x.renderMs), tris: x.triangles }));
} finally { await pt.close(); }
fs.writeFileSync(path.join(outDir, `times_${frames[0]}.json`), JSON.stringify({ wallMs: Date.now() - T0, frames: rec }, null, 1));
console.log(`job done: ${frames.length} frames in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
