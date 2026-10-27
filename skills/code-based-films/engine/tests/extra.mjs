// denoiser comparison + JSON/CLI sequence test (run on a GPU host)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PathTracer } from '../src/host.mjs';
import * as S from '../proofs/scenes.mjs';
fs.mkdirSync('tests/out/x/seq', { recursive: true });
const pt = await PathTracer.launch({ log: (x) => { if (!x.includes('404')) console.log(x); } });
for (const [n, b] of [['b', S.industrial], ['a', S.cornell]]) {
  const s = await b({ spp: 64 });
  const r1 = await pt.render(s, { out: `tests/out/x/${n}_64_raw.png`, post: { enabled: false } });
  const r2 = await pt.render(s, { out: `tests/out/x/${n}_64_dn.png` });
  console.log(n, 'raw', r1.renderMs.toFixed(0), 'dn', r2.renderMs.toFixed(0), 'post ms', r2.postMs.toFixed(1));
}
// sequence via JSON + CLI: an orange cube sliding with motion blur, 3 frames
for (let f = 1; f <= 3; f++) {
  const s = await S.motionDof({ spp: 128 });
  const cube = s.instances.find((i) => i.motion && i.position[1] === 0.08);
  cube.position = [-0.36 + f * 0.1, 0.08, -1.4]; cube.motion.position = [-0.2 + f * 0.1, 0.08, -1.4];
  await s.save(`tests/out/x/seq/f_${String(f).padStart(4, '0')}.json`);
}
await pt.close();
const out = execFileSync(process.execPath, ['bin/render.mjs', 'tests/out/x/seq/f_%04d.json', '--frames', '1-3', '--out', 'tests/out/x/seq/f_%04d.png', '--json', 'tests/out/x/seq/stats.json'], { encoding: 'utf8' });
console.log(out.split('\n').filter((l) => l.startsWith('frame') || l.startsWith('adapter')).join('\n'));
const one = execFileSync(process.execPath, ['bin/render.mjs', 'tests/out/x/seq/f_0001.json', '--spp', '256', '--out', 'tests/out/x/cli_single.png', '--linear', 'tests/out/x/cli_single.pfm'], { encoding: 'utf8' });
console.log(one.split('\n').filter((l) => l.includes('spp')).join('\n'));
