// Render proof scenes:  node proofs/run.mjs <outDir> [names=a,b,c,d (optionally name:spp)] [spp] [scale] [maxSeconds]
import fs from 'node:fs';
import path from 'node:path';
import { PathTracer } from '../src/host.mjs';
import { cornell, industrial, motionDof, smokeFire, craft } from './scenes.mjs';

const [outDir = 'proofs/out', names = 'a,b,c,d', sppArg, scaleArg, maxS] = process.argv.slice(2);
const scale = scaleArg ? +scaleArg : 1;
const render = { width: Math.round(1440 * scale), height: Math.round(1080 * scale) };
if (sppArg) render.spp = +sppArg;
if (maxS) render.maxSeconds = +maxS;
const builders = { a: ['a_cornell_glass_gold', cornell], b: ['b_industrial_haze', industrial], c: ['c_motionblur_dof', motionDof], d: ['d_smoke_fire_grid', smokeFire], f: ['f_craft_materials', craft] };
fs.mkdirSync(outDir, { recursive: true });
const pt = await PathTracer.launch();
console.log('adapter', JSON.stringify(pt.adapter));
const all = {};
try {
  for (const item of names.split(',')) {
    const [n, sppN] = item.split(':');
    const [file, build] = builders[n];
    const s = await build(sppN ? { ...render, spp: +sppN } : render);
    const st = await pt.render(s, { out: path.join(outDir, `${file}.png`) });
    const line = `${file}: ${st.spp} spp ${st.width}x${st.height} render ${(st.renderMs / 1000).toFixed(2)} s, post ${(st.postMs / 1000).toFixed(2)} s, load ${(st.loadMs / 1000).toFixed(2)} s, pack ${(st.packMs / 1000).toFixed(2)} s -> ${st.sppPerSec.toFixed(2)} spp/s (${(st.sppPerSec * st.width * st.height / 1e6).toFixed(1)} Mpath/s); tris ${st.triangles}, inst ${st.instances}, lights ${st.lights}, stripes ${st.stripes}`;
    console.log(line);
    all[file] = { ...st, line };
  }
} finally {
  await pt.close();
}
fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(all, null, 1));
